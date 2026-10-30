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
    realtime,
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Group {
    pub id: Uuid,
    /// `null`: a school-wide group (super admins only). It has no members of
    /// its own: every branch has a copy of it, with the same grants.
    pub branch_id: Option<Uuid>,
    /// On a branch group: the school-wide group it's a copy of. Its name,
    /// grants and archiving follow that group; branch admins choose members.
    pub template_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    pub is_default: bool,
    /// For a school-wide group: the members of all its branch copies.
    pub member_count: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// The row facts every group operation starts from.
struct GroupRow {
    branch_id: Option<Uuid>,
    template_id: Option<Uuid>,
    name: String,
    description: Option<String>,
    is_default: bool,
    archived_at: Option<OffsetDateTime>,
}

/// `ManageGroups` in the branch, or `ManageSchoolGroups` for school-wide groups.
fn authorize_manage(actor: &Actor, branch_id: Option<Uuid>) -> AppResult<()> {
    Ok(match branch_id {
        Some(branch_id) => authorize(actor, Action::ManageGroups { branch_id })?,
        None => authorize(actor, Action::ManageSchoolGroups)?,
    })
}

/// Loads the group and checks the right to manage it. Groups in branches
/// the actor can't see are 404.
async fn load_managed(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<GroupRow> {
    let group = sqlx::query_as!(
        GroupRow,
        "SELECT branch_id, template_id, name, description, is_default, archived_at FROM user_group WHERE id = $1",
        group_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    authorize_manage(actor, group.branch_id)?;
    Ok(group)
}

fn managed_by_template() -> AppError {
    AppError::conflict(
        "managed_by_template",
        "this group is set up for every branch by the school office; change it in the school-wide group",
    )
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
        SELECT g.id, g.branch_id, g.template_id, g.name, g.description, g.is_default, g.archived_at, g.created_at,
               (SELECT count(*) FROM group_member gm JOIN user_group c ON c.id = gm.group_id
                WHERE c.id = g.id OR c.template_id = g.id) AS "member_count!"
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

/// School-wide groups (super admins only). Not paged: there are few.
pub async fn list_school(db: &PgPool, actor: &Actor, query: &GroupQuery) -> AppResult<Vec<Group>> {
    authorize(actor, Action::ManageSchoolGroups)?;
    Ok(sqlx::query_as!(
        Group,
        r#"
        SELECT g.id, g.branch_id, g.template_id, g.name, g.description, g.is_default, g.archived_at, g.created_at,
               (SELECT count(*) FROM group_member gm JOIN user_group c ON c.id = gm.group_id
                WHERE c.id = g.id OR c.template_id = g.id) AS "member_count!"
        FROM user_group g
        WHERE g.branch_id IS NULL AND ($1 OR g.archived_at IS NULL)
        ORDER BY lower(g.name), g.id
        "#,
        query.include_archived,
    )
    .fetch_all(db)
    .await?)
}

async fn fetch(tx: &mut Tx, group_id: Uuid) -> AppResult<Group> {
    Ok(sqlx::query_as!(
        Group,
        r#"
        SELECT g.id, g.branch_id, g.template_id, g.name, g.description, g.is_default, g.archived_at, g.created_at,
               (SELECT count(*) FROM group_member gm JOIN user_group c ON c.id = gm.group_id
                WHERE c.id = g.id OR c.template_id = g.id) AS "member_count!"
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

/// `branch_id` `None` creates a school-wide group, and its copy in every
/// active branch (adopting a same-named group where one exists).
pub async fn create(db: &PgPool, actor: &Actor, branch_id: Option<Uuid>, input: NewGroup) -> AppResult<Group> {
    authorize_manage(actor, branch_id)?;
    let name = validate_group_name(&input.name)?;
    if branch_id.is_none() {
        validate_template_name(&name)?;
    }
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
    emit_group_event(&mut tx, "group_changed", branch_id, vec![]).await?;
    if branch_id.is_none() {
        let copied = sqlx::query!(
            r#"SELECT b.id AS branch_id, copy_group_template($1, b.id) AS "copy_id!" FROM branch b WHERE b.is_active"#,
            group_id
        )
        .fetch_all(&mut *tx)
        .await?;
        for c in copied {
            audit_group(
                &mut tx,
                actor,
                Some(c.branch_id),
                c.copy_id,
                "link_template",
                None,
                json!({ "template_id": group_id }),
            )
            .await?;
            emit_branch_event(&mut tx, "group_changed", c.branch_id, vec![]).await?;
        }
    }
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

/// On a school-wide group, the change carries over to every branch copy.
pub async fn update(db: &PgPool, actor: &Actor, group_id: Uuid, patch: GroupPatch) -> AppResult<Group> {
    let group = load_managed(db, actor, group_id).await?;
    if group.template_id.is_some() {
        return Err(managed_by_template());
    }
    let name = patch.name.as_deref().map(validate_group_name).transpose()?;
    if group.branch_id.is_none() {
        name.as_deref().map(validate_template_name).transpose()?;
    }
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
        audit_group(
            &mut tx,
            actor,
            group.branch_id,
            group_id,
            action,
            Some(old_v.clone().into()),
            new_v.clone().into(),
        )
        .await?;
        if archived != was_archived {
            // Archiving switches the group's grants off (or back on).
            permissions_changed(&mut tx, actor, group.branch_id, group_id, json!({ "group_id": group_id })).await?;
        } else {
            emit_group_event(&mut tx, "group_changed", group.branch_id, vec![]).await?;
        }
        if group.branch_id.is_none() {
            let copies = sqlx::query!(
                r#"
                UPDATE user_group SET name = $2, description = $3,
                       archived_at = CASE WHEN $4 THEN coalesce(archived_at, now()) ELSE NULL END
                WHERE template_id = $1
                RETURNING id, branch_id AS "branch_id!"
                "#,
                group_id,
                new_name,
                new_description,
                archived
            )
            .fetch_all(&mut *tx)
            .await?;
            for c in copies {
                audit_group(
                    &mut tx,
                    actor,
                    Some(c.branch_id),
                    c.id,
                    action,
                    Some(old_v.clone().into()),
                    new_v.clone().into(),
                )
                .await?;
                if archived != was_archived {
                    let payload = json!({ "group_id": c.id, "group_name": new_name });
                    permissions_changed(&mut tx, actor, Some(c.branch_id), c.id, payload).await?;
                } else {
                    emit_branch_event(&mut tx, "group_changed", c.branch_id, vec![]).await?;
                }
            }
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

/// Deleting a school-wide group leaves its copies as ordinary branch groups,
/// with their members and grants.
pub async fn delete(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<DeleteOutcome> {
    let group = load_managed(db, actor, group_id).await?;
    if group.is_default {
        return Err(AppError::conflict("default_group", "the All members group can't be deleted"));
    }
    if group.template_id.is_some() {
        return Err(managed_by_template());
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
    let Some(branch_id) = group.branch_id else {
        return Err(AppError::conflict(
            "school_group_has_no_members",
            "add people to this group's copy in each branch",
        ));
    };

    let mut tx = db.begin().await?;
    let is_member = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM branch_membership
                          WHERE user_id = $1 AND branch_id = $2 AND left_at IS NULL) AS "m!""#,
        user_id,
        branch_id
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
        branch_id,
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
            branch_id: group.branch_id,
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
            branch_id: group.branch_id,
            issue_id: None,
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload: payload.clone(),
        },
    )
    .await?;
    notify_admins_permissions_changed(&mut tx, actor, group.branch_id, payload).await?;
    emit_group_event(&mut tx, "permissions_changed", group.branch_id, vec![user_id]).await?;
    tx.commit().await?;
    Ok(())
}

/// A school-wide group's copies, one per branch.
pub async fn copies(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<Vec<Group>> {
    let group = load_managed(db, actor, group_id).await?;
    if group.branch_id.is_some() {
        return Err(AppError::NotFound);
    }
    Ok(sqlx::query_as!(
        Group,
        r#"
        SELECT g.id, g.branch_id, g.template_id, g.name, g.description, g.is_default, g.archived_at, g.created_at,
               (SELECT count(*) FROM group_member gm WHERE gm.group_id = g.id) AS "member_count!"
        FROM user_group g JOIN branch b ON b.id = g.branch_id
        WHERE g.template_id = $1
        ORDER BY lower(b.name), b.id
        "#,
        group_id
    )
    .fetch_all(db)
    .await?)
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
            branch_id: group.branch_id,
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
    emit_group_event(&mut tx, "permissions_changed", group.branch_id, vec![user_id]).await?;
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

/// A checked grant: the permission, its issue type (`None` = all) and scope.
type GrantSpec = (Permission, Option<IssueType>, Scope);

/// Same checks as the schema trigger, with friendly errors.
fn parse_grant(input: &NewGrant) -> AppResult<GrantSpec> {
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
    Ok((permission, issue_type, scope))
}

/// Inserts and audits one grant. Notifying is the caller's job.
async fn insert_grant(
    tx: &mut Tx,
    actor: &Actor,
    group_id: Uuid,
    branch_id: Option<Uuid>,
    (permission, issue_type, scope): GrantSpec,
) -> AppResult<Uuid> {
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
    .fetch_one(&mut **tx)
    .await?;
    let value = json!({
        "group_id": group_id, "permission": permission.key(),
        "issue_type": issue_type.map(IssueType::code), "scope": scope.as_str(),
    });
    audit::record(
        tx,
        AuditEntry {
            entity_type: "group_permission",
            entity_id: grant_id.to_string(),
            branch_id,
            actor_id: Some(actor.user_id),
            action: "grant",
            old_value: None,
            new_value: Some(value),
        },
    )
    .await?;
    Ok(grant_id)
}

/// Deletes and audits one grant of the group. Returns its permission key.
async fn delete_grant(
    tx: &mut Tx,
    actor: &Actor,
    group_id: Uuid,
    branch_id: Option<Uuid>,
    grant_id: Uuid,
) -> AppResult<String> {
    let row = sqlx::query!(
        r#"DELETE FROM group_permission gp WHERE gp.id = $1 AND gp.group_id = $2
           RETURNING gp.permission_key, (SELECT code FROM issue_type WHERE id = gp.issue_type_id) AS "issue_type?",
                     gp.scope AS "scope: Scope""#,
        grant_id,
        group_id
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AppError::NotFound)?;
    audit::record(
        tx,
        AuditEntry {
            entity_type: "group_permission",
            entity_id: grant_id.to_string(),
            branch_id,
            actor_id: Some(actor.user_id),
            action: "revoke",
            old_value: Some(json!({
                "group_id": group_id, "permission": row.permission_key,
                "issue_type": row.issue_type, "scope": row.scope.as_str(),
            })),
            new_value: None,
        },
    )
    .await?;
    Ok(row.permission_key)
}

async fn fetch_grant(tx: &mut Tx, grant_id: Uuid) -> AppResult<GroupGrant> {
    Ok(sqlx::query_as!(
        GroupGrant,
        r#"SELECT gp.id, gp.group_id, gp.permission_key AS permission, t.code AS "issue_type?",
                  gp.scope AS "scope: Scope", gp.created_at
           FROM group_permission gp LEFT JOIN issue_type t ON t.id = gp.issue_type_id WHERE gp.id = $1"#,
        grant_id
    )
    .fetch_one(&mut **tx)
    .await?)
}

pub async fn grant(db: &PgPool, actor: &Actor, group_id: Uuid, input: NewGrant) -> AppResult<GroupGrant> {
    let group = load_managed(db, actor, group_id).await?;
    if group.template_id.is_some() {
        return Err(managed_by_template());
    }
    let spec = parse_grant(&input)?;
    let mut tx = db.begin().await?;
    let grant_id = insert_grant(&mut tx, actor, group_id, group.branch_id, spec).await?;
    let payload = json!({ "group_id": group_id, "group_name": group.name, "granted": [spec.0.key()] });
    grants_changed(&mut tx, actor, &group, group_id, payload).await?;
    let row = fetch_grant(&mut tx, grant_id).await?;
    tx.commit().await?;
    Ok(row)
}

pub async fn revoke(db: &PgPool, actor: &Actor, grant_id: Uuid) -> AppResult<()> {
    let group_id = sqlx::query_scalar!("SELECT group_id FROM group_permission WHERE id = $1", grant_id)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    let group = load_managed(db, actor, group_id).await?;
    if group.template_id.is_some() {
        return Err(managed_by_template());
    }
    let mut tx = db.begin().await?;
    let key = delete_grant(&mut tx, actor, group_id, group.branch_id, grant_id).await?;
    let payload = json!({ "group_id": group_id, "group_name": group.name, "revoked": [key] });
    grants_changed(&mut tx, actor, &group, group_id, payload).await?;
    tx.commit().await?;
    Ok(())
}

/// Several grant changes saved together: all or nothing, one audit row per
/// grant, and a single notification and event (instead of one per change).
#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct GrantChanges {
    /// Grant ids of this group to remove.
    #[serde(default)]
    pub revoke: Vec<Uuid>,
    #[serde(default)]
    pub grant: Vec<NewGrant>,
}

pub async fn apply_grants(
    db: &PgPool,
    actor: &Actor,
    group_id: Uuid,
    changes: GrantChanges,
) -> AppResult<Vec<GroupGrant>> {
    let group = load_managed(db, actor, group_id).await?;
    if group.template_id.is_some() {
        return Err(managed_by_template());
    }
    let specs = changes.grant.iter().map(parse_grant).collect::<AppResult<Vec<_>>>()?;

    let mut tx = db.begin().await?;
    let mut revoked = Vec::new();
    for id in &changes.revoke {
        revoked.push(delete_grant(&mut tx, actor, group_id, group.branch_id, *id).await?);
    }
    let mut granted = Vec::new();
    for spec in &specs {
        insert_grant(&mut tx, actor, group_id, group.branch_id, *spec).await?;
        granted.push(spec.0.key());
    }
    if !revoked.is_empty() || !granted.is_empty() {
        revoked.sort();
        revoked.dedup();
        granted.sort();
        granted.dedup();
        let payload = json!({ "group_id": group_id, "group_name": group.name, "granted": granted, "revoked": revoked });
        grants_changed(&mut tx, actor, &group, group_id, payload).await?;
    }
    let rows = sqlx::query_as!(
        GroupGrant,
        r#"SELECT gp.id, gp.group_id, gp.permission_key AS permission, t.code AS "issue_type?",
                  gp.scope AS "scope: Scope", gp.created_at
           FROM group_permission gp LEFT JOIN issue_type t ON t.id = gp.issue_type_id
           WHERE gp.group_id = $1 ORDER BY gp.permission_key, gp.id"#,
        group_id
    )
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(rows)
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

/// After a group's grants changed: a branch group tells its branch; a
/// school-wide group passes its grants on to every copy, and each branch is
/// told about its own copy.
async fn grants_changed(
    tx: &mut Tx,
    actor: &Actor,
    group: &GroupRow,
    group_id: Uuid,
    payload: serde_json::Value,
) -> AppResult<()> {
    if group.branch_id.is_some() {
        return permissions_changed(tx, actor, group.branch_id, group_id, payload).await;
    }
    let copies =
        sqlx::query!(r#"SELECT id, branch_id AS "branch_id!" FROM user_group WHERE template_id = $1"#, group_id)
            .fetch_all(&mut **tx)
            .await?;
    sqlx::query!(
        "DELETE FROM group_permission WHERE group_id IN (SELECT id FROM user_group WHERE template_id = $1)",
        group_id
    )
    .execute(&mut **tx)
    .await?;
    sqlx::query!(
        r#"INSERT INTO group_permission (group_id, permission_key, issue_type_id, scope, granted_by)
           SELECT c.id, p.permission_key, p.issue_type_id, p.scope, $2
           FROM user_group c JOIN group_permission p ON p.group_id = $1
           WHERE c.template_id = $1"#,
        group_id,
        actor.user_id
    )
    .execute(&mut **tx)
    .await?;
    for c in copies {
        let mut payload = payload.clone();
        payload["group_id"] = json!(c.id);
        audit_group(tx, actor, Some(c.branch_id), c.id, "sync_permissions", None, json!({ "template_id": group_id }))
            .await?;
        permissions_changed(tx, actor, Some(c.branch_id), c.id, payload).await?;
    }
    Ok(())
}

/// A grant change: notify the branch admins and push a `permissions_changed`
/// event naming every member of the group, so their streams refresh.
async fn permissions_changed(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Option<Uuid>,
    group_id: Uuid,
    payload: serde_json::Value,
) -> AppResult<()> {
    notify_admins_permissions_changed(tx, actor, branch_id, payload).await?;
    let members = sqlx::query_scalar!("SELECT user_id FROM group_member WHERE group_id = $1", group_id)
        .fetch_all(&mut **tx)
        .await?;
    emit_group_event(tx, "permissions_changed", branch_id, members).await
}

/// Branch groups tell the branch's admins. School-wide groups are run by
/// super admins and recorded in the history; no one else is notified.
async fn notify_admins_permissions_changed(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Option<Uuid>,
    payload: serde_json::Value,
) -> AppResult<()> {
    let Some(branch_id) = branch_id else { return Ok(()) };
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

/// A branch event, or for a school-wide group one sent to `recipients` (and
/// super admins) only.
async fn emit_group_event(
    tx: &mut Tx,
    kind: &'static str,
    branch_id: Option<Uuid>,
    recipients: Vec<Uuid>,
) -> AppResult<()> {
    match branch_id {
        Some(b) => emit_branch_event(tx, kind, b, recipients).await,
        None => {
            realtime::emit(tx, realtime::Event { kind, issue_id: None, branch_ids: vec![], recipient_ids: recipients })
                .await
        }
    }
}

async fn audit_group(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Option<Uuid>,
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
            branch_id,
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value: if new_value.is_null() { None } else { Some(new_value) },
        },
    )
    .await
}

/// Copies sit next to each branch's "All members" group, so they can't share its name.
fn validate_template_name(name: &str) -> AppResult<()> {
    if name.eq_ignore_ascii_case("all members") {
        return Err(AppError::validation("invalid_name", "\"All members\" is taken by every branch's default group"));
    }
    Ok(())
}

fn validate_group_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::validation("invalid_name", "group name must be between 1 and 100 characters"));
    }
    Ok(name.to_owned())
}
