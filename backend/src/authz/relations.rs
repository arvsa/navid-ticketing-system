//! Loads the facts `policy::authorize` needs about a resource, relative to
//! the actor (own / targeted). Keep the "targeted" definition here in sync
//! with `issue_visible` (migration 0002).

use std::collections::HashMap;

use sqlx::PgPool;
use uuid::Uuid;

use super::{Actor, IssueType};
use crate::error::{AppError, AppResult};

/// A user an action is aimed at (member management, activation, ...).
#[derive(Debug, Clone)]
pub struct UserFacts {
    pub user_id: Uuid,
    pub is_super_admin: bool,
    pub is_active: bool,
    /// Current memberships: branch -> is_admin.
    pub branches: HashMap<Uuid, bool>,
    /// Branches the user has left.
    pub departed: Vec<Uuid>,
}

impl UserFacts {
    pub fn is_admin_anywhere(&self) -> bool {
        self.branches.values().any(|is_admin| *is_admin)
    }

    pub fn is_member_of(&self, branch_id: Uuid) -> bool {
        self.branches.contains_key(&branch_id)
    }
}

pub async fn load_user(db: &PgPool, user_id: Uuid) -> AppResult<Option<UserFacts>> {
    let Some(user) = sqlx::query!("SELECT is_super_admin, is_active FROM app_user WHERE id = $1", user_id)
        .fetch_optional(db)
        .await?
    else {
        return Ok(None);
    };
    let memberships = sqlx::query!(
        r#"SELECT branch_id, is_admin, left_at IS NOT NULL AS "departed!" FROM branch_membership WHERE user_id = $1"#,
        user_id
    )
    .fetch_all(db)
    .await?;

    let mut branches = HashMap::new();
    let mut departed = Vec::new();
    for m in memberships {
        if m.departed {
            departed.push(m.branch_id);
        } else {
            branches.insert(m.branch_id, m.is_admin);
        }
    }
    Ok(Some(UserFacts { user_id, is_super_admin: user.is_super_admin, is_active: user.is_active, branches, departed }))
}

/// An issue, with the actor's relation to it.
#[derive(Debug, Clone)]
pub struct IssueFacts {
    pub id: Uuid,
    /// `None` = cross-branch (super admin) issue.
    pub branch_id: Option<Uuid>,
    pub issue_type: IssueType,
    pub is_private: bool,
    pub created_by: Uuid,
    pub requires_super_admin_approval: bool,
    /// Distinct branches of the issue's active targets.
    pub target_branch_ids: Vec<Uuid>,
    /// The actor is a user target, a current member of a group target, a
    /// member of a branch target's branch, or the assignee of a work item,
    /// always as a current member of that branch.
    pub actor_targeted: bool,
}

impl IssueFacts {
    /// The branches whose rules apply to the issue itself: its own branch,
    /// or every targeted branch for a cross-branch issue.
    pub fn branches(&self) -> Vec<Uuid> {
        match self.branch_id {
            Some(b) => vec![b],
            None => self.target_branch_ids.clone(),
        }
    }
}

pub async fn load_issue(db: &PgPool, actor: &Actor, issue_id: Uuid) -> AppResult<Option<IssueFacts>> {
    let my_branches: Vec<Uuid> = actor.branches.keys().copied().collect();
    let row = sqlx::query!(
        r#"
        SELECT i.id, i.branch_id, ty.code AS issue_type, i.is_private, i.created_by, i.requires_super_admin_approval,
               ARRAY(SELECT DISTINCT t.branch_id FROM issue_target t
                     WHERE t.issue_id = i.id AND t.removed_at IS NULL) AS "target_branch_ids!",
               (EXISTS (SELECT 1 FROM issue_target t
                        WHERE t.issue_id = i.id AND t.removed_at IS NULL AND (
                              (t.user_id = $2 AND t.branch_id = ANY($3))
                           OR t.group_id IN (SELECT gm.group_id FROM group_member gm WHERE gm.user_id = $2)
                           OR (t.kind = 'branch' AND t.branch_id = ANY($3))))
                OR EXISTS (SELECT 1 FROM work_item w JOIN issue_target t ON t.id = w.target_id
                           WHERE w.issue_id = i.id AND w.assignee_id = $2 AND t.removed_at IS NULL
                             AND w.branch_id = ANY($3))) AS "targeted!"
        FROM issue i
        JOIN issue_type ty ON ty.id = i.type_id
        WHERE i.id = $1
        "#,
        issue_id,
        actor.user_id,
        &my_branches,
    )
    .fetch_optional(db)
    .await?;

    let Some(r) = row else { return Ok(None) };
    let issue_type = IssueType::from_code(&r.issue_type)
        .ok_or_else(|| AppError::internal(format!("unknown issue type {}", r.issue_type)))?;
    Ok(Some(IssueFacts {
        id: r.id,
        branch_id: r.branch_id,
        issue_type,
        is_private: r.is_private,
        created_by: r.created_by,
        requires_super_admin_approval: r.requires_super_admin_approval,
        target_branch_ids: r.target_branch_ids,
        actor_targeted: r.targeted,
    }))
}

/// A work item, with its issue and the actor's relation to it.
#[derive(Debug, Clone)]
pub struct WorkItemFacts {
    pub id: Uuid,
    pub branch_id: Uuid,
    pub assignee_id: Option<Uuid>,
    /// The actor belongs to the item's target: is the user target, a current
    /// member of the target group, or a member of the target branch.
    pub actor_in_target: bool,
    pub issue: IssueFacts,
}

pub async fn load_work_item(db: &PgPool, actor: &Actor, work_item_id: Uuid) -> AppResult<Option<WorkItemFacts>> {
    let my_branches: Vec<Uuid> = actor.branches.keys().copied().collect();
    let Some(row) = sqlx::query!(
        r#"
        SELECT w.id, w.issue_id, w.branch_id, w.assignee_id,
               -- coalesce: `NULL IN (...)` is NULL, not false, for non-group targets
               coalesce(t.removed_at IS NULL AND (
                    (t.user_id = $2 AND t.branch_id = ANY($3))
                 OR t.group_id IN (SELECT gm.group_id FROM group_member gm WHERE gm.user_id = $2)
                 OR (t.kind = 'branch' AND t.branch_id = ANY($3))), false) AS "in_target!"
        FROM work_item w
        JOIN issue_target t ON t.id = w.target_id
        WHERE w.id = $1
        "#,
        work_item_id,
        actor.user_id,
        &my_branches,
    )
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };
    let issue = load_issue(db, actor, row.issue_id).await?.ok_or(AppError::NotFound)?;
    Ok(Some(WorkItemFacts {
        id: row.id,
        branch_id: row.branch_id,
        assignee_id: row.assignee_id,
        actor_in_target: row.in_target,
        issue,
    }))
}
