//! Permission groups: named sets of grants. A branch's admins make groups
//! for their branch; root users make school-wide ones, which any branch can
//! attach. Attached to a department, a group's grants apply to its members
//! in that branch. "Everyone", the school-wide default group, applies to
//! every user in every branch without being attached.
//!
//! Grants are always branch-wide: what users may do with their own issues
//! and with what's sent to them is the baseline (`authz::policy`).

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::{types::Json, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::emit_branch_event,
    departments::notify_admins_permissions_changed,
};
use crate::{
    authz::{authorize, Action, Actor, IssueType, Permission},
    db::Tx,
    error::{AppError, AppResult},
    realtime,
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct PermissionGroup {
    pub id: Uuid,
    /// `null`: school-wide (root users), attachable in every branch.
    pub branch_id: Option<Uuid>,
    pub name: String,
    pub description: Option<String>,
    /// "Everyone": applies to every user in every branch, unattached.
    pub is_default: bool,
    #[schema(value_type = Vec<GrantSpec>)]
    pub grants: Json<Vec<GrantSpec>>,
    /// The departments it's attached to (in the listed branch, or for root
    /// users' school-wide list, everywhere).
    pub department_ids: Vec<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// One grant: a permission, optionally for one issue type, or for
/// per-department permissions the department it covers.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, utoipa::ToSchema)]
pub struct GrantSpec {
    pub permission: String,
    /// `ticket`, `event` or `action`; absent = all types.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue_type: Option<String>,
    /// For `department.members.manage`: a department name, or `*` for every
    /// department of the branch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub department: Option<String>,
}

/// A checked grant.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct CheckedGrant {
    pub permission: Permission,
    pub issue_type: Option<IssueType>,
    pub department: Option<String>,
}

impl CheckedGrant {
    pub(crate) fn parse(spec: &GrantSpec) -> AppResult<Self> {
        let permission = Permission::from_key(&spec.permission).ok_or_else(|| {
            AppError::validation("unknown_permission", format!("unknown permission {:?}", spec.permission))
        })?;
        let issue_type = match spec.issue_type.as_deref() {
            None => None,
            Some(code) => {
                let ty = IssueType::from_code(code).ok_or_else(|| {
                    AppError::validation("invalid_issue_type", format!("unknown issue type {code:?}"))
                })?;
                if !permission.per_issue_type() {
                    return Err(AppError::validation(
                        "invalid_issue_type",
                        format!("{} can't be limited to an issue type", permission.key()),
                    ));
                }
                Some(ty)
            }
        };
        let department = spec.department.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(str::to_owned);
        match (permission.per_department(), &department) {
            (true, None) => {
                return Err(AppError::validation(
                    "department_required",
                    format!("{} needs a department (or \"*\" for all)", permission.key()),
                ))
            }
            (false, Some(_)) => {
                return Err(AppError::validation(
                    "invalid_department",
                    format!("{} isn't granted per department", permission.key()),
                ))
            }
            _ => {}
        }
        Ok(Self { permission, issue_type, department })
    }

    pub(crate) fn spec(&self) -> GrantSpec {
        GrantSpec {
            permission: self.permission.key().to_owned(),
            issue_type: self.issue_type.map(|t| t.code().to_owned()),
            department: self.department.clone(),
        }
    }
}

/// Parses, sorts and de-duplicates a list of grants.
pub(crate) fn parse_grants(specs: &[GrantSpec]) -> AppResult<Vec<CheckedGrant>> {
    let mut grants = specs.iter().map(CheckedGrant::parse).collect::<AppResult<Vec<_>>>()?;
    grants.sort();
    grants.dedup();
    Ok(grants)
}

struct GroupRow {
    branch_id: Option<Uuid>,
    name: String,
    description: Option<String>,
    is_default: bool,
}

/// Branch groups: `ManagePermissionGroups` there. School-wide groups:
/// `ManageSchoolPermissionGroups`.
fn authorize_manage(actor: &Actor, branch_id: Option<Uuid>) -> AppResult<()> {
    match branch_id {
        Some(branch_id) => authorize(actor, Action::ManagePermissionGroups { branch_id })?,
        None => authorize(actor, Action::ManageSchoolPermissionGroups)?,
    }
    Ok(())
}

async fn load_managed(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<GroupRow> {
    let group = sqlx::query_as!(
        GroupRow,
        "SELECT branch_id, name, description, is_default FROM permission_group WHERE id = $1",
        group_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    authorize_manage(actor, group.branch_id)?;
    Ok(group)
}

/// The branch's own groups and the school-wide ones it may attach, with the
/// branch's departments using each (branch admins).
pub async fn list(db: &PgPool, actor: &Actor, branch_id: Uuid) -> AppResult<Vec<PermissionGroup>> {
    authorize(actor, Action::ManagePermissionGroups { branch_id })?;
    Ok(sqlx::query_as!(
        PermissionGroup,
        r#"
        SELECT g.id, g.branch_id, g.name, g.description, g.is_default, g.created_at,
               (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'permission', gg.permission_key, 'issue_type', t.code, 'department', gg.department))
                       ORDER BY gg.permission_key, t.code NULLS FIRST, gg.department NULLS FIRST), '[]')
                FROM permission_group_grant gg LEFT JOIN issue_type t ON t.id = gg.issue_type_id
                WHERE gg.group_id = g.id) AS "grants!: Json<Vec<GrantSpec>>",
               ARRAY(SELECT x.department_id FROM department_permission_group x
                     JOIN department d ON d.id = x.department_id AND d.branch_id = $1
                     WHERE x.group_id = g.id ORDER BY x.department_id) AS "department_ids!"
        FROM permission_group g
        WHERE g.branch_id = $1 OR g.branch_id IS NULL
        ORDER BY g.is_default DESC, g.branch_id IS NULL, lower(g.name), g.id
        "#,
        branch_id
    )
    .fetch_all(db)
    .await?)
}

