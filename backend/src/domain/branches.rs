use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::audit::{self, AuditEntry};
use crate::{
    authz::{authorize, relations, Action, Actor},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
    realtime,
};

/// Serializes changes to the set of super admins, so two concurrent
/// demotions can't both pass the "at least one super admin" check.
const SUPER_ADMIN_LOCK: i64 = 0x5355_5045_5241_444D; // "SUPERADM"

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Branch {
    pub id: Uuid,
    pub code: String,
    pub name: String,
    pub email: Option<String>,
    pub timezone: String,
    pub is_active: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

pub async fn list(db: &PgPool, actor: &Actor, page: &PageParams) -> AppResult<Page<Branch>> {
    let limit = page.limit()?;
    let after: Option<(String, Uuid)> = page.cursor()?;
    let (after_name, after_id) = after.unzip();
    let mine: Vec<Uuid> = actor.branches.keys().copied().collect();
    let rows = sqlx::query_as!(
        Branch,
        r#"
        SELECT id, code, name, email::text, timezone, is_active, created_at, updated_at
        FROM branch
        WHERE ($1 OR id = ANY($2))
          AND ($3::text IS NULL OR (name, id) > ($3, $4))
        ORDER BY name, id
        LIMIT $5
        "#,
        actor.is_super_admin,
        &mine,
        after_name,
        after_id,
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |b| (b.name.clone(), b.id)))
}

pub async fn get(db: &PgPool, actor: &Actor, branch_id: Uuid) -> AppResult<Branch> {
    authorize(actor, Action::ViewBranch { branch_id })?;
    fetch(db, branch_id).await
}

