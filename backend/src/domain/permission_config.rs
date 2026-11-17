//! The permission setup as one document, in YAML or JSON: permission groups
//! with their grants, and each branch's departments with the permission
//! groups attached to them and their heads. Export it, edit it, and import
//! it back: a dry run lists the changes, a real run applies them all in one
//! transaction.
//!
//! Importing creates and updates; it never deletes. A permission group, a
//! department or a branch missing from the file is left as it is (delete or
//! archive those in the app). What a listed group grants, and what a listed
//! department has attached and who heads it, is set to exactly what the
//! file says.
//!
//! Root users export and import everything. Branch admins export the
//! school-wide groups and their own branches, and import changes to their
//! own branches only.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::emit_branch_event,
    departments::notify_admins_permissions_changed,
    permission_groups::{self, parse_grants, CheckedGrant, GrantSpec},
};
use crate::{
    authz::{Actor, Permission},
    db::Tx,
    error::{AppError, AppResult},
};

pub const VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Deserialize, utoipa::ToSchema, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Yaml,
    Json,
}

impl Format {
    pub fn content_type(self) -> &'static str {
        match self {
            Format::Yaml => "application/yaml",
            Format::Json => "application/json",
        }
    }
}

/// The document. Branches are named by their code; people by their email.
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PermissionConfig {
    pub version: u32,
    #[serde(default)]
    pub permission_groups: Vec<GroupDoc>,
    #[serde(default)]
    pub branches: Vec<BranchDoc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupDoc {
    pub name: String,
    /// A branch code; absent for school-wide groups.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub statements: Vec<Statement>,
}

/// Every action, for every listed issue type (none: all types) and every
/// listed department (per-department actions only).
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Statement {
    pub actions: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub issue_types: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub departments: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BranchDoc {
    /// The branch's code.
    pub branch: String,
    #[serde(default)]
    pub departments: Vec<DepartmentDoc>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DepartmentDoc {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Names of permission groups: the branch's own, else school-wide.
    #[serde(default)]
    pub permission_groups: Vec<String>,
    /// Emails of current branch members; heads not yet in the department join it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub heads: Vec<String>,
}

// ---------------------------------------------------------------------------
// Statements <-> grants
// ---------------------------------------------------------------------------

/// Expands statements into individual grants.
fn statements_to_grants(statements: &[Statement]) -> AppResult<Vec<CheckedGrant>> {
    let mut specs = Vec::new();
    for s in statements {
        let types: Vec<Option<String>> =
            if s.issue_types.is_empty() { vec![None] } else { s.issue_types.iter().cloned().map(Some).collect() };
        for action in &s.actions {
            let per_department = Permission::from_key(action).is_some_and(Permission::per_department);
            let per_type = Permission::from_key(action).is_some_and(Permission::per_issue_type);
            let departments: Vec<Option<String>> = if per_department {
                if s.departments.is_empty() {
                    vec![None] // rejected by parse: names the problem
                } else {
                    s.departments.iter().cloned().map(Some).collect()
                }
            } else {
                vec![None]
            };
            // Issue types only apply to per-type actions; a statement can mix both.
            let types: &[Option<String>] = if per_type { &types } else { &[None] };
            for ty in types {
                for d in &departments {
                    specs.push(GrantSpec { permission: action.clone(), issue_type: ty.clone(), department: d.clone() });
                }
            }
        }
        if !s.departments.is_empty()
            && !s.actions.iter().any(|a| Permission::from_key(a).is_some_and(Permission::per_department))
        {
            return Err(AppError::validation(
                "invalid_department",
                format!("departments are only for department.members.manage (statement with {})", s.actions.join(", ")),
            ));
        }
    }
    parse_grants(&specs)
}

/// Groups grants into compact statements: one per issue type and department set.
fn grants_to_statements(grants: &[GrantSpec]) -> Vec<Statement> {
    // (issue type, department) -> actions
    let mut by_key: BTreeMap<(Option<String>, Option<String>), BTreeSet<String>> = BTreeMap::new();
    for g in grants {
        by_key.entry((g.issue_type.clone(), g.department.clone())).or_default().insert(g.permission.clone());
    }
    // Merge the keys that share the same actions: actions -> (types, departments)
    type Keys = (BTreeSet<Option<String>>, BTreeSet<Option<String>>);
    let mut by_actions: BTreeMap<Vec<String>, Keys> = BTreeMap::new();
    for ((ty, d), actions) in by_key {
        let entry = by_actions.entry(actions.into_iter().collect()).or_default();
        entry.0.insert(ty);
        entry.1.insert(d);
    }
    by_actions
        .into_iter()
        .flat_map(|(actions, (types, departments))| {
            // Only merge when it's a clean product; otherwise one statement per type.
            if types.len() > 1 && departments.len() > 1 {
                types
                    .into_iter()
                    .map(|t| Statement {
                        actions: actions.clone(),
                        issue_types: t.into_iter().collect(),
                        departments: departments.iter().flatten().cloned().collect(),
                    })
                    .collect::<Vec<_>>()
            } else if types.contains(&None) {
                // "All types" swallows the others.
                vec![Statement {
                    actions,
                    issue_types: vec![],
                    departments: departments.into_iter().flatten().collect(),
                }]
            } else {
                vec![Statement {
                    actions,
                    issue_types: types.into_iter().flatten().collect(),
                    departments: departments.into_iter().flatten().collect(),
                }]
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

/// The branches the actor may see in the document, `None` for all (root).
fn scope(actor: &Actor) -> AppResult<Option<BTreeSet<Uuid>>> {
    if actor.is_super_admin {
        return Ok(None);
    }
    let admin_of: BTreeSet<Uuid> = actor.branches.iter().filter(|(_, a)| a.is_admin).map(|(b, _)| *b).collect();
    if admin_of.is_empty() {
        return Err(AppError::forbidden("forbidden", "only branch admins and root users manage permissions"));
    }
    Ok(Some(admin_of))
}

pub async fn export(db: &PgPool, actor: &Actor) -> AppResult<PermissionConfig> {
    let scope = scope(actor)?;
    let in_scope = |b: Option<Uuid>| match (&scope, b) {
        (None, _) | (_, None) => true,
        (Some(s), Some(b)) => s.contains(&b),
    };

    let groups = sqlx::query!(
        r#"SELECT g.id, g.branch_id, b.code AS "branch_code?", g.name, g.description
           FROM permission_group g LEFT JOIN branch b ON b.id = g.branch_id
           ORDER BY g.branch_id IS NOT NULL, b.code, g.is_default DESC, lower(g.name)"#
    )
    .fetch_all(db)
    .await?;
    let grants = sqlx::query!(
        r#"SELECT gg.group_id, gg.permission_key, t.code AS "issue_type?", gg.department
           FROM permission_group_grant gg LEFT JOIN issue_type t ON t.id = gg.issue_type_id
           ORDER BY gg.permission_key, t.code NULLS FIRST, gg.department NULLS FIRST"#
    )
    .fetch_all(db)
    .await?;
    let mut grants_of: HashMap<Uuid, Vec<GrantSpec>> = HashMap::new();
    for g in grants {
        grants_of.entry(g.group_id).or_default().push(GrantSpec {
            permission: g.permission_key,
            issue_type: g.issue_type,
            department: g.department,
        });
    }
    let permission_groups = groups
        .into_iter()
        .filter(|g| in_scope(g.branch_id))
        .map(|g| GroupDoc {
            name: g.name,
            branch: g.branch_code,
            description: g.description,
            statements: grants_to_statements(grants_of.get(&g.id).map(Vec::as_slice).unwrap_or_default()),
        })
        .collect();

    let departments = sqlx::query!(
        r#"
        SELECT d.branch_id, b.code, d.name, d.description,
               ARRAY(SELECT g.name FROM department_permission_group x JOIN permission_group g ON g.id = x.group_id
                     WHERE x.department_id = d.id ORDER BY lower(g.name)) AS "groups!",
               ARRAY(SELECT u.email::text FROM department_member m JOIN app_user u ON u.id = m.user_id
                     WHERE m.department_id = d.id AND m.is_head ORDER BY u.email) AS "heads!: Vec<String>"
        FROM department d JOIN branch b ON b.id = d.branch_id
        WHERE d.archived_at IS NULL AND b.is_active
        ORDER BY b.code, d.is_default DESC, lower(d.name)
        "#
    )
    .fetch_all(db)
    .await?;
    let mut branches: Vec<BranchDoc> = Vec::new();
    for d in departments.into_iter().filter(|d| in_scope(Some(d.branch_id))) {
        if branches.last().is_none_or(|b| b.branch != d.code) {
            branches.push(BranchDoc { branch: d.code.clone(), departments: vec![] });
        }
        branches.last_mut().expect("just pushed").departments.push(DepartmentDoc {
            name: d.name,
            description: d.description,
            permission_groups: d.groups,
            heads: d.heads,
        });
    }

    Ok(PermissionConfig { version: VERSION, permission_groups, branches })
}

pub fn render(config: &PermissionConfig, format: Format) -> AppResult<String> {
    match format {
        Format::Yaml => serde_yaml::to_string(config).map_err(|e| AppError::internal(e.to_string())),
        Format::Json => serde_json::to_string_pretty(config).map_err(|e| AppError::internal(e.to_string())),
    }
}

pub fn parse(text: &str, format: Format) -> AppResult<PermissionConfig> {
    let config: PermissionConfig = match format {
        Format::Yaml => serde_yaml::from_str(text).map_err(|e| invalid(e.to_string()))?,
        Format::Json => serde_json::from_str(text).map_err(|e| invalid(e.to_string()))?,
    };
    if config.version != VERSION {
        return Err(invalid(format!("unsupported version {}; this app reads version {VERSION}", config.version)));
    }
    Ok(config)
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::validation("invalid_config", message.into())
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct ConfigImportOutcome {
    /// Whether the changes were saved (`false` on a dry run).
    pub applied: bool,
    /// What changes (or would change), one line each. Empty: already as the file says.
    pub changes: Vec<String>,
}

struct Branch {
    id: Uuid,
    code: String,
}

/// Applies the document. With `dry_run`, runs everything in a transaction
/// that is rolled back, so the listed changes are exactly what would happen.
pub async fn import(
    db: &PgPool,
    actor: &Actor,
    config: PermissionConfig,
    dry_run: bool,
) -> AppResult<ConfigImportOutcome> {
    let scope = scope(actor)?;
    let branches: HashMap<String, Branch> = sqlx::query_as!(Branch, "SELECT id, code FROM branch")
        .fetch_all(db)
        .await?
        .into_iter()
        .map(|b| (b.code.to_uppercase(), b))
        .collect();
    let branch = |code: &str| -> AppResult<&Branch> {
        branches.get(&code.trim().to_uppercase()).ok_or_else(|| invalid(format!("no branch with code {code:?}")))
    };
    let may_change = |branch_id: Option<Uuid>| match (&scope, branch_id) {
        (None, _) => true,
        (Some(_), None) => false,
        (Some(s), Some(b)) => s.contains(&b),
    };

    let mut tx = db.begin().await?;
    let mut changes = Vec::new();
    let mut changed_groups: Vec<(Uuid, String)> = Vec::new();
    let mut touched_departments: BTreeSet<(Uuid, Uuid)> = BTreeSet::new(); // (branch, department)

    // Permission groups.
    let mut seen = BTreeSet::new();
    for doc in &config.permission_groups {
        let name = permission_groups::validate_name(&doc.name)?;
        let branch_id = doc.branch.as_deref().map(branch).transpose()?.map(|b| b.id);
        let label = match &doc.branch {
            Some(code) => format!("permission group \"{name}\" ({})", code.to_uppercase()),
            None => format!("school-wide permission group \"{name}\""),
        };
        if !seen.insert((branch_id, name.to_lowercase())) {
            return Err(invalid(format!("{label} is listed twice")));
        }
        let grants = statements_to_grants(&doc.statements).map_err(|e| invalid(format!("{label}: {e}")))?;
        let description = doc.description.as_deref().map(str::trim).filter(|d| !d.is_empty());

        let existing = sqlx::query!(
            "SELECT id, description FROM permission_group WHERE branch_id IS NOT DISTINCT FROM $1 AND lower(name) = lower($2)",
            branch_id,
            name
        )
        .fetch_optional(&mut *tx)
        .await?;
        let before = match &existing {
            Some(g) => current_grants(&mut tx, g.id).await?,
            None => vec![],
        };
        let after: Vec<GrantSpec> = grants.iter().map(CheckedGrant::spec).collect();
        let description_changes = existing.as_ref().is_some_and(|g| g.description.as_deref() != description);
        if existing.is_some() && before == after && !description_changes {
            continue;
        }
        if !may_change(branch_id) {
            return Err(AppError::forbidden(
                "forbidden",
                format!("{label} would change; only root users change school-wide groups and other branches"),
            ));
        }
        let id = match existing {
            Some(g) => {
                if description_changes {
                    sqlx::query!("UPDATE permission_group SET description = $2 WHERE id = $1", g.id, description)
                        .execute(&mut *tx)
                        .await?;
                    changes.push(format!("{label}: description updated"));
                }
                g.id
            }
            None => {
                let id = permission_groups::insert_group(&mut tx, actor, branch_id, &name, description).await?;
                changes.push(format!("{label}: created"));
                id
            }
        };
        for g in after.iter().filter(|g| !before.contains(g)) {
            changes.push(format!("{label}: grants {}", describe(g)));
        }
        for g in before.iter().filter(|g| !after.contains(g)) {
            changes.push(format!("{label}: no longer grants {}", describe(g)));
        }
        if permission_groups::replace_grants(&mut tx, actor, id, branch_id, &grants).await? {
            changed_groups.push((id, name));
        }
    }

    // Departments.
    for branch_doc in &config.branches {
        let b = branch(&branch_doc.branch)?;
        let mut seen = BTreeSet::new();
        for doc in &branch_doc.departments {
            let name = doc.name.trim();
            let label = format!("department \"{name}\" ({})", b.code);
            if !seen.insert(name.to_lowercase()) {
                return Err(invalid(format!("{label} is listed twice")));
            }
            let description = doc.description.as_deref().map(str::trim).filter(|d| !d.is_empty());
            let mut lines = Vec::new();

            let existing = sqlx::query!(
                "SELECT id, description, is_default FROM department WHERE branch_id = $1 AND lower(name) = lower($2)",
                b.id,
                name
            )
            .fetch_optional(&mut *tx)
            .await?;
            let department_id = match &existing {
                Some(d) => {
                    if d.description.as_deref() != description && !d.is_default {
                        sqlx::query!("UPDATE department SET description = $2 WHERE id = $1", d.id, description)
                            .execute(&mut *tx)
                            .await?;
                        lines.push(format!("{label}: description updated"));
                    }
                    d.id
                }
                None => {
                    let id = sqlx::query_scalar!(
                        "INSERT INTO department (branch_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id",
                        b.id,
                        name,
                        description,
                        actor.user_id
                    )
                    .fetch_one(&mut *tx)
                    .await?;
                    audit_department_created(&mut tx, actor, b.id, id, name).await?;
                    lines.push(format!("{label}: created"));
                    id
                }
            };

            // Attached permission groups: exactly the listed ones.
            let mut wanted = BTreeSet::new();
            for group_name in &doc.permission_groups {
                let group = sqlx::query!(
                    r#"SELECT id, is_default FROM permission_group
                       WHERE (branch_id = $1 OR branch_id IS NULL) AND lower(name) = lower($2)
                       ORDER BY branch_id NULLS LAST LIMIT 1"#,
                    b.id,
                    group_name.trim()
                )
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| {
                    invalid(format!("{label}: no permission group {group_name:?} in this branch or school-wide"))
                })?;
                if group.is_default {
                    return Err(invalid(format!("{label}: \"{group_name}\" applies to everyone; don't attach it")));
                }
                wanted.insert((group.id, group_name.trim().to_owned()));
            }
            let attached = sqlx::query!(
                "SELECT g.id, g.name FROM department_permission_group x JOIN permission_group g ON g.id = x.group_id
                 WHERE x.department_id = $1",
                department_id
            )
            .fetch_all(&mut *tx)
            .await?;
            for (id, group_name) in &wanted {
                if !attached.iter().any(|a| a.id == *id)
                    && permission_groups::attach_in_tx(&mut tx, actor, b.id, department_id, *id, true).await?
                {
                    lines.push(format!("{label}: attach \"{group_name}\""));
                }
            }
            for a in &attached {
                if !wanted.iter().any(|(id, _)| *id == a.id)
                    && permission_groups::attach_in_tx(&mut tx, actor, b.id, department_id, a.id, false).await?
                {
                    lines.push(format!("{label}: detach \"{}\"", a.name));
                }
            }

            // Heads: exactly the listed people.
            let mut wanted_heads = BTreeMap::new();
            for email in &doc.heads {
                let user = sqlx::query_scalar!(
                    r#"SELECT u.id FROM app_user u JOIN branch_membership m ON m.user_id = u.id AND m.branch_id = $1
                       WHERE lower(u.email::text) = lower($2) AND m.left_at IS NULL"#,
                    b.id,
                    email.trim()
                )
                .fetch_optional(&mut *tx)
                .await?
                .ok_or_else(|| invalid(format!("{label}: {email} is not a current member of {}", b.code)))?;
                wanted_heads.insert(user, email.trim().to_owned());
            }
            if !wanted_heads.is_empty() && existing.as_ref().is_some_and(|d| d.is_default) {
                return Err(invalid(format!("{label}: \"All members\" has no heads")));
            }
            let heads = sqlx::query!(
                "SELECT m.user_id, u.email::text AS \"email!\" FROM department_member m JOIN app_user u ON u.id = m.user_id
                 WHERE m.department_id = $1 AND m.is_head",
                department_id
            )
            .fetch_all(&mut *tx)
            .await?;
            for (user_id, email) in &wanted_heads {
                if heads.iter().any(|h| h.user_id == *user_id) {
                    continue;
                }
                sqlx::query!(
                    r#"INSERT INTO department_member (department_id, user_id, branch_id, is_head, added_by)
                       VALUES ($1, $2, $3, true, $4)
                       ON CONFLICT (department_id, user_id) DO UPDATE SET is_head = true"#,
                    department_id,
                    user_id,
                    b.id,
                    actor.user_id
                )
                .execute(&mut *tx)
                .await?;
                audit_head(&mut tx, actor, b.id, department_id, *user_id, true).await?;
                lines.push(format!("{label}: {email} becomes a head"));
            }
            for h in heads.iter().filter(|h| !wanted_heads.contains_key(&h.user_id)) {
                sqlx::query!(
                    "UPDATE department_member SET is_head = false WHERE department_id = $1 AND user_id = $2",
                    department_id,
                    h.user_id
                )
                .execute(&mut *tx)
                .await?;
                audit_head(&mut tx, actor, b.id, department_id, h.user_id, false).await?;
                lines.push(format!("{label}: {} is no longer a head", h.email));
            }

            if !lines.is_empty() {
                if !may_change(Some(b.id)) {
                    return Err(AppError::forbidden(
                        "forbidden",
                        format!("{label} would change; you can only change branches you run"),
                    ));
                }
                touched_departments.insert((b.id, department_id));
                changes.extend(lines);
            }
        }
    }

    if dry_run {
        tx.rollback().await?;
        return Ok(ConfigImportOutcome { applied: false, changes });
    }

    // Tell everyone affected, once.
    for (group_id, name) in &changed_groups {
        permission_groups::grants_changed(&mut tx, actor, *group_id, name).await?;
    }
    for (branch_id, department_id) in &touched_departments {
        let members = super::departments::members_of(&mut tx, *department_id).await?;
        emit_branch_event(&mut tx, "permissions_changed", *branch_id, members).await?;
        emit_branch_event(&mut tx, "department_changed", *branch_id, vec![]).await?;
    }
    let branches_touched: BTreeSet<Uuid> = touched_departments.iter().map(|(b, _)| *b).collect();
    for branch_id in branches_touched {
        let payload = json!({ "config_import": true });
        notify_admins_permissions_changed(&mut tx, actor, branch_id, payload).await?;
        emit_branch_event(&mut tx, "permission_groups_changed", branch_id, vec![]).await?;
    }
    if !changes.is_empty() {
        audit::record(
            &mut tx,
            AuditEntry {
                entity_type: "permission_config",
                entity_id: "import".into(),
                branch_id: None,
                actor_id: Some(actor.user_id),
                action: "import",
                old_value: None,
                new_value: Some(json!({ "changes": changes })),
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(ConfigImportOutcome { applied: true, changes })
}

async fn current_grants(tx: &mut Tx, group_id: Uuid) -> AppResult<Vec<GrantSpec>> {
    let mut grants: Vec<GrantSpec> = sqlx::query!(
        r#"SELECT gg.permission_key AS "permission_key!", t.code AS "issue_type?", gg.department
           FROM permission_group_grant gg LEFT JOIN issue_type t ON t.id = gg.issue_type_id
           WHERE gg.group_id = $1"#,
        group_id
    )
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(|r| GrantSpec { permission: r.permission_key, issue_type: r.issue_type, department: r.department })
    .collect();
    grants.sort();
    Ok(grants)
}

fn describe(g: &GrantSpec) -> String {
    let mut s = g.permission.clone();
    if let Some(t) = &g.issue_type {
        s.push_str(&format!(" ({t})"));
    }
    if let Some(d) = &g.department {
        s.push_str(&format!(" for {d}"));
    }
    s
}

async fn audit_department_created(tx: &mut Tx, actor: &Actor, branch_id: Uuid, id: Uuid, name: &str) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "department",
            entity_id: id.to_string(),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action: "create",
            old_value: None,
            new_value: Some(json!({ "name": name })),
        },
    )
    .await
}

async fn audit_head(
    tx: &mut Tx,
    actor: &Actor,
    branch_id: Uuid,
    department_id: Uuid,
    user_id: Uuid,
    head: bool,
) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "department_member",
            entity_id: format!("{department_id}:{user_id}"),
            branch_id: Some(branch_id),
            actor_id: Some(actor.user_id),
            action: if head { "make_head" } else { "remove_head" },
            old_value: Some(json!({ "is_head": !head })),
            new_value: Some(json!({ "is_head": head })),
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(p: &str, t: Option<&str>, d: Option<&str>) -> GrantSpec {
        GrantSpec { permission: p.into(), issue_type: t.map(Into::into), department: d.map(Into::into) }
    }

    #[test]
    fn statements_round_trip_through_grants() {
        let statements = vec![
            Statement {
                actions: vec!["issue.read".into(), "work_item.approve".into()],
                issue_types: vec![],
                departments: vec![],
            },
            Statement {
                actions: vec!["issue.close".into()],
                issue_types: vec!["ticket".into(), "event".into()],
                departments: vec![],
            },
            Statement {
                actions: vec!["department.members.manage".into()],
                issue_types: vec![],
                departments: vec!["IT".into(), "Health".into()],
            },
        ];
        let grants: Vec<GrantSpec> =
            statements_to_grants(&statements).unwrap().iter().map(CheckedGrant::spec).collect();
        assert!(grants.contains(&spec("issue.close", Some("ticket"), None)));
        assert!(grants.contains(&spec("department.members.manage", None, Some("Health"))));
        assert_eq!(grants.len(), 6);

        let again: Vec<GrantSpec> =
            statements_to_grants(&grants_to_statements(&grants)).unwrap().iter().map(CheckedGrant::spec).collect();
        assert_eq!(grants, again);
    }

    #[test]
    fn mistakes_are_named() {
        let bad = |s: Statement| statements_to_grants(&[s]).unwrap_err().to_string();
        assert!(bad(Statement { actions: vec!["issue.fly".into()], issue_types: vec![], departments: vec![] })
            .contains("issue.fly"));
        assert!(bad(Statement {
            actions: vec!["department.members.manage".into()],
            issue_types: vec![],
            departments: vec![]
        })
        .contains("department"));
        assert!(bad(Statement {
            actions: vec!["member.view".into()],
            issue_types: vec![],
            departments: vec!["IT".into()]
        })
        .contains("departments"));
    }

    #[test]
    fn yaml_documents_parse() {
        let text = r#"
version: 1
permission_groups:
  - name: IT support
    statements:
      - actions: [issue.read, comment.internal]
      - actions: [department.members.manage]
        departments: [IT]
branches:
  - branch: MTH
    departments:
      - name: IT
        permission_groups: [IT support]
        heads: [ali@example.com]
"#;
        let config = parse(text, Format::Yaml).unwrap();
        assert_eq!(config.permission_groups[0].statements.len(), 2);
        assert_eq!(config.branches[0].departments[0].heads, vec!["ali@example.com"]);
        assert!(parse("version: 2", Format::Yaml).is_err());
        assert!(parse("version: 1\nsurprise: true", Format::Yaml).is_err());
    }
}
