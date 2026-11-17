//! Departments: the business units of a branch (IT, Health, Teachers).
//! Issues are sent to them, their members get them, and their heads run the
//! work sent to them. What members may do comes from the permission groups
//! attached to the department (see `permission_groups`); a department holds
//! no permissions itself.

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{types::Json, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::emit_branch_event,
    notifications::{self, Kind, Notice},
};
use crate::{
    authz::{authorize, Action, Actor},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Department {
    pub id: Uuid,
    pub branch_id: Uuid,
    pub name: String,
    pub description: Option<String>,
    /// The branch's "All members": everyone in it, automatically.
    pub is_default: bool,
    pub member_ids: Vec<Uuid>,
    /// Who runs the department (some of `member_ids`).
    pub head_ids: Vec<Uuid>,
    /// The permission groups whose grants its members get.
    #[schema(value_type = Vec<PermissionGroupRef>)]
    pub permission_groups: Json<Vec<PermissionGroupRef>>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct PermissionGroupRef {
    pub id: Uuid,
    pub name: String,
    /// School-wide (set up by root users) rather than the branch's own.
    pub school_wide: bool,
}

/// The row facts every department operation starts from.
struct DepartmentRow {
    branch_id: Uuid,
    name: String,
    description: Option<String>,
    is_default: bool,
    archived_at: Option<OffsetDateTime>,
}

async fn load(db: &PgPool, department_id: Uuid) -> AppResult<DepartmentRow> {
    sqlx::query_as!(
        DepartmentRow,
        "SELECT branch_id, name, description, is_default, archived_at FROM department WHERE id = $1",
        department_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)
}

/// Loads the department and checks the right to manage it. Departments in
/// branches the actor isn't in are 404.
async fn load_managed(db: &PgPool, actor: &Actor, department_id: Uuid) -> AppResult<DepartmentRow> {
    let department = load(db, department_id).await?;
    authorize(actor, Action::ManageDepartments { branch_id: department.branch_id })?;
    Ok(department)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct DepartmentQuery {
    #[serde(default)]
    pub include_archived: bool,
}

pub async fn list(
    db: &PgPool,
    actor: &Actor,
    branch_id: Uuid,
    query: &DepartmentQuery,
    page: &PageParams,
) -> AppResult<Page<Department>> {
    authorize(actor, Action::ViewDepartments { branch_id })?;
    let limit = page.limit()?;
    let after: Option<(String, Uuid)> = page.cursor()?;
    let (after_name, after_id) = after.unzip();
    let rows = sqlx::query_as!(
        Department,
        r#"
        SELECT d.id, d.branch_id, d.name, d.description, d.is_default, d.archived_at, d.created_at,
               ARRAY(SELECT m.user_id FROM department_member m WHERE m.department_id = d.id ORDER BY m.user_id) AS "member_ids!",
               ARRAY(SELECT m.user_id FROM department_member m WHERE m.department_id = d.id AND m.is_head ORDER BY m.user_id) AS "head_ids!",
               (SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'school_wide', g.branch_id IS NULL)
                                          ORDER BY lower(g.name)), '[]')
                FROM department_permission_group x JOIN permission_group g ON g.id = x.group_id
                WHERE x.department_id = d.id) AS "permission_groups!: Json<Vec<PermissionGroupRef>>"
        FROM department d
        WHERE d.branch_id = $1
          AND ($2 OR d.archived_at IS NULL)
          AND ($3::text IS NULL OR (lower(d.name), d.id) > ($3, $4))
        ORDER BY lower(d.name), d.id
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
    Ok(Page::from_rows(rows, limit, |d| (d.name.to_lowercase(), d.id)))
}

async fn fetch(tx: &mut Tx, department_id: Uuid) -> AppResult<Department> {
    Ok(sqlx::query_as!(
        Department,
        r#"
        SELECT d.id, d.branch_id, d.name, d.description, d.is_default, d.archived_at, d.created_at,
               ARRAY(SELECT m.user_id FROM department_member m WHERE m.department_id = d.id ORDER BY m.user_id) AS "member_ids!",
               ARRAY(SELECT m.user_id FROM department_member m WHERE m.department_id = d.id AND m.is_head ORDER BY m.user_id) AS "head_ids!",
               (SELECT coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'school_wide', g.branch_id IS NULL)
                                          ORDER BY lower(g.name)), '[]')
                FROM department_permission_group x JOIN permission_group g ON g.id = x.group_id
                WHERE x.department_id = d.id) AS "permission_groups!: Json<Vec<PermissionGroupRef>>"
        FROM department d WHERE d.id = $1
        "#,
        department_id
    )
    .fetch_one(&mut **tx)
    .await?)
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewDepartment {
    pub name: String,
    pub description: Option<String>,
}

