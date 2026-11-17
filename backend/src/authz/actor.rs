use std::collections::{HashMap, HashSet};

use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use super::permission::{IssueType, Permission, Scope};
use crate::error::{AppError, AppResult};

/// Who is making the request, with everything authorization needs. Built
/// fresh on every request (never cached), so membership and grant changes
/// take effect on the very next request.
#[derive(Debug, Clone)]
pub struct Actor {
    pub user_id: Uuid,
    pub is_super_admin: bool,
    /// Current memberships only (`left_at IS NULL`).
    pub branches: HashMap<Uuid, BranchAccess>,
    /// Active departments the actor heads: they run the work and questions
    /// sent to it.
    pub heads: HashSet<Uuid>,
}

#[derive(Debug, Clone, Default)]
pub struct BranchAccess {
    pub is_admin: bool,
    /// Union of the grants of the permission groups attached to the actor's
    /// active departments in this branch, and of "Everyone".
    pub grants: Vec<Grant>,
    /// `department.members.manage` grants: lowercase department names, or
    /// `*` for every department of the branch.
    pub manages_members_of: Vec<String>,
}

impl BranchAccess {
    /// May choose the members of the department called `name`?
    pub fn manages_members_of(&self, name: &str) -> bool {
        let name = name.to_lowercase();
        self.manages_members_of.iter().any(|d| d == "*" || *d == name)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, utoipa::ToSchema)]
pub struct Grant {
    pub permission: Permission,
    /// `None` = all issue types.
    pub issue_type: Option<IssueType>,
    pub scope: Scope,
}

impl Actor {
    pub async fn load(db: &PgPool, user_id: Uuid, is_super_admin: bool) -> AppResult<Self> {
        let memberships = sqlx::query!(
            "SELECT branch_id, is_admin FROM branch_membership WHERE user_id = $1 AND left_at IS NULL",
            user_id
        )
        .fetch_all(db)
        .await?;

        let mut branches: HashMap<Uuid, BranchAccess> = memberships
            .into_iter()
            .map(|m| (m.branch_id, BranchAccess { is_admin: m.is_admin, ..Default::default() }))
            .collect();

        // Grants of the permission groups attached to the actor's active
        // departments. department_member rows are removed by trigger when a
        // membership ends, so these are current branches. Plus the grants of
        // "Everyone", the school-wide default group, in every current branch.
        let grants = sqlx::query!(
            r#"
            SELECT dm.branch_id AS "branch_id!", gg.permission_key AS "permission_key!",
                   t.code AS "issue_type?", gg.scope AS "scope!: Scope", gg.department
            FROM department_member dm
            JOIN department d                    ON d.id = dm.department_id AND d.archived_at IS NULL
            JOIN department_permission_group dpg ON dpg.department_id = d.id
            JOIN permission_group_grant gg       ON gg.group_id = dpg.group_id
            LEFT JOIN issue_type t               ON t.id = gg.issue_type_id
            WHERE dm.user_id = $1
            UNION ALL
            SELECT m.branch_id, gg.permission_key, t.code, gg.scope, gg.department
            FROM branch_membership m
            JOIN permission_group pg       ON pg.is_default
            JOIN permission_group_grant gg ON gg.group_id = pg.id
            LEFT JOIN issue_type t         ON t.id = gg.issue_type_id
            WHERE m.user_id = $1 AND m.left_at IS NULL
            "#,
            user_id
        )
        .fetch_all(db)
        .await?;

        for row in grants {
            let Some(access) = branches.get_mut(&row.branch_id) else { continue };
            let permission = Permission::from_key(&row.permission_key)
                .ok_or_else(|| AppError::internal(format!("unknown permission {}", row.permission_key)))?;
            if let Some(department) = row.department {
                access.manages_members_of.push(department.to_lowercase());
                continue;
            }
            let issue_type = match row.issue_type.as_deref() {
                None => None,
                Some(code) => Some(
                    IssueType::from_code(code)
                        .ok_or_else(|| AppError::internal(format!("unknown issue type {code}")))?,
                ),
            };
            access.grants.push(Grant { permission, issue_type, scope: row.scope });
        }
        for access in branches.values_mut() {
            access.grants.sort();
            access.grants.dedup();
            access.manages_members_of.sort();
            access.manages_members_of.dedup();
        }

        let heads = sqlx::query_scalar!(
            r#"SELECT dm.department_id FROM department_member dm
               JOIN department d ON d.id = dm.department_id AND d.archived_at IS NULL
               WHERE dm.user_id = $1 AND dm.is_head"#,
            user_id
        )
        .fetch_all(db)
        .await?
        .into_iter()
        .collect();

        Ok(Self { user_id, is_super_admin, branches, heads })
    }

    pub fn branch(&self, branch_id: Uuid) -> Option<&BranchAccess> {
        self.branches.get(&branch_id)
    }

    pub fn heads(&self, department_id: Uuid) -> bool {
        self.heads.contains(&department_id)
    }

    pub fn is_admin_of(&self, branch_id: Uuid) -> bool {
        self.branch(branch_id).is_some_and(|b| b.is_admin)
    }
}
