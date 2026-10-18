use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::{self, audit_membership, emit_branch_event, validate_email},
    notifications::{self, Kind, Notice},
};
use crate::{
    auth::{
        password::{self, Password},
        session,
    },
    authz::{authorize, relations, Action, Actor},
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Member {
    pub user_id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub is_active: bool,
    pub is_admin: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub left_at: Option<OffsetDateTime>,
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct MemberQuery {
    /// Include departed members (admins only, for reactivation).
    #[serde(default)]
    pub include_left: bool,
    /// Only members of this group.
    pub group_id: Option<Uuid>,
}

pub async fn list(
    db: &PgPool,
    actor: &Actor,
    branch_id: Uuid,
    query: &MemberQuery,
    page: &PageParams,
) -> AppResult<Page<Member>> {
    authorize(actor, Action::ViewMembers { branch_id })?;
    if query.include_left {
        authorize(actor, Action::ReactivateMember { branch_id })?;
    }
    let limit = page.limit()?;
    let after: Option<(String, String, Uuid)> = page.cursor()?;
    let (after_last, after_first, after_id) = match after {
        Some((l, f, id)) => (Some(l), Some(f), Some(id)),
        None => (None, None, None),
    };

    let rows = sqlx::query_as!(
        Member,
        r#"
        SELECT u.id AS user_id, u.email::text AS "email!", u.first_name, u.last_name, u.is_active,
               m.is_admin, m.joined_at, m.left_at
        FROM branch_membership m
        JOIN app_user u ON u.id = m.user_id
        WHERE m.branch_id = $1
          AND ($2 OR m.left_at IS NULL)
          AND ($3::uuid IS NULL OR EXISTS (
                SELECT 1 FROM group_member gm WHERE gm.group_id = $3 AND gm.user_id = u.id AND gm.branch_id = $1))
          AND ($4::text IS NULL OR (lower(u.last_name), lower(u.first_name), u.id) > ($4, $5, $6))
        ORDER BY lower(u.last_name), lower(u.first_name), u.id
        LIMIT $7
        "#,
        branch_id,
        query.include_left,
        query.group_id,
        after_last,
        after_first,
        after_id,
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |m| (m.last_name.to_lowercase(), m.first_name.to_lowercase(), m.user_id)))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewMember {
    pub email: String,
    /// Required when the account doesn't exist yet.
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct AddedMember {
    pub user_id: Uuid,
    /// A new account was created.
    pub created: bool,
    /// A departed membership was restored.
    pub reactivated: bool,
    /// Only for new accounts, shown once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temporary_password: Option<String>,
}

pub async fn add(db: &PgPool, actor: &Actor, branch_id: Uuid, input: NewMember) -> AppResult<AddedMember> {
    let email = validate_email(&input.email)?;
    let existing_id = sqlx::query_scalar!("SELECT id FROM app_user WHERE email = ($1::text)::citext", email)
        .fetch_optional(db)
        .await?;
    let existing = match existing_id {
        Some(id) => relations::load_user(db, id).await?,
        None => None,
    };
    authorize(actor, Action::AddMember { branch_id, existing: existing.as_ref() })?;

    let mut tx = db.begin().await?;

    let result = match existing {
        Some(user) if user.is_member_of(branch_id) => {
            return Err(AppError::conflict("already_member", "this person is already a member of the branch"));
        }
        Some(user) if user.departed.contains(&branch_id) => {
            authorize(actor, Action::ReactivateMember { branch_id })?;
            sqlx::query!(
                "UPDATE branch_membership SET left_at = NULL, added_by = $3 WHERE user_id = $1 AND branch_id = $2",
                user.user_id,
                branch_id,
                actor.user_id
            )
            .execute(&mut *tx)
            .await?;
            audit_membership(
                &mut tx,
                actor,
                branch_id,
                user.user_id,
                "reactivate",
                Some(json!({ "left": true })),
                json!({ "left": false }),
            )
            .await?;
            AddedMember { user_id: user.user_id, created: false, reactivated: true, temporary_password: None }
        }
        Some(user) => {
            insert_membership(&mut tx, actor, branch_id, user.user_id).await?;
            AddedMember { user_id: user.user_id, created: false, reactivated: false, temporary_password: None }
        }
        None => {
            let first_name = required_name(input.first_name.as_deref(), "first_name")?;
            let last_name = required_name(input.last_name.as_deref(), "last_name")?;
            let temp = password::generate_temporary();
            let hash = password::hash_async(temp.clone()).await?;
            let user_id = sqlx::query_scalar!(
                r#"
                INSERT INTO app_user (email, first_name, last_name, password_hash, must_change_password)
                VALUES ($1::text, $2, $3, $4, true)
                RETURNING id
                "#,
                email,
                first_name,
                last_name,
                hash,
            )
            .fetch_one(&mut *tx)
            .await?;
            audit::record(
                &mut tx,
                AuditEntry {
                    entity_type: "app_user",
                    entity_id: user_id.to_string(),
                    branch_id: Some(branch_id),
                    actor_id: Some(actor.user_id),
                    action: "create",
                    old_value: None,
                    new_value: Some(json!({ "email": email, "first_name": first_name, "last_name": last_name })),
                },
            )
            .await?;
            insert_membership(&mut tx, actor, branch_id, user_id).await?;
            AddedMember {
                user_id,
                created: true,
                reactivated: false,
                temporary_password: Some(temp.expose().to_owned()),
            }
        }
    };

    // The schema trigger has put them in "All members".
    emit_branch_event(&mut tx, "member_changed", branch_id, vec![result.user_id]).await?;
    tx.commit().await?;
    Ok(result)
}

async fn insert_membership(tx: &mut crate::db::Tx, actor: &Actor, branch_id: Uuid, user_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        "INSERT INTO branch_membership (user_id, branch_id, added_by) VALUES ($1, $2, $3)",
        user_id,
        branch_id,
        actor.user_id
    )
    .execute(&mut **tx)
    .await?;
    audit_membership(tx, actor, branch_id, user_id, "create", None, json!({ "is_admin": false })).await
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct ProfilePatch {
    pub email: Option<String>,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
}

pub async fn update_profile(
    db: &PgPool,
    actor: &Actor,
    branch_id: Uuid,
    user_id: Uuid,
    patch: ProfilePatch,
) -> AppResult<Member> {
    let target = current_member(db, branch_id, user_id).await?;
    authorize(actor, Action::EditMember { branch_id, target: &target })?;
    let email = patch.email.as_deref().map(validate_email).transpose()?;
    let first_name = patch.first_name.as_deref().map(|n| required_name(Some(n), "first_name")).transpose()?;
    let last_name = patch.last_name.as_deref().map(|n| required_name(Some(n), "last_name")).transpose()?;

    let mut tx = db.begin().await?;
    let old = sqlx::query!(
        r#"SELECT email::text AS "email!", first_name, last_name FROM app_user WHERE id = $1 FOR UPDATE"#,
        user_id
    )
    .fetch_one(&mut *tx)
    .await?;
    let new_email = email.unwrap_or_else(|| old.email.clone());
    let new_first = first_name.unwrap_or_else(|| old.first_name.clone());
    let new_last = last_name.unwrap_or_else(|| old.last_name.clone());
    sqlx::query!(
        "UPDATE app_user SET email = $2::text, first_name = $3, last_name = $4 WHERE id = $1",
        user_id,
        new_email,
        new_first,
        new_last
    )
    .execute(&mut *tx)
    .await?;

    let mut old_v = serde_json::Map::new();
    let mut new_v = serde_json::Map::new();
    for (field, before, after) in [
        ("email", &old.email, &new_email),
        ("first_name", &old.first_name, &new_first),
        ("last_name", &old.last_name, &new_last),
    ] {
        if before != after {
            old_v.insert(field.into(), json!(before));
            new_v.insert(field.into(), json!(after));
        }
    }
    if !new_v.is_empty() {
        audit::record(
            &mut tx,
            AuditEntry {
                entity_type: "app_user",
                entity_id: user_id.to_string(),
                branch_id: Some(branch_id),
                actor_id: Some(actor.user_id),
                action: "update",
                old_value: Some(old_v.into()),
                new_value: Some(new_v.into()),
            },
        )
        .await?;
    }
    let member = fetch_member(&mut tx, branch_id, user_id).await?;
    tx.commit().await?;
    Ok(member)
}

/// DELETE /branches/{id}/members/{user_id}: sets `left_at`. The schema
/// trigger removes them from the branch's groups; their open work items in
/// the branch become unassigned.
pub async fn remove(db: &PgPool, actor: &Actor, branch_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let target = current_member(db, branch_id, user_id).await?;
    authorize(actor, Action::RemoveMember { branch_id, target: &target })?;
    if target.branches.get(&branch_id) == Some(&true) {
        return Err(AppError::conflict("member_is_admin", "an admin can't leave the branch; demote them first"));
    }

    let mut tx = db.begin().await?;
    sqlx::query!(
        "UPDATE branch_membership SET left_at = now() WHERE user_id = $1 AND branch_id = $2 AND left_at IS NULL",
        user_id,
        branch_id
    )
    .execute(&mut *tx)
    .await?;
    audit_membership(
        &mut tx,
        actor,
        branch_id,
        user_id,
        "remove",
        Some(json!({ "left": false })),
        json!({ "left": true }),
    )
    .await?;

    let unassigned = sqlx::query!(
        r#"
        UPDATE work_item SET assignee_id = NULL, version = version + 1
        WHERE branch_id = $1 AND assignee_id = $2 AND status NOT IN ('approved', 'cancelled')
        RETURNING id, issue_id
        "#,
        branch_id,
        user_id
    )
    .fetch_all(&mut *tx)
    .await?;

    let admins = notifications::branch_admins(&mut tx, branch_id).await?;
    for item in &unassigned {
        audit::record(
            &mut tx,
            AuditEntry {
                entity_type: "work_item",
                entity_id: item.id.to_string(),
                branch_id: Some(branch_id),
                actor_id: Some(actor.user_id),
                action: "unassign",
                old_value: Some(json!({ "assignee_id": user_id })),
                new_value: Some(json!({ "assignee_id": null })),
            },
        )
        .await?;
        let notice = |kind| Notice {
            kind,
            branch_id: Some(branch_id),
            issue_id: Some(item.issue_id),
            work_item_id: Some(item.id),
            actor_id: Some(actor.user_id),
            payload: json!({ "reason": "member_removed", "user_id": user_id }),
        };
        notifications::notify(&mut tx, &[user_id], notice(Kind::Unassigned)).await?;
        notifications::notify(&mut tx, &admins, notice(Kind::StatusChanged)).await?;
    }

    emit_branch_event(&mut tx, "permissions_changed", branch_id, vec![user_id]).await?;
    tx.commit().await?;
    Ok(())
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PasswordReset {
    pub temporary_password: String,
}

/// POST /users/{id}/reset-password: temp password, forced change, and every
/// session of that user is revoked.
pub async fn reset_password(db: &PgPool, actor: &Actor, user_id: Uuid) -> AppResult<PasswordReset> {
    let target = relations::load_user(db, user_id).await?.ok_or(AppError::NotFound)?;
    authorize(actor, Action::ResetPassword { target: &target })?;

    let temp: Password = password::generate_temporary();
    let hash = password::hash_async(temp.clone()).await?;
    let mut tx = db.begin().await?;
    sqlx::query!(
        r#"UPDATE app_user SET password_hash = $2, must_change_password = true, failed_login_count = 0,
                              locked_until = NULL
           WHERE id = $1"#,
        user_id,
        hash
    )
    .execute(&mut *tx)
    .await?;
    session::revoke_all_for_user(&mut *tx, user_id, None).await?;
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "app_user",
            entity_id: user_id.to_string(),
            branch_id: None,
            actor_id: Some(actor.user_id),
            action: "reset_password",
            old_value: None,
            new_value: Some(json!({ "must_change_password": true })),
        },
    )
    .await?;
    tx.commit().await?;
    Ok(PasswordReset { temporary_password: temp.expose().to_owned() })
}

/// PATCH /users/{id}/active.
pub async fn set_active(db: &PgPool, actor: &Actor, user_id: Uuid, is_active: bool) -> AppResult<()> {
    let target = relations::load_user(db, user_id).await?.ok_or(AppError::NotFound)?;
    authorize(actor, Action::SetUserActive { target: &target })?;
    if target.is_active == is_active {
        return Ok(());
    }

    let mut tx = db.begin().await?;
    // Same locks as admin and super admin changes, so a concurrent demotion
    // and deactivation can't together leave nobody in charge.
    if target.is_super_admin {
        branches::lock_super_admins(&mut tx).await?;
    }
    let admin_of: Vec<Uuid> = target.branches.iter().filter(|(_, a)| **a).map(|(b, _)| *b).collect();
    sqlx::query!("SELECT id FROM branch WHERE id = ANY($1) ORDER BY id FOR UPDATE", &admin_of)
        .fetch_all(&mut *tx)
        .await?;

    sqlx::query!("UPDATE app_user SET is_active = $2 WHERE id = $1", user_id, is_active).execute(&mut *tx).await?;
    if !is_active {
        session::revoke_all_for_user(&mut *tx, user_id, None).await?;
    }
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "app_user",
            entity_id: user_id.to_string(),
            branch_id: None,
            actor_id: Some(actor.user_id),
            action: if is_active { "activate" } else { "deactivate" },
            old_value: Some(json!({ "is_active": target.is_active })),
            new_value: Some(json!({ "is_active": is_active })),
        },
    )
    .await?;
    // Leaving a branch without an admin, or no super admin at all, fails
    // here with 409.
    tx.commit().await?;
    Ok(())
}

/// The target as a current member of the branch, or 404.
async fn current_member(db: &PgPool, branch_id: Uuid, user_id: Uuid) -> AppResult<relations::UserFacts> {
    relations::load_user(db, user_id).await?.filter(|u| u.is_member_of(branch_id)).ok_or(AppError::NotFound)
}

async fn fetch_member(tx: &mut crate::db::Tx, branch_id: Uuid, user_id: Uuid) -> AppResult<Member> {
    Ok(sqlx::query_as!(
        Member,
        r#"
        SELECT u.id AS user_id, u.email::text AS "email!", u.first_name, u.last_name, u.is_active,
               m.is_admin, m.joined_at, m.left_at
        FROM branch_membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.branch_id = $1 AND m.user_id = $2
        "#,
        branch_id,
        user_id
    )
    .fetch_one(&mut **tx)
    .await?)
}

fn required_name(name: Option<&str>, field: &str) -> AppResult<String> {
    let name = name.map(str::trim).unwrap_or_default();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::validation("invalid_name", format!("{field} must be between 1 and 100 characters")));
    }
    Ok(name.to_owned())
}