/// School-wide groups, "Everyone" first (root users).
pub async fn list_school(db: &PgPool, actor: &Actor) -> AppResult<Vec<PermissionGroup>> {
    authorize(actor, Action::ManageSchoolPermissionGroups)?;
    Ok(sqlx::query_as!(
        PermissionGroup,
        r#"
        SELECT g.id, g.branch_id, g.name, g.description, g.is_default, g.created_at,
               (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'permission', gg.permission_key, 'issue_type', t.code, 'department', gg.department))
                       ORDER BY gg.permission_key, t.code NULLS FIRST, gg.department NULLS FIRST), '[]')
                FROM permission_group_grant gg LEFT JOIN issue_type t ON t.id = gg.issue_type_id
                WHERE gg.group_id = g.id) AS "grants!: Json<Vec<GrantSpec>>",
               ARRAY(SELECT x.department_id FROM department_permission_group x
                     WHERE x.group_id = g.id ORDER BY x.department_id) AS "department_ids!"
        FROM permission_group g
        WHERE g.branch_id IS NULL
        ORDER BY g.is_default DESC, lower(g.name), g.id
        "#,
    )
    .fetch_all(db)
    .await?)
}

async fn fetch(tx: &mut Tx, group_id: Uuid) -> AppResult<PermissionGroup> {
    Ok(sqlx::query_as!(
        PermissionGroup,
        r#"
        SELECT g.id, g.branch_id, g.name, g.description, g.is_default, g.created_at,
               (SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                           'permission', gg.permission_key, 'issue_type', t.code, 'department', gg.department))
                       ORDER BY gg.permission_key, t.code NULLS FIRST, gg.department NULLS FIRST), '[]')
                FROM permission_group_grant gg LEFT JOIN issue_type t ON t.id = gg.issue_type_id
                WHERE gg.group_id = g.id) AS "grants!: Json<Vec<GrantSpec>>",
               ARRAY(SELECT x.department_id FROM department_permission_group x
                     JOIN department d ON d.id = x.department_id AND (g.branch_id IS NULL OR d.branch_id = g.branch_id)
                     WHERE x.group_id = g.id ORDER BY x.department_id) AS "department_ids!"
        FROM permission_group g WHERE g.id = $1
        "#,
        group_id
    )
    .fetch_one(&mut **tx)
    .await?)
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewPermissionGroup {
    pub name: String,
    pub description: Option<String>,
    #[serde(default)]
    pub grants: Vec<GrantSpec>,
}

/// `branch_id` `None` creates a school-wide group (root users).
pub async fn create(
    db: &PgPool,
    actor: &Actor,
    branch_id: Option<Uuid>,
    input: NewPermissionGroup,
) -> AppResult<PermissionGroup> {
    authorize_manage(actor, branch_id)?;
    let name = validate_name(&input.name)?;
    let description = input.description.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty());
    let grants = parse_grants(&input.grants)?;

    let mut tx = db.begin().await?;
    let id = insert_group(&mut tx, actor, branch_id, &name, description.as_deref()).await?;
    replace_grants(&mut tx, actor, id, branch_id, &grants).await?;
    emit_changed(&mut tx, branch_id).await?;
    let group = fetch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(group)
}