pub async fn create(db: &PgPool, actor: &Actor, branch_id: Uuid, input: NewDepartment) -> AppResult<Department> {
    authorize(actor, Action::ManageDepartments { branch_id })?;
    let name = validate_name(&input.name)?;
    let description = clean_description(input.description);

    let mut tx = db.begin().await?;
    let id = sqlx::query_scalar!(
        "INSERT INTO department (branch_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
        branch_id,
        name,
        description,
        actor.user_id
    )
    .fetch_one(&mut *tx)
    .await?;
    audit_department(
        &mut tx,
        actor,
        branch_id,
        id,
        "create",
        None,
        json!({ "name": name, "description": description }),
    )
    .await?;
    emit_branch_event(&mut tx, "department_changed", branch_id, vec![]).await?;
    let department = fetch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(department)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct DepartmentPatch {
    pub name: Option<String>,
    #[serde(default, with = "super::branches::double_option")]
    pub description: Option<Option<String>>,
    /// `true` archives, `false` restores.
    pub archived: Option<bool>,
}

pub async fn update(db: &PgPool, actor: &Actor, department_id: Uuid, patch: DepartmentPatch) -> AppResult<Department> {
    let department = load_managed(db, actor, department_id).await?;
    let name = patch.name.as_deref().map(validate_name).transpose()?;
    if department.is_default {
        if name.as_ref().is_some_and(|n| *n != department.name) {
            return Err(AppError::conflict("default_department", "\"All members\" can't be renamed"));
        }
        if patch.archived == Some(true) {
            return Err(AppError::conflict("default_department", "\"All members\" can't be archived"));
        }
    }
    let new_name = name.unwrap_or_else(|| department.name.clone());
    let new_description = match patch.description {
        Some(d) => clean_description(d),
        None => department.description.clone(),
    };
    let was_archived = department.archived_at.is_some();
    let archived = patch.archived.unwrap_or(was_archived);

    let mut tx = db.begin().await?;
    sqlx::query!(
        r#"
        UPDATE department SET name = $2, description = $3,
               archived_at = CASE WHEN $4 THEN coalesce(archived_at, now()) ELSE NULL END
        WHERE id = $1
        "#,
        department_id,
        new_name,
        new_description,
        archived,
    )
    .execute(&mut *tx)
    .await?;

    let mut old_v = serde_json::Map::new();
    let mut new_v = serde_json::Map::new();
    if new_name != department.name {
        old_v.insert("name".into(), json!(department.name));
        new_v.insert("name".into(), json!(new_name));
    }
    if new_description != department.description {
        old_v.insert("description".into(), json!(department.description));
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
        audit_department(&mut tx, actor, department.branch_id, department_id, action, Some(old_v.into()), new_v.into())
            .await?;
        // Archiving switches its members' permissions off (or back on). A
        // rename can change which `department.members.manage` grants match.
        let members = members_of(&mut tx, department_id).await?;
        emit_branch_event(&mut tx, "permissions_changed", department.branch_id, members).await?;
        emit_branch_event(&mut tx, "department_changed", department.branch_id, vec![]).await?;
    }
    let updated = fetch(&mut tx, department_id).await?;
    tx.commit().await?;
    Ok(updated)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DeleteOutcome {
    /// `true`: the department was hard-deleted. `false`: issues were sent to
    /// it, so it was archived instead.
    pub deleted: bool,
    pub archived: bool,
}

pub async fn delete(db: &PgPool, actor: &Actor, department_id: Uuid) -> AppResult<DeleteOutcome> {
    let department = load_managed(db, actor, department_id).await?;
    if department.is_default {
        return Err(AppError::conflict("default_department", "\"All members\" can't be deleted"));
    }

    let mut tx = db.begin().await?;
    sqlx::query_scalar!("SELECT id FROM department WHERE id = $1 FOR UPDATE", department_id)
        .fetch_one(&mut *tx)
        .await?;
    let referenced = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM issue_target WHERE department_id = $1) AS "referenced!""#,
        department_id
    )
    .fetch_one(&mut *tx)
    .await?;
    // Before any delete, so the event can still name the members.
    let members = members_of(&mut tx, department_id).await?;
    emit_branch_event(&mut tx, "permissions_changed", department.branch_id, members).await?;
    emit_branch_event(&mut tx, "department_changed", department.branch_id, vec![]).await?;

    let outcome = if referenced {
        sqlx::query!("UPDATE department SET archived_at = coalesce(archived_at, now()) WHERE id = $1", department_id)
            .execute(&mut *tx)
            .await?;
        if department.archived_at.is_none() {
            let (old, new) = (json!({ "archived": false }), json!({ "archived": true }));
            audit_department(&mut tx, actor, department.branch_id, department_id, "archive", Some(old), new).await?;
        }
        DeleteOutcome { deleted: false, archived: true }
    } else {
        sqlx::query!("DELETE FROM department WHERE id = $1", department_id).execute(&mut *tx).await?;
        let old = json!({ "name": department.name });
        audit_department(&mut tx, actor, department.branch_id, department_id, "delete", Some(old), json!(null)).await?;
        DeleteOutcome { deleted: true, archived: false }
    };
    tx.commit().await?;
    Ok(outcome)
}