async fn fetch(db: impl sqlx::PgExecutor<'_>, branch_id: Uuid) -> AppResult<Branch> {
    sqlx::query_as!(
        Branch,
        r#"SELECT id, code, name, email::text, timezone, is_active, created_at, updated_at FROM branch WHERE id = $1"#,
        branch_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewBranch {
    pub code: String,
    pub name: String,
    pub timezone: String,
    pub email: Option<String>,
    pub first_admin_user_id: Uuid,
}

pub async fn create(db: &PgPool, actor: &Actor, input: NewBranch) -> AppResult<Branch> {
    authorize(actor, Action::CreateBranch)?;
    let name = validate_name(&input.name)?;
    validate_timezone(&input.timezone)?;
    let email = input.email.as_deref().map(validate_email).transpose()?;

    let admin = relations::load_user(db, input.first_admin_user_id)
        .await?
        .filter(|u| u.is_active)
        .ok_or_else(|| AppError::validation("invalid_admin", "the first admin must be an active user"))?;

    let mut tx = db.begin().await?;
    let branch_id = sqlx::query_scalar!(
        r#"
        INSERT INTO branch (code, name, email, timezone, created_by)
        VALUES ($1, $2, $3::text, $4, $5)
        RETURNING id
        "#,
        input.code.trim(),
        name,
        email,
        input.timezone,
        actor.user_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    // The schema's deferred trigger rejects the branch at commit unless it
    // has an admin by then; a trigger has already created "All members".
    sqlx::query!(
        "INSERT INTO branch_membership (user_id, branch_id, is_admin, added_by) VALUES ($1, $2, true, $3)",
        admin.user_id,
        branch_id,
        actor.user_id,
    )
    .execute(&mut *tx)
    .await?;

    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "branch",
            entity_id: branch_id.to_string(),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action: "create",
            old_value: None,
            new_value: Some(json!({
                "code": input.code.trim(), "name": name, "timezone": input.timezone, "email": email,
            })),
        },
    )
    .await?;
    audit_membership(&mut tx, actor, branch_id, admin.user_id, "create", None, json!({ "is_admin": true })).await?;
    emit_branch_event(&mut tx, "branch_changed", branch_id, vec![admin.user_id]).await?;

    let branch = fetch(&mut *tx, branch_id).await?;
    tx.commit().await?;
    Ok(branch)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct BranchPatch {
    pub code: Option<String>,
    pub name: Option<String>,
    pub timezone: Option<String>,
    /// `Some(None)` clears it.
    #[serde(default, with = "double_option")]
    pub email: Option<Option<String>>,
    pub is_active: Option<bool>,
}

pub async fn update(db: &PgPool, actor: &Actor, branch_id: Uuid, patch: BranchPatch) -> AppResult<Branch> {
    authorize(actor, Action::EditBranch { branch_id })?;
    let name = patch.name.as_deref().map(validate_name).transpose()?;
    if let Some(tz) = &patch.timezone {
        validate_timezone(tz)?;
    }
    let email = match &patch.email {
        Some(Some(e)) => Some(Some(validate_email(e)?)),
        Some(None) => Some(None),
        None => None,
    };

    let mut tx = db.begin().await?;
    let old = sqlx::query_as!(
        Branch,
        r#"SELECT id, code, name, email::text, timezone, is_active, created_at, updated_at
           FROM branch WHERE id = $1 FOR UPDATE"#,
        branch_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;

    let new_code = patch.code.as_deref().map(str::trim).unwrap_or(&old.code).to_owned();
    let new_name = name.unwrap_or_else(|| old.name.clone());
    let new_timezone = patch.timezone.clone().unwrap_or_else(|| old.timezone.clone());
    let new_email = email.unwrap_or_else(|| old.email.clone());
    let new_active = patch.is_active.unwrap_or(old.is_active);

    sqlx::query!(
        r#"UPDATE branch SET code = $2, name = $3, timezone = $4, email = $5::text, is_active = $6 WHERE id = $1"#,
        branch_id,
        new_code,
        new_name,
        new_timezone,
        new_email,
        new_active,
    )
    .execute(&mut *tx)
    .await?;

    let mut old_v = serde_json::Map::new();
    let mut new_v = serde_json::Map::new();
    let mut diff = |field: &str, before: serde_json::Value, after: serde_json::Value| {
        if before != after {
            old_v.insert(field.into(), before);
            new_v.insert(field.into(), after);
        }
    };
    diff("code", json!(old.code), json!(new_code));
    diff("name", json!(old.name), json!(new_name));
    diff("timezone", json!(old.timezone), json!(new_timezone));
    diff("email", json!(old.email), json!(new_email));
    diff("is_active", json!(old.is_active), json!(new_active));
    if !new_v.is_empty() {
        audit::record(
            &mut tx,
            AuditEntry {
                entity_type: "branch",
                entity_id: branch_id.to_string(),
                branch_id: Some(branch_id),
                actor_id: Some(actor.user_id),
                action: "update",
                old_value: Some(old_v.into()),
                new_value: Some(new_v.into()),
            },
        )
        .await?;
        emit_branch_event(&mut tx, "branch_changed", branch_id, vec![]).await?;
    }

    let branch = fetch(&mut *tx, branch_id).await?;
    tx.commit().await?;
    Ok(branch)
}

/// PUT / DELETE /branches/{id}/admins/{user_id}. Appointing someone who isn't
/// a current member adds (or restores) their membership.
pub async fn set_admin(db: &PgPool, actor: &Actor, branch_id: Uuid, user_id: Uuid, is_admin: bool) -> AppResult<()> {
    authorize(actor, Action::SetBranchAdmin { branch_id })?;
    let mut tx = db.begin().await?;

    // Lock the branch first: concurrent demotions are serialized here, and
    // the deferred trigger then sees the other's result.
    sqlx::query_scalar!("SELECT id FROM branch WHERE id = $1 FOR UPDATE", branch_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;

    let current = sqlx::query!(
        r#"SELECT is_admin, left_at IS NOT NULL AS "departed!" FROM branch_membership
           WHERE user_id = $1 AND branch_id = $2"#,
        user_id,
        branch_id
    )
    .fetch_optional(&mut *tx)
    .await?;

    let was_admin = current.as_ref().is_some_and(|m| m.is_admin && !m.departed);
    match current {
        None if is_admin => {
            let active = sqlx::query_scalar!("SELECT is_active FROM app_user WHERE id = $1", user_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(AppError::NotFound)?;
            if !active {
                return Err(AppError::validation("user_inactive", "an inactive user can't be an admin"));
            }
            sqlx::query!(
                "INSERT INTO branch_membership (user_id, branch_id, is_admin, added_by) VALUES ($1, $2, true, $3)",
                user_id,
                branch_id,
                actor.user_id
            )
            .execute(&mut *tx)
            .await?;
            audit_membership(&mut tx, actor, branch_id, user_id, "create", None, json!({ "is_admin": true })).await?;
        }
        None => return Err(AppError::NotFound),
        Some(m) if m.departed && !is_admin => return Err(AppError::NotFound),
        Some(m) => {
            if m.is_admin == is_admin && !m.departed {
                tx.commit().await?;
                return Ok(());
            }
            sqlx::query!(
                "UPDATE branch_membership SET is_admin = $3, left_at = NULL WHERE user_id = $1 AND branch_id = $2",
                user_id,
                branch_id,
                is_admin
            )
            .execute(&mut *tx)
            .await?;
            let mut old = json!({ "is_admin": m.is_admin });
            let mut new = json!({ "is_admin": is_admin });
            if m.departed {
                old["left"] = json!(true);
                new["left"] = json!(false);
            }
            audit_membership(&mut tx, actor, branch_id, user_id, "update", Some(old), new).await?;
        }
    }

    if was_admin != is_admin {
        emit_branch_event(&mut tx, "permissions_changed", branch_id, vec![user_id]).await?;
    }
    // Leaving the branch without an admin fails here as `409 last_admin`.
    tx.commit().await?;
    Ok(())
}

/// PUT / DELETE /users/{id}/super-admin.
pub async fn set_super_admin(db: &PgPool, actor: &Actor, user_id: Uuid, is_super_admin: bool) -> AppResult<()> {
    authorize(actor, Action::SetSuperAdmin)?;
    let mut tx = db.begin().await?;
    lock_super_admins(&mut tx).await?;

    let current = sqlx::query_scalar!("SELECT is_super_admin FROM app_user WHERE id = $1 FOR UPDATE", user_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
    if current == is_super_admin {
        return Ok(());
    }
    sqlx::query!("UPDATE app_user SET is_super_admin = $2 WHERE id = $1", user_id, is_super_admin)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "app_user",
            entity_id: user_id.to_string(),
            branch_id: None,
            actor_id: Some(actor.user_id),
            action: "update",
            old_value: Some(json!({ "is_super_admin": current })),
            new_value: Some(json!({ "is_super_admin": is_super_admin })),
        },
    )
    .await?;
    realtime::emit(
        &mut tx,
        realtime::Event {
            kind: "permissions_changed",
            issue_id: None,
            branch_ids: vec![],
            recipient_ids: vec![user_id],
        },
    )
    .await?;
    // Removing the last active super admin fails here as `409 last_super_admin`.
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn lock_super_admins(tx: &mut Tx) -> AppResult<()> {
    sqlx::query!("SELECT pg_advisory_xact_lock($1)", SUPER_ADMIN_LOCK).execute(&mut **tx).await?;
    Ok(())
}

pub(crate) async fn audit_membership(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    user_id: Uuid,
    action: &'static str,
    old_value: Option<serde_json::Value>,
    new_value: serde_json::Value,
) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "branch_membership",
            entity_id: format!("{user_id}:{branch_id}"),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value: Some(new_value),
        },
    )
    .await
}

pub(crate) async fn emit_branch_event(
    tx: &mut Tx,
    kind: &'static str,
    branch_id: Uuid,
    recipient_ids: Vec<Uuid>,
) -> AppResult<()> {
    realtime::emit(tx, realtime::Event { kind, issue_id: None, branch_ids: vec![branch_id], recipient_ids }).await
}

pub fn validate_timezone(tz: &str) -> AppResult<()> {
    time_tz::timezones::get_by_name(tz)
        .map(|_| ())
        .ok_or_else(|| AppError::validation("invalid_timezone", "timezone must be an IANA name such as Europe/Paris"))
}

fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err(AppError::validation("invalid_name", "name must be between 1 and 200 characters"));
    }
    Ok(name.to_owned())
}

/// Light syntax check; there is no email delivery in v1.
pub fn validate_email(email: &str) -> AppResult<String> {
    let email = email.trim();
    let ok = email.len() <= 254
        && email.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty() && domain.contains('.') && !domain.starts_with('.') && !domain.ends_with('.')
        })
        && !email.chars().any(char::is_whitespace);
    if !ok {
        return Err(AppError::validation("invalid_email", "a valid email is required"));
    }
    Ok(email.to_owned())
}

/// Distinguishes a missing field from an explicit `null` in PATCH bodies.
pub mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(de).map(Some)
    }
}