pub(crate) async fn insert_group(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Option<Uuid>,
    name: &str,
    description: Option<&str>,
) -> AppResult<Uuid> {
    let id = sqlx::query_scalar!(
        "INSERT INTO permission_group (branch_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
        branch_id,
        name,
        description,
        actor.user_id
    )
    .fetch_one(&mut **tx)
    .await?;
    audit_group(tx, actor, branch_id, id, "create", None, json!({ "name": name, "description": description })).await?;
    Ok(id)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct PermissionGroupPatch {
    pub name: Option<String>,
    #[serde(default, with = "super::branches::double_option")]
    pub description: Option<Option<String>>,
    /// Replaces every grant of the group.
    pub grants: Option<Vec<GrantSpec>>,
}

pub async fn update(
    db: &PgPool,
    actor: &Actor,
    group_id: Uuid,
    patch: PermissionGroupPatch,
) -> AppResult<PermissionGroup> {
    let group = load_managed(db, actor, group_id).await?;
    let name = patch.name.as_deref().map(validate_name).transpose()?;
    if group.is_default && name.as_ref().is_some_and(|n| *n != group.name) {
        return Err(AppError::conflict("default_group", "\"Everyone\" can't be renamed"));
    }
    let grants = patch.grants.as_deref().map(parse_grants).transpose()?;
    let new_name = name.unwrap_or_else(|| group.name.clone());
    let new_description = match patch.description {
        Some(d) => d.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty()),
        None => group.description.clone(),
    };

    let mut tx = db.begin().await?;
    if new_name != group.name || new_description != group.description {
        sqlx::query!(
            "UPDATE permission_group SET name = $2, description = $3 WHERE id = $1",
            group_id,
            new_name,
            new_description
        )
        .execute(&mut *tx)
        .await?;
        audit_group(
            &mut tx,
            actor,
            group.branch_id,
            group_id,
            "update",
            Some(json!({ "name": group.name, "description": group.description })),
            json!({ "name": new_name, "description": new_description }),
        )
        .await?;
    }
    if let Some(grants) = grants {
        if replace_grants(&mut tx, actor, group_id, group.branch_id, &grants).await? {
            grants_changed(&mut tx, actor, group_id, &new_name).await?;
        }
    }
    emit_changed(&mut tx, group.branch_id).await?;
    let updated = fetch(&mut tx, group_id).await?;
    tx.commit().await?;
    Ok(updated)
}

