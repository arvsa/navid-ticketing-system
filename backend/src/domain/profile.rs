//! Your own profile: a bio, a profile picture and a cover image for everyone,
//! and your name for super admins (no one above them changes it; everyone
//! else asks their admin). Everyone signed in sees them: the directory shows
//! people across the school.

use axum::body::Bytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::double_option,
    members::required_name,
};
use crate::{
    authz::Actor,
    error::{AppError, AppResult},
    realtime,
    storage::{ObjectReader, ObjectStore},
};

pub const BIO_MAX_CHARS: usize = 500;
pub const COVER_MAX_BYTES: usize = 5 * 1024 * 1024;
pub const AVATAR_MAX_BYTES: usize = 2 * 1024 * 1024;

/// The two pictures on a profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Image {
    Cover,
    Avatar,
}

impl Image {
    fn dir(self) -> &'static str {
        match self {
            Self::Cover => "covers",
            Self::Avatar => "avatars",
        }
    }

    fn noun(self) -> &'static str {
        match self {
            Self::Cover => "cover image",
            Self::Avatar => "profile picture",
        }
    }

    pub fn max_bytes(self) -> usize {
        match self {
            Self::Cover => COVER_MAX_BYTES,
            Self::Avatar => AVATAR_MAX_BYTES,
        }
    }
}

/// Absent fields stay as they are; `"bio": null` (or blank) clears the bio.
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct MyProfilePatch {
    /// Super admins only.
    pub first_name: Option<String>,
    /// Super admins only.
    pub last_name: Option<String>,
    #[serde(default, with = "double_option")]
    pub bio: Option<Option<String>>,
}

/// What others see beside a person's name.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PublicProfile {
    pub user_id: Uuid,
    pub bio: Option<String>,
    /// Changes with every new cover: `GET /api/users/{id}/cover?v=<cover_version>`.
    /// `null`: no cover.
    pub cover_version: Option<String>,
    /// Changes with every new picture: `GET /api/users/{id}/avatar?v=<avatar_version>`.
    /// `null`: no picture.
    pub avatar_version: Option<String>,
}

/// Someone's profile picture, for the people list.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AvatarRef {
    pub user_id: Uuid,
    pub version: String,
}

/// The last part of the storage key: unique per upload, so it busts caches.
pub fn image_version(key: Option<&str>) -> Option<String> {
    key.and_then(|k| k.rsplit('/').next()).map(str::to_owned)
}

fn clean_bio(bio: Option<String>) -> AppResult<Option<String>> {
    let bio = bio.map(|b| b.trim().to_owned()).filter(|b| !b.is_empty());
    if bio.as_ref().is_some_and(|b| b.chars().count() > BIO_MAX_CHARS) {
        return Err(AppError::validation("invalid_bio", format!("a bio is at most {BIO_MAX_CHARS} characters")));
    }
    Ok(bio)
}

pub async fn update(db: &PgPool, actor: &Actor, patch: MyProfilePatch) -> AppResult<()> {
    if (patch.first_name.is_some() || patch.last_name.is_some()) && !actor.is_super_admin {
        return Err(AppError::forbidden("forbidden", "ask your admin to change your name"));
    }
    let first_name = patch.first_name.as_deref().map(|n| required_name(Some(n), "first_name")).transpose()?;
    let last_name = patch.last_name.as_deref().map(|n| required_name(Some(n), "last_name")).transpose()?;
    let bio = patch.bio.map(clean_bio).transpose()?;

    let mut tx = db.begin().await?;
    let old = sqlx::query!("SELECT first_name, last_name, bio FROM app_user WHERE id = $1 FOR UPDATE", actor.user_id)
        .fetch_one(&mut *tx)
        .await?;
    let new_first = first_name.unwrap_or_else(|| old.first_name.clone());
    let new_last = last_name.unwrap_or_else(|| old.last_name.clone());
    let new_bio = bio.unwrap_or_else(|| old.bio.clone());
    sqlx::query!(
        "UPDATE app_user SET first_name = $2, last_name = $3, bio = $4 WHERE id = $1",
        actor.user_id,
        new_first,
        new_last,
        new_bio
    )
    .execute(&mut *tx)
    .await?;

    let (mut old_v, mut new_v) = (Map::new(), Map::new());
    for (field, before, after) in [
        ("first_name", json!(old.first_name), json!(new_first)),
        ("last_name", json!(old.last_name), json!(new_last)),
        ("bio", json!(old.bio), json!(new_bio)),
    ] {
        if before != after {
            old_v.insert(field.into(), before);
            new_v.insert(field.into(), after);
        }
    }
    if !new_v.is_empty() {
        audit_self(&mut tx, actor, "update_profile", Some(old_v.into()), new_v.into()).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// JPEG, PNG or WebP, by their first bytes: the browser's content type isn't
/// trusted. The subtype goes into the storage key (`covers/<user>/<id>-png`).
fn image_subtype(data: &[u8]) -> Option<&'static str> {
    if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpeg")
    } else if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    }
}

