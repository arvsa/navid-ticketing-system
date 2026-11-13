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
    /// `None` = school-wide issue, sent to other branches by a branch admin
    /// or a holder of `issue.target_other_branches` (or by a super admin).
    pub branch_id: Option<Uuid>,
    pub issue_type: IssueType,
    pub created_by: Uuid,
    /// Distinct branches of the issue's active targets.
    pub target_branch_ids: Vec<Uuid>,
    /// The groups among the issue's active targets.
    pub target_group_ids: Vec<Uuid>,
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
        SELECT i.id, i.branch_id, ty.code AS issue_type, i.created_by,
               ARRAY(SELECT DISTINCT t.branch_id FROM issue_target t
                     WHERE t.issue_id = i.id AND t.removed_at IS NULL) AS "target_branch_ids!",
               ARRAY(SELECT t.group_id FROM issue_target t
                     WHERE t.issue_id = i.id AND t.removed_at IS NULL AND t.group_id IS NOT NULL) AS "target_group_ids!",
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
        created_by: r.created_by,
        target_branch_ids: r.target_branch_ids,
        target_group_ids: r.target_group_ids,
        actor_targeted: r.targeted,
    }))
}

/// A work item, with its issue and the actor's relation to it.
#[derive(Debug, Clone)]
pub struct WorkItemFacts {
    pub id: Uuid,
    pub branch_id: Uuid,
    pub assignee_id: Option<Uuid>,
    /// Who reviews the holder's hand-in when the work was passed along: one
    /// level up the chain. `None`: the item's usual approvers.
    pub reviewer: Option<Uuid>,
    /// The actor belongs to the item's target: is the user target, a current
    /// member of the target group, or a member of the target branch.
    pub actor_in_target: bool,
    /// The target group, when the work was sent to a group.
    pub target_group_id: Option<Uuid>,
    pub issue: IssueFacts,
}

pub async fn load_work_item(db: &PgPool, actor: &Actor, work_item_id: Uuid) -> AppResult<Option<WorkItemFacts>> {
    let my_branches: Vec<Uuid> = actor.branches.keys().copied().collect();
    let Some(row) = sqlx::query!(
        r#"
        SELECT w.id, w.issue_id, w.branch_id, w.assignee_id, work_reviewer(w.handoff_chain, w.assignee_id) AS reviewer,
               t.group_id AS target_group_id,
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
        reviewer: row.reviewer,
        actor_in_target: row.in_target,
        target_group_id: row.target_group_id,
        issue,
    }))
}
