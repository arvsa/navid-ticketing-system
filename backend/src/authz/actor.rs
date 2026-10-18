use std::collections::HashMap;

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
}

#[derive(Debug, Clone, Default)]
pub struct BranchAccess {
    pub is_admin: bool,
    /// Union of the grants of every active group the actor is in, in this branch only.
    pub grants: Vec<Grant>,
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
            .map(|m| (m.branch_id, BranchAccess { is_admin: m.is_admin, grants: Vec::new() }))
            .collect();

        // Grants via groups, active groups only. group_member rows are removed
        // by trigger when a membership ends, so these are current branches.
        let grants = sqlx::query!(
            r#"
            SELECT gm.branch_id, gp.permission_key, t.code AS "issue_type?", gp.scope AS "scope: Scope"
            FROM group_member gm
            JOIN user_group g        ON g.id = gm.group_id AND g.archived_at IS NULL
            JOIN group_permission gp ON gp.group_id = g.id
            LEFT JOIN issue_type t   ON t.id = gp.issue_type_id
            WHERE gm.user_id = $1
            "#,
            user_id
        )
        .fetch_all(db)
        .await?;

        for row in grants {
            let Some(access) = branches.get_mut(&row.branch_id) else { continue };
            let permission = Permission::from_key(&row.permission_key)
                .ok_or_else(|| AppError::internal(format!("unknown permission {}", row.permission_key)))?;
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
        }

        Ok(Self { user_id, is_super_admin, branches })
    }

    pub fn branch(&self, branch_id: Uuid) -> Option<&BranchAccess> {
        self.branches.get(&branch_id)
    }

    pub fn is_admin_of(&self, branch_id: Uuid) -> bool {
        self.branch(branch_id).is_some_and(|b| b.is_admin)
    }
}