// ---------------------------------------------------------------------------
// Members and heads
// ---------------------------------------------------------------------------

/// Adding people needs `department.members.manage` for this department (or
/// `department.manage`, or being a branch admin).
async fn load_for_members(db: &PgPool, actor: &Actor, department_id: Uuid) -> AppResult<DepartmentRow> {
    let department = load(db, department_id).await?;
    let branch_id = department.branch_id;
    let may = authorize(actor, Action::ManageDepartments { branch_id })
        .or_else(|_| authorize(actor, Action::ManageDepartmentMembers { branch_id, department: &department.name }));
    may?;
    if department.is_default {
        return Err(AppError::conflict("default_department", "everyone in the branch is in \"All members\""));
    }
    Ok(department)
}

pub async fn add_member(db: &PgPool, actor: &Actor, department_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let department = load_for_members(db, actor, department_id).await?;
    if department.archived_at.is_some() {
        return Err(AppError::conflict("department_archived", "restore the department before adding people"));
    }
    let branch_id = department.branch_id;

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
        r#"INSERT INTO department_member (department_id, user_id, branch_id, added_by) VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING"#,
        department_id,
        user_id,
        branch_id,
        actor.user_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        return Ok(()); // already in it
    }

    audit_member(&mut tx, actor, branch_id, department_id, user_id, "add", None, Some(json!({ "is_head": false })))
        .await?;
    let payload = json!({ "department_id": department_id, "department_name": department.name, "user_id": user_id });
    notifications::notify(
        &mut tx,
        &[user_id],
        Notice {
            kind: Kind::AddedToDepartment,
            branch_id: Some(branch_id),
            issue_id: None,
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload: payload.clone(),
        },
    )
    .await?;
    // Their permissions grew by the department's permission groups.
    if has_permission_groups(&mut tx, department_id).await? {
        notify_admins_permissions_changed(&mut tx, actor, branch_id, payload).await?;
    }
    emit_branch_event(&mut tx, "permissions_changed", branch_id, vec![user_id]).await?;
    emit_branch_event(&mut tx, "department_changed", branch_id, vec![]).await?;
    tx.commit().await?;
    Ok(())
}

