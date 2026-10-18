use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::emit_branch_event,
    notifications::{self, Kind, Notice},
};
use crate::{
    authz::{authorize, Action, Actor, IssueType, Permission, Scope},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Group {
    pub id: Uuid,
    pub branch_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    pub member_count: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// The row facts every group operation starts from.
struct GroupRow {
    branch_id: Uuid,
    name: String,
    description: Option<String>,
    is_default: bool,
    archived_at: Option<OffsetDateTime>,
}

/// Loads the group and checks `ManageGroups` in its branch. Groups in
/// branches the actor can't see are 404.
async fn load_managed(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<GroupRow> {
    let group = sqlx::query_as!(
        GroupRow,
        "SELECT branch_id, name, description, is_default, archived_at FROM user_group WHERE id = $1",
        group_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    authorize(actor, Action::ManageGroups { branch_id: group.branch_id })?;
    Ok(group)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct GroupQuery {
    #[serde(default)]
    pub include_archived: bool,
}

pub async fn list(
    db: &PgPool,
    actor: &Actor,
    branch_id: Uuid,
    query: &GroupQuery,
    page: &PageParams,
) -> AppResult<Page<Group>> {
    authorize(actor, Action::ViewGroups { branch_id })?;
    let limit = page.limit()?;
    let after: Option<(String, Uuid)> = page.cursor()?;
    let (after_name, after_id) = after.unzip();
    let rows = sqlx::query_as!(
        Group,
        r#"
        SELECT g.id, g.branch_id, g.name, g.description, g.is_default, g.archived_at, g.created_at,
               (SELECT count(*) FROM group_member gm WHERE gm.group_id = g.id) AS "member_count!"
        FROM user_group g
        WHERE g.branch_id = $1
          AND ($2 OR g.archived_at IS NULL)
          AND ($3::text IS NULL OR (lower(g.name), g.id) > ($3, $4))
        ORDER BY lower(g.name), g.id
        LIMIT $5
        "#,
        branch_id,
        query.include_archived,
        after_name,
        after_id,
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |g| (g.name.to_lowercase(), g.id)))
}

async fn fetch(tx: &mut Tx, group_id: Uuid) -> AppResult<Group> {
    Ok(sqlx::query_as!(
        Group,
        r#"
        SELECT g.id, g.branch_id, g.name, g.description, g.is_default, g.archived_at, g.created_at,
               (SELECT count(*) FROM group_member gm WHERE gm.group_id = g.id) AS "member_count!"
        FROM user_group g WHERE g.id = $1
        "#,
        group_id
    )
    .fetch_one(&mut **tx)
    .await?)
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewGroup {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create(db: &PgPool, actor: &Actor, branch_id: Uuid, input: NewGroup) -> AppResult<Group> {
    authorize(actor, Action::ManageGroups { branch_id })?;
    let name = validate_group_name(&input.name)?;
    let description = input.description.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty());

    let mut tx = db.begin().await?;
    let group_id = sqlx::query_scalar!(
        "INSERT INTO user_group (branch_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
        branch_id,
        name,
        description,
        actor.user_id
    )
    .fetch_one(&mut *tx)
    .await?;
    audit_group(
        &mut tx,
        actor,
        branch_id,
        group_id,
        "create",
        None,
        json!({ "name": name, "description": description }),
    )
    .await?;
    emit_branch_event(&mut tx, "group_changed", branch_id, vec![]).await?;
    let group = fetch(&mut tx, group_id).await?;
    tx.commit().await?;
    Ok(group)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct GroupPatch {
    pub name: Option<String>,
    #[serde(default, with = "super::branches::double_option")]
    pub description: Option<Option<String>>,
    /// `true` archives, `false` restores.
    pub archived: Option<bool>,
}

pub async fn update(db: &PgPool, actor: &Actor, group_id: Uuid, patch: GroupPatch) -> AppResult<Group> {
    let group = load_managed(db, actor, group_id).await?;
    let name = patch.name.as_deref().map(validate_group_name).transpose()?;
    if group.is_default {
        if name.as_ref().is_some_and(|n| *n != group.name) {
            return Err(AppError::conflict("default_group", "the All members group can't be renamed"));
        }
        if patch.archived == Some(true) {
            return Err(AppError::conflict("default_group", "the All members group can't be archived"));
        }
    }

    let new_name = name.unwrap_or_else(|| group.name.clone());
    let new_description = match patch.description {
        Some(d) => d.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty()),
        None => group.description.clone(),
    };
    let was_archived = group.archived_at.is_some();
    let archived = patch.archived.unwrap_or(was_archived);

    let mut tx = db.begin().await?;
    sqlx::query!(
        r#"
        UPDATE user_group SET name = $2, description = $3,
               archived_at = CASE WHEN $4 THEN coalesce(archived_at, now()) ELSE NULL END
        WHERE id = $1
        "#,
        group_id,
        new_name,
        new_description,
        archived
    )
    .execute(&mut *tx)
    .await?;

    let mut old_v = serde_json::Map::new();
    let mut new_v = serde_json::Map::new();
    if new_name != group.name {
        old_v.insert("name".into(), json!(group.name));
        new_v.insert("name".into(), json!(new_name));
    }
    if new_description != group.description {
        old_v.insert("description".into(), json!(group.description));
        new_v.insert("description".into(), json!(new_description));
    }
    if archived != was_archived {
        old_v.insert("archived".into(), json!(was_archived));
        new_v.insert("archived".into(), json!(archived));
    }
    if !new_v.is_empty() {
        let action = match (was_archived, archived) {
            (false, true) => "archive",
            (true, false) => "restore",
            _ => "update",
        };
        audit_group(&mut tx, actor, group.branch_id, group_id, action, Some(old_v.into()), new_v.into()).await?;
        if archived != was_archived {
            // Archiving switches the group's grants off (or back on).
            permissions_changed(&mut tx, actor, group.branch_id, group_id, json!({ "group_id": group_id })).await?;
        } else {
            emit_branch_event(&mut tx, "group_changed", group.branch_id, vec![]).await?;
        }
    }
    let updated = fetch(&mut tx, group_id).await?;
    tx.commit().await?;
    Ok(updated)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeleteOutcome {
    /// `true`: the group was hard-deleted. `false`: it is referenced by issue
    /// targets, so it was archived instead.
    pub deleted: bool,
    pub archived: bool,
}

pub async fn delete(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<DeleteOutcome> {
    let group = load_managed(db, actor, group_id).await?;
    if group.is_default {
        return Err(AppError::conflict("default_group", "the All members group can't be deleted"));
    }

    let mut tx = db.begin().await?;
    sqlx::query_scalar!("SELECT id FROM user_group WHERE id = $1 FOR UPDATE", group_id).fetch_one(&mut *tx).await?;
    let referenced = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM issue_target WHERE group_id = $1) AS "referenced!""#,
        group_id
    )
    .fetch_one(&mut *tx)
    .await?;

    // Before any delete, so the event can still name the group's members.
    permissions_changed(
        &mut tx,
        actor,
        group.branch_id,
        group_id,
        json!({ "group_id": group_id, "group_name": group.name }),
    )
    .await?;

    let outcome = if referenced {
        sqlx::query!("UPDATE user_group SET archived_at = coalesce(archived_at, now()) WHERE id = $1", group_id)
            .execute(&mut *tx)
            .await?;
        if group.archived_at.is_none() {
            audit_group(
                &mut tx,
                actor,
                group.branch_id,
                group_id,
                "archive",
                Some(json!({ "archived": false })),
                json!({ "archived": true }),
            )
            .await?;
        }
        DeleteOutcome { deleted: false, archived: true }
    } else {
        sqlx::query!("DELETE FROM user_group WHERE id = $1", group_id).execute(&mut *tx).await?;
        audit_group(
            &mut tx,
            actor,
            group.branch_id,
            group_id,
            "delete",
            Some(json!({ "name": group.name })),
            json!(null),
        )
        .await?;
        DeleteOutcome { deleted: true, archived: false }
    };
    tx.commit().await?;
    Ok(outcome)
}

// ---------------------------------------------------------------------------
// Group members
// ---------------------------------------------------------------------------

pub async fn add_member(db: &PgPool, actor: &Actor, group_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let group = load_managed(db, actor, group_id).await?;
    if group.is_default {
        return Err(AppError::conflict("default_group", "membership of All members is automatic"));
    }
    if group.archived_at.is_some() {
        return Err(AppError::conflict("group_archived", "restore the group before adding members"));
    }

    let mut tx = db.begin().await?;
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM branch_membership
                          WHERE user_id = $1 AND branch_id = $2 AND left_at IS NULL) AS "m!""#,
        user_id,
        group.branch_id
    )
    .fetch_one(&mut *tx)
    .await?;
    if !is_member {
        return Err(AppError::conflict("not_a_member", "the user is not a current member of this branch"));
    }
    let inserted = sqlx::query!(
        r#"INSERT INTO group_member (group_id, user_id, branch_id, added_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING"#,
        group_id,
        user_id,
        group.branch_id,
        actor.user_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(()); // already in the group
    }

    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "group_member",
            entity_id: format!("{group_id}:{user_id}"),
            branch_id: Some(group.branch_id),
            actor_id: Some(actor.user_id),
            action: "add",
            old_value: None,
            new_value: Some(json!({ "group_id": group_id, "user_id": user_id })),
        },
    )
    .await?;
    let payload = json!({ "group_id": group_id, "group_name": group.name, "user_id": user_id });
    notifications::notify(
        &mut tx,
        &[user_id],
        Notice {
            kind: Kind::AddedToGroup,
            branch_id: Some(group.branch_id),
            issue_id: None,
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload: payload.clone(),
        },
    )
    .await?;
    notify_admins_permissions_changed(&mut tx, actor, group.branch_id, payload).await?;
    emit_branch_event(&mut tx, "permissions_changed", group.branch_id, vec![user_id]).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn remove_member(db: &PgPool, actor: &Actor, group_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let group = load_managed(db, actor, group_id).await?;
    if group.is_default {
        return Err(AppError::conflict("default_group", "membership of All members is automatic"));
    }
    let mut tx = db.begin().await?;
    let removed = sqlx::query!("DELETE FROM group_member WHERE group_id = $1 AND user_id = $2", group_id, user_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if removed == 0 {
        return Err(AppError::NotFound);
    }
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "group_member",
            entity_id: format!("{group_id}:{user_id}"),
            branch_id: Some(group.branch_id),
            actor_id: Some(actor.user_id),
            action: "remove",
            old_value: Some(json!({ "group_id": group_id, "user_id": user_id })),
            new_value: None,
        },
    )
    .await?;
    notify_admins_permissions_changed(
        &mut tx,
        actor,
        group.branch_id,
        json!({ "group_id": group_id, "group_name": group.name, "user_id": user_id, "removed": true }),
    )
    .await?;
    emit_branch_event(&mut tx, "permissions_changed", group.branch_id, vec![user_id]).await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct GroupGrant {
    pub id: Uuid,
    pub group_id: Uuid,
    pub permission: String,
    pub issue_type: Option<String>,
    pub scope: Scope,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub async fn list_grants(db: &PgPool, actor: &Actor, group_id: Uuid, page: &PageParams) -> AppResult<Page<GroupGrant>> {
    load_managed(db, actor, group_id).await?;
    let limit = page.limit()?;
    let after: Option<(String, Uuid)> = page.cursor()?;
    let (after_key, after_id) = after.unzip();
    let rows = sqlx::query_as!(
        GroupGrant,
        r#"
        SELECT gp.id, gp.group_id, gp.permission_key AS permission, t.code AS "issue_type?",
               gp.scope AS "scope: Scope", gp.created_at
        FROM group_permission gp
        LEFT JOIN issue_type t ON t.id = gp.issue_type_id
        WHERE gp.group_id = $1
          AND ($2::text IS NULL OR (gp.permission_key, gp.id) > ($2, $3))
        ORDER BY gp.permission_key, gp.id
        LIMIT $4
        "#,
        group_id,
        after_key,
        after_id,
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |g| (g.permission.clone(), g.id)))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewGrant {
    pub permission: String,
    pub issue_type: Option<String>,
    pub scope: String,
}

pub async fn grant(db: &PgPool, actor: &Actor, group_id: Uuid, input: NewGrant) -> AppResult<GroupGrant> {
    let group = load_managed(db, actor, group_id).await?;

    // Same checks as the schema trigger, with friendly errors.
    let permission = Permission::from_key(&input.permission).ok_or_else(|| {
        AppError::validation("unknown_permission", format!("unknown permission {:?}", input.permission))
    })?;
    let scope = match input.scope.as_str() {
        "own" => Scope::Own,
        "targeted" => Scope::Targeted,
        "branch" => Scope::Branch,
        other => return Err(AppError::validation("invalid_scope", format!("unknown scope {other:?}"))),
    };
    if !permission.allowed_scopes().contains(&scope) {
        let allowed: Vec<&str> = permission.allowed_scopes().iter().map(|s| s.as_str()).collect();
        return Err(AppError::validation(
            "invalid_scope",
            format!("{} allows scopes {}", permission.key(), allowed.join(", ")),
        ));
    }
    let issue_type = match input.issue_type.as_deref() {
        None => None,
        Some(code) => {
            let ty = IssueType::from_code(code)
                .ok_or_else(|| AppError::validation("invalid_issue_type", format!("unknown issue type {code:?}")))?;
            if !permission.per_issue_type() {
                return Err(AppError::validation(
                    "invalid_issue_type",
                    format!("{} can't be limited to an issue type", permission.key()),
                ));
            }
            Some(ty)
        }
    };

    let mut tx = db.begin().await?;
    let grant_id = sqlx::query_scalar!(
        r#"
        INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope, granted_by)
        VALUES ($1, $2, (SELECT id FROM issue_type WHERE code = $3), $4, $5)
        RETURNING id
        "#,
        group_id,
        permission.key(),
        issue_type.map(IssueType::code),
        scope as Scope,
        actor.user_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    let value = json!({
        "group_id": group_id, "permission": permission.key(),
        "issue_type": issue_type.map(IssueType::code), "scope": scope.as_str(),
    });
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "group_permission",
            entity_id: grant_id.to_string(),
            branch_id: Some(group.branch_id),
            actor_id: Some(actor.user_id),
            action: "grant",
            old_value: None,
            new_value: Some(value.clone()),
        },
    )
    .await?;
    permissions_changed(&mut tx, actor, group.branch_id, group_id, value).await?;

    let row = sqlx::query_as!(
        GroupGrant,
        r#"SELECT gp.id, gp.group_id, gp.permission_key AS permission, t.code AS "issue_type?",
                  gp.scope AS "scope: Scope", gp.created_at
           FROM group_permission gp LEFT JOIN issue_type t ON t.id = gp.issue_type_id WHERE gp.id = $1"#,
        grant_id
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn revoke(db: &PgPool, actor: &Actor, grant_id: Uuid) -> AppResult<()> {
    let row = sqlx::query!(
        r#"SELECT gp.group_id, gp.permission_key, t.code AS "issue_type?", gp.scope AS "scope: Scope"
           FROM group_permission gp LEFT JOIN issue_type t ON t.id = gp.issue_type_id WHERE gp.id = $1"#,
        grant_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    let group = load_managed(db, actor, row.group_id).await?;

    let mut tx = db.begin().await?;
    let deleted =
        sqlx::query!("DELETE FROM group_permission WHERE id = $1", grant_id).execute(&mut *tx).await?.rows_affected();
    if deleted == 0 {
        return Err(AppError::NotFound);
    }
    let value = json!({
        "group_id": row.group_id, "permission": row.permission_key,
        "issue_type": row.issue_type, "scope": row.scope.as_str(),
    });
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "group_permission",
            entity_id: grant_id.to_string(),
            branch_id: Some(group.branch_id),
            actor_id: Some(actor.user_id),
            action: "revoke",
            old_value: Some(value.clone()),
            new_value: None,
        },
    )
    .await?;
    permissions_changed(&mut tx, actor, group.branch_id, row.group_id, value).await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct EffectivePermissions {
    pub user_id: Uuid,
    pub branch_id: Uuid,
    /// Admins can do everything except super admin actions, whatever their groups grant.
    pub is_admin: bool,
    pub grants: Vec<SourcedGrant>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SourcedGrant {
    pub permission: String,
    pub issue_type: Option<String>,
    pub scope: Scope,
    pub group: GroupRef,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct GroupRef {
    pub id: Uuid,
    pub name: String,
}

pub async fn effective_permissions(
    db: &PgPool,
    actor: &Actor,
    branch_id: Uuid,
    user_id: Uuid,
) -> AppResult<EffectivePermissions> {
    authorize(actor, Action::ViewEffectivePermissions { branch_id, user_id })?;
    let is_admin = sqlx::query_scalar!(
        "SELECT is_admin FROM branch_membership WHERE user_id = $1 AND branch_id = $2 AND left_at IS NULL",
        user_id,
        branch_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;

    // Same sources as Actor::load: active groups only.
    let rows = sqlx::query!(
        r#"
        SELECT gp.permission_key, t.code AS "issue_type?", gp.scope AS "scope: Scope", g.id AS group_id, g.name
        FROM group_member gm
        JOIN user_group g        ON g.id = gm.group_id AND g.archived_at IS NULL
        JOIN group_permission gp ON gp.group_id = g.id
        LEFT JOIN issue_type t   ON t.id = gp.issue_type_id
        WHERE gm.user_id = $1 AND gm.branch_id = $2
        ORDER BY gp.permission_key, t.code NULLS FIRST, gp.scope, g.name
        "#,
        user_id,
        branch_id
    )
    .fetch_all(db)
    .await?;

    Ok(EffectivePermissions {
        user_id,
        branch_id,
        is_admin,
        grants: rows
            .into_iter()
            .map(|r| SourcedGrant {
                permission: r.permission_key,
                issue_type: r.issue_type,
                scope: r.scope,
                group: GroupRef { id: r.group_id, name: r.name },
            })
            .collect(),
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// A grant change: notify the branch admins and push a `permissions_changed`
/// event naming every member of the group, so their streams refresh.
async fn permissions_changed(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    group_id: Uuid,
    payload: serde_json::Value,
) -> AppResult<()> {
    notify_admins_permissions_changed(tx, actor, branch_id, payload).await?;
    let members = sqlx::query_scalar!("SELECT user_id FROM group_member WHERE group_id = $1", group_id)
        .fetch_all(&mut **tx)
        .await?;
    emit_branch_event(tx, "permissions_changed", branch_id, members).await
}

async fn notify_admins_permissions_changed(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    payload: serde_json::Value,
) -> AppResult<()> {
    let admins = notifications::branch_admins(tx, branch_id).await?;
    notifications::notify(
        tx,
        &admins,
        Notice {
            kind: Kind::PermissionsChanged,
            branch_id: Some(branch_id),
            issue_id: None,
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload,
        },
    )
    .await
}

async fn audit_group(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    group_id: Uuid,
    action: &'static str,
    old_value: Option<serde_json::Value>,
    new_value: serde_json::Value,
) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "user_group",
            entity_id: group_id.to_string(),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value: if new_value.is_null() { None } else { Some(new_value) },
        },
    )
    .await
}

fn validate_group_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::validation("invalid_name", "group name must be between 1 and 100 characters"));
    }
    Ok(name.to_owned())
}