/// Replaces the actor's cover or picture. The new file is stored first; the
/// old one is removed after the switch.
pub async fn set_image(db: &PgPool, store: &dyn ObjectStore, actor: &Actor, image: Image, data: Bytes) -> AppResult<()> {
    if data.len() > image.max_bytes() {
        let mb = image.max_bytes() / (1024 * 1024);
        return Err(AppError::PayloadTooLarge { message: format!("a {} is limited to {mb} MB", image.noun()).into() });
    }
    if data.is_empty() {
        return Err(AppError::validation("empty_file", "the file is empty"));
    }
    let subtype = image_subtype(&data).ok_or_else(|| {
        AppError::validation("unsupported_type", format!("a {} must be a JPEG, PNG or WebP", image.noun()))
    })?;
    let key = format!("{}/{}/{}-{subtype}", image.dir(), actor.user_id, Uuid::new_v4());
    store.put(&key, data).await.map_err(AppError::internal)?;
    let old = match swap_image(db, actor, image, Some(&key)).await {
        Ok(old) => old,
        Err(e) => {
            let _ = store.delete(&key).await;
            return Err(e);
        }
    };
    if let Some(old) = old {
        let _ = store.delete(&old).await;
    }
    Ok(())
}

pub async fn remove_image(db: &PgPool, store: &dyn ObjectStore, actor: &Actor, image: Image) -> AppResult<()> {
    if let Some(old) = swap_image(db, actor, image, None).await? {
        let _ = store.delete(&old).await;
    }
    Ok(())
}

/// Sets the image's key and returns the previous one.
async fn swap_image(db: &PgPool, actor: &Actor, image: Image, key: Option<&str>) -> AppResult<Option<String>> {
    let mut tx = db.begin().await?;
    let old = match image {
        Image::Cover => {
            let old = sqlx::query_scalar!("SELECT cover_key FROM app_user WHERE id = $1 FOR UPDATE", actor.user_id)
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query!("UPDATE app_user SET cover_key = $2 WHERE id = $1", actor.user_id, key)
                .execute(&mut *tx)
                .await?;
            old
        }
        Image::Avatar => {
            let old = sqlx::query_scalar!("SELECT avatar_key FROM app_user WHERE id = $1 FOR UPDATE", actor.user_id)
                .fetch_one(&mut *tx)
                .await?;
            sqlx::query!("UPDATE app_user SET avatar_key = $2 WHERE id = $1", actor.user_id, key)
                .execute(&mut *tx)
                .await?;
            old
        }
    };
    let (action, field) = match (image, key.is_some()) {
        (Image::Cover, true) => ("set_cover", "cover"),
        (Image::Cover, false) => ("remove_cover", "cover"),
        (Image::Avatar, true) => ("set_avatar", "avatar"),
        (Image::Avatar, false) => ("remove_avatar", "avatar"),
    };
    audit_self(&mut tx, actor, action, None, json!({ field: key.is_some() })).await?;
    if image == Image::Avatar {
        // Pictures show beside names everywhere: let open pages refetch them.
        realtime::emit(
            &mut tx,
            realtime::Event { kind: "avatars_changed", issue_id: None, branch_ids: vec![], recipient_ids: vec![] },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(old)
}

/// Everyone signed in sees anyone's profile (the school directory).
pub async fn public(db: &PgPool, _actor: &Actor, user_id: Uuid) -> AppResult<PublicProfile> {
    let row = sqlx::query!("SELECT bio, cover_key, avatar_key FROM app_user WHERE id = $1", user_id)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(PublicProfile {
        user_id,
        bio: row.bio,
        cover_version: image_version(row.cover_key.as_deref()),
        avatar_version: image_version(row.avatar_key.as_deref()),
    })
}

/// Everyone active with a profile picture: the client shows them beside
/// names wherever names appear.
pub async fn avatars(db: &PgPool, _actor: &Actor) -> AppResult<Vec<AvatarRef>> {
    let rows = sqlx::query!(
        r#"SELECT id, avatar_key AS "avatar_key!" FROM app_user WHERE avatar_key IS NOT NULL AND is_active ORDER BY id"#
    )
    .fetch_all(db)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|r| image_version(Some(&r.avatar_key)).map(|version| AvatarRef { user_id: r.id, version }))
        .collect())
}

pub struct ImageFile {
    pub content_type: &'static str,
    pub reader: ObjectReader,
}

pub async fn image(db: &PgPool, store: &dyn ObjectStore, _actor: &Actor, user_id: Uuid, image: Image) -> AppResult<ImageFile> {
    let row = sqlx::query!("SELECT cover_key, avatar_key FROM app_user WHERE id = $1", user_id)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    let key = match image {
        Image::Cover => row.cover_key,
        Image::Avatar => row.avatar_key,
    }
    .ok_or(AppError::NotFound)?;
    let content_type = match key.rsplit('-').next() {
        Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        _ => return Err(AppError::internal(format!("image {key} has no image type"))),
    };
    let reader = store.get(&key).await.map_err(AppError::internal)?;
    Ok(ImageFile { content_type, reader })
}

async fn audit_self(
    tx: &mut crate::db::Tx,
    actor: &Actor,
    action: &'static str,
    old_value: Option<Value>,
    new_value: Value,
) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "app_user",
            entity_id: actor.user_id.to_string(),
            branch_id: None,
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value: Some(new_value),
        },
    )
    .await
}