/// Removing a head takes `department.manage`: heads can't remove each other.
pub async fn remove_member(db: &PgPool, actor: &Actor, department_id: Uuid, user_id: Uuid) -> AppResult<()> {
    let department = load_for_members(db, actor, department_id).await?;
    let branch_id = department.branch_id;
    let mut tx = db.begin().await?;
    let was_head = sqlx::query_scalar!(
        "DELETE FROM department_member WHERE department_id = $1 AND user_id = $2 RETURNING is_head",
        department_id,
        user_id
    )
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(AppError::NotFound)?;
    if was_head {
        authorize(actor, Action::ManageDepartments { branch_id })?;
    }
    audit_member(
        &mut tx,
        actor,
        branch_id,
        department_id,
        user_id,
        "remove",
        Some(json!({ "is_head": was_head })),
        None,
    )
    .await?;
    if has_permission_groups(&mut tx, department_id).await? {
        let payload = json!({ "department_id": department_id, "department_name": department.name, "user_id": user_id, "removed": true });
        notify_admins_permissions_changed(&mut tx, actor, branch_id, payload).await?;
    }
    emit_branch_event(&mut tx, "permissions_changed", branch_id, vec![user_id]).await?;
    emit_branch_event(&mut tx, "department_changed", branch_id, vec![]).await?;
    tx.commit().await?;
    Ok(())
}

/// Makes a member one of the department's heads, or not.
pub async fn set_head(db: &PgPool, actor: &Actor, department_id: Uuid, user_id: Uuid, head: bool) -> AppResult<()> {
    let department = load_managed(db, actor, department_id).await?;
    if department.is_default {
        return Err(AppError::conflict("default_department", "\"All members\" has no heads"));
    }
    let mut tx = db.begin().await?;
    let changed = sqlx::query!(
        "UPDATE department_member SET is_head = $3 WHERE department_id = $1 AND user_id = $2 AND is_head <> $3",
        department_id,
        user_id,
        head
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed == 0 {
        let member = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM department_member WHERE department_id = $1 AND user_id = $2) AS "m!""#,
            department_id,
            user_id
        )
        .fetch_one(&mut *tx)
        .await?;
        return if member {
            Ok(())
        } else {
            Err(AppError::conflict("not_a_member", "make them a member of the department first"))
        };
    }
    let action = if head { "make_head" } else { "remove_head" };
    let (old, new) = (json!({ "is_head": !head }), json!({ "is_head": head }));
    audit_member(&mut tx, actor, department.branch_id, department_id, user_id, action, Some(old), Some(new)).await?;
    emit_branch_event(&mut tx, "permissions_changed", department.branch_id, vec![user_id]).await?;
    emit_branch_event(&mut tx, "department_changed", department.branch_id, vec![]).await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub(crate) async fn members_of(tx: &mut Tx, department_id: Uuid) -> AppResult<Vec<Uuid>> {
    Ok(sqlx::query_scalar!("SELECT user_id FROM department_member WHERE department_id = $1", department_id)
        .fetch_all(&mut **tx)
        .await?)
}

async fn has_permission_groups(tx: &mut Tx, department_id: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM department_permission_group WHERE department_id = $1) AS "x!""#,
        department_id
    )
    .fetch_one(&mut **tx)
    .await?)
}

/// Tells the branch's admins that someone's permissions changed.
pub(crate) async fn notify_admins_permissions_changed(
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

async fn audit_department(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    department_id: Uuid,
    action: &'static str,
    old_value: Option<serde_json::Value>,
    new_value: serde_json::Value,
) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "department",
            entity_id: department_id.to_string(),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value: if new_value.is_null() { None } else { Some(new_value) },
        },
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn audit_member(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    department_id: Uuid,
    user_id: Uuid,
    action: &'static str,
    old_value: Option<serde_json::Value>,
    new_value: Option<serde_json::Value>,
) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "department_member",
            entity_id: format!("{department_id}:{user_id}"),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value,
        },
    )
    .await
}

fn clean_description(description: Option<String>) -> Option<String> {
    description.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty())
}

fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::validation("invalid_name", "a department's name must be between 1 and 100 characters"));
    }
    Ok(name.to_owned())
}