pub async fn delete(db: &PgPool, actor: &Actor, group_id: Uuid) -> AppResult<()> {
    let group = load_managed(db, actor, group_id).await?;
    if group.is_default {
        return Err(AppError::conflict("default_group", "\"Everyone\" can't be deleted"));
    }
    let mut tx = db.begin().await?;
    // Before the delete, so the event can still name who's affected.
    grants_changed(&mut tx, actor, group_id, &group.name).await?;
    sqlx::query!("DELETE FROM permission_group WHERE id = $1", group_id).execute(&mut *tx).await?;
    audit_group(&mut tx, actor, group.branch_id, group_id, "delete", Some(json!({ "name": group.name })), json!(null))
        .await?;
    emit_changed(&mut tx, group.branch_id).await?;
    tx.commit().await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Attaching to departments
// ---------------------------------------------------------------------------

/// Attach (`attach = true`) or detach a permission group to a department:
/// the branch's admins, for the branch's own groups and school-wide ones.
pub async fn set_attached(
    db: &PgPool,
    actor: &Actor,
    department_id: Uuid,
    group_id: Uuid,
    attach: bool,
) -> AppResult<()> {
    let department = sqlx::query!("SELECT branch_id, name FROM department WHERE id = $1", department_id)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    authorize(actor, Action::ManagePermissionGroups { branch_id: department.branch_id })?;
    let group = sqlx::query!("SELECT branch_id, name, is_default FROM permission_group WHERE id = $1", group_id)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    if group.branch_id.is_some_and(|b| b != department.branch_id) {
        return Err(AppError::NotFound);
    }
    if group.is_default {
        return Err(AppError::conflict("default_group", "\"Everyone\" applies to everyone without being attached"));
    }

    let mut tx = db.begin().await?;
    let changed = attach_in_tx(&mut tx, actor, department.branch_id, department_id, group_id, attach).await?;
    if changed {
        let payload = json!({
            "group_id": group_id, "group_name": group.name,
            "department_id": department_id, "department_name": department.name, "removed": !attach,
        });
        notify_admins_permissions_changed(&mut tx, actor, department.branch_id, payload).await?;
        let members = super::departments::members_of(&mut tx, department_id).await?;
        emit_branch_event(&mut tx, "permissions_changed", department.branch_id, members).await?;
        emit_branch_event(&mut tx, "department_changed", department.branch_id, vec![]).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Attaches or detaches, with its audit entry. Returns whether anything changed.
pub(crate) async fn attach_in_tx(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    department_id: Uuid,
    group_id: Uuid,
    attach: bool,
) -> AppResult<bool> {
    let changed = if attach {
        sqlx::query!(
            "INSERT INTO department_permission_group (department_id, group_id, attached_by) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING",
            department_id,
            group_id,
            actor.user_id
        )
        .execute(&mut **tx)
        .await?
        .rows_affected()
    } else {
        sqlx::query!(
            "DELETE FROM department_permission_group WHERE department_id = $1 AND group_id = $2",
            department_id,
            group_id
        )
        .execute(&mut **tx)
        .await?
        .rows_affected()
    } > 0;
    if changed {
        audit::record(
            tx,
            AuditEntry {
                entity_type: "department_permission_group",
                entity_id: format!("{department_id}:{group_id}"),
                branch_id: Some(branch_id),
                actor_id: Some(actor.user_id),
                action: if attach { "attach" } else { "detach" },
                old_value: None,
                new_value: Some(json!({ "department_id": department_id, "group_id": group_id })),
            },
        )
        .await?;
    }
    Ok(changed)
}

// ---------------------------------------------------------------------------
// Effective permissions
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct EffectivePermissions {
    pub user_id: Uuid,
    pub branch_id: Uuid,
    /// Admins can do everything except root user actions, whatever their
    /// permission groups grant.
    pub is_admin: bool,
    pub grants: Vec<SourcedGrant>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SourcedGrant {
    #[serde(flatten)]
    pub grant: GrantSpec,
    pub permission_group: GroupSource,
    /// The department it comes through; `null` for "Everyone".
    pub department: Option<DepartmentSource>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct GroupSource {
    pub id: Uuid,
    pub name: String,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct DepartmentSource {
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

    // Same sources as Actor::load: active departments only, plus Everyone.
    let rows = sqlx::query!(
        r#"
        SELECT gg.permission_key AS "permission!", t.code AS "issue_type?", gg.department AS "department_name?",
               g.id AS "group_id!", g.name AS "group_name!", d.id AS "via_id?", d.name AS "via_name?"
        FROM department_member dm
        JOIN department d                    ON d.id = dm.department_id AND d.archived_at IS NULL
        JOIN department_permission_group dpg ON dpg.department_id = d.id
        JOIN permission_group g              ON g.id = dpg.group_id
        JOIN permission_group_grant gg       ON gg.group_id = g.id
        LEFT JOIN issue_type t               ON t.id = gg.issue_type_id
        WHERE dm.user_id = $1 AND dm.branch_id = $2
        UNION ALL
        SELECT gg.permission_key, t.code, gg.department, g.id, g.name, NULL, NULL
        FROM permission_group g
        JOIN permission_group_grant gg ON gg.group_id = g.id
        LEFT JOIN issue_type t         ON t.id = gg.issue_type_id
        WHERE g.is_default
        ORDER BY 1, 2 NULLS FIRST, 3 NULLS FIRST, 5, 7
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
                grant: GrantSpec { permission: r.permission, issue_type: r.issue_type, department: r.department_name },
                permission_group: GroupSource { id: r.group_id, name: r.group_name },
                department: r.via_id.zip(r.via_name).map(|(id, name)| DepartmentSource { id, name }),
            })
            .collect(),
    })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Sets the group's grants to exactly `grants`, auditing each one added or
/// removed. Returns whether anything changed.
pub(crate) async fn replace_grants(
    tx: &mut Tx,
    actor: &Actor,
    group_id: Uuid,
    branch_id: Option<Uuid>,
    grants: &[CheckedGrant],
) -> AppResult<bool> {
    let current = sqlx::query!(
        r#"SELECT gg.id AS "id!", gg.permission_key AS "permission_key!", t.code AS "issue_type?", gg.department
           FROM permission_group_grant gg LEFT JOIN issue_type t ON t.id = gg.issue_type_id
           WHERE gg.group_id = $1"#,
        group_id
    )
    .fetch_all(&mut **tx)
    .await?;
    let mut changed = false;
    for row in &current {
        let spec = GrantSpec {
            permission: row.permission_key.clone(),
            issue_type: row.issue_type.clone(),
            department: row.department.clone(),
        };
        if grants.iter().any(|g| g.spec() == spec) {
            continue;
        }
        sqlx::query!("DELETE FROM permission_group_grant WHERE id = $1", row.id).execute(&mut **tx).await?;
        audit_grant(tx, actor, branch_id, row.id, "revoke", group_id, &spec).await?;
        changed = true;
    }
    for grant in grants {
        let spec = grant.spec();
        let exists = current.iter().any(|row| {
            row.permission_key == spec.permission
                && row.issue_type == spec.issue_type
                && row.department == spec.department
        });
        if exists {
            continue;
        }
        let id = sqlx::query_scalar!(
            r#"
            INSERT INTO permission_group_grant (group_id, permission_key, issue_type_id, scope, department, granted_by)
            VALUES ($1, $2, (SELECT id FROM issue_type WHERE code = $3), 'branch', $4, $5)
            RETURNING id
            "#,
            group_id,
            spec.permission,
            spec.issue_type,
            spec.department,
            actor.user_id,
        )
        .fetch_one(&mut **tx)
        .await?;
        audit_grant(tx, actor, branch_id, id, "grant", group_id, &spec).await?;
        changed = true;
    }
    Ok(changed)
}

/// Everyone whose permissions come from the group: members of the
/// departments it's attached to, or every user for "Everyone". Tells their
/// streams to refresh and the affected branches' admins.
pub(crate) async fn grants_changed(tx: &mut Tx, actor: &Actor, group_id: Uuid, group_name: &str) -> AppResult<()> {
    let is_default = sqlx::query_scalar!("SELECT is_default FROM permission_group WHERE id = $1", group_id)
        .fetch_one(&mut **tx)
        .await?;
    if is_default {
        let everyone = sqlx::query_scalar!("SELECT id FROM app_user WHERE is_active").fetch_all(&mut **tx).await?;
        return realtime::emit(
            tx,
            realtime::Event {
                kind: "permissions_changed",
                issue_id: None,
                branch_ids: vec![],
                recipient_ids: everyone,
            },
        )
        .await;
    }
    let affected = sqlx::query!(
        r#"SELECT d.branch_id, array_agg(DISTINCT dm.user_id) AS "users!"
           FROM department_permission_group x
           JOIN department d ON d.id = x.department_id
           JOIN department_member dm ON dm.department_id = d.id
           WHERE x.group_id = $1
           GROUP BY d.branch_id"#,
        group_id
    )
    .fetch_all(&mut **tx)
    .await?;
    for branch in affected {
        let payload = json!({ "group_id": group_id, "group_name": group_name });
        notify_admins_permissions_changed(tx, actor, branch.branch_id, payload).await?;
        emit_branch_event(tx, "permissions_changed", branch.branch_id, branch.users).await?;
    }
    Ok(())
}

/// The list changed: the branch's admins (or root users) refresh it.
async fn emit_changed(tx: &mut Tx, branch_id: Option<Uuid>) -> AppResult<()> {
    match branch_id {
        Some(b) => emit_branch_event(tx, "permission_groups_changed", b, vec![]).await,
        None => {
            realtime::emit(
                tx,
                realtime::Event {
                    kind: "permission_groups_changed",
                    issue_id: None,
                    branch_ids: vec![],
                    recipient_ids: vec![],
                },
            )
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
            entity_type: "permission_group",
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

async fn audit_grant(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Option<Uuid>,
    grant_id: Uuid,
    action: &'static str,
    group_id: Uuid,
    spec: &GrantSpec,
) -> AppResult<()> {
    let value = json!({
        "group_id": group_id, "permission": spec.permission, "issue_type": spec.issue_type, "department": spec.department,
    });
    let (old_value, new_value) = if action == "grant" { (None, Some(value)) } else { (Some(value), None) };
    audit::record(
        tx,
        AuditEntry {
            entity_type: "permission_group_grant",
            entity_id: grant_id.to_string(),
            branch_id,
            actor_id: Some(actor.user_id),
            action,
            old_value,
            new_value,
        },
    )
    .await
}

pub(crate) fn validate_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 100 {
        return Err(AppError::validation(
            "invalid_name",
            "a permission group's name must be between 1 and 100 characters",
        ));
    }
    Ok(name.to_owned())
}
