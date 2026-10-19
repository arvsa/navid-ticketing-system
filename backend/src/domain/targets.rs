//! Issue targets and the work items they produce (BACKEND_PLAN.md 7.2).
//!
//! | Target | `shared` (default)              | `per_member`                       |
//! |--------|---------------------------------|------------------------------------|
//! | user   | 1 item, assigned to that user   | same                               |
//! | group  | 1 unassigned item; claimable    | 1 item per current member          |
//! | branch | 1 unassigned item; admin assigns| 1 item per current branch member   |
//!
//! Only Actions and Reports get work items.

use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    notifications::{self, Kind, Notice},
    types::{CompletionMode, TargetKind, WorkStatus},
};
use crate::{
    authz::{Actor, IssueType},
    db::Tx,
    error::{AppError, AppResult},
};

/// A recipient: exactly one of `user_id`, `group_id` or `branch_id` (whole
/// branch; super admins only), e.g. `{"group_id": "..."}`. Zero or several
/// fields set is `422 invalid_target`. Send one target per recipient.
#[derive(Debug, Clone, Deserialize, utoipa::ToSchema)]
pub struct TargetInput {
    pub user_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    pub branch_id: Option<Uuid>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedTarget {
    pub kind: TargetKind,
    pub branch_id: Uuid,
    pub user_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Target {
    pub id: Uuid,
    pub kind: TargetKind,
    pub branch_id: Uuid,
    pub user_id: Option<Uuid>,
    pub group_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// What target and work-item code needs to know about the issue.
#[derive(Debug, Clone, Copy)]
pub struct IssueCtx {
    pub id: Uuid,
    pub branch_id: Option<Uuid>,
    pub issue_type: IssueType,
    pub completion_mode: CompletionMode,
}

impl IssueCtx {
    fn has_work_items(&self) -> bool {
        matches!(self.issue_type, IssueType::Action | IssueType::Report)
    }
}

/// Shape check. Cross-branch issues take only whole-branch targets; branch
/// issues take users and groups of their branch, or the branch itself.
pub fn resolve(input: &TargetInput, issue_branch: Option<Uuid>) -> AppResult<ResolvedTarget> {
    let invalid = |msg: &'static str| AppError::validation("invalid_target", msg);
    let target = match (input.user_id, input.group_id, input.branch_id) {
        (Some(user), None, None) => {
            let branch = issue_branch.ok_or_else(|| invalid("cross-branch issues can only target whole branches"))?;
            ResolvedTarget { kind: TargetKind::User, branch_id: branch, user_id: Some(user), group_id: None }
        }
        (None, Some(group), None) => {
            let branch = issue_branch.ok_or_else(|| invalid("cross-branch issues can only target whole branches"))?;
            ResolvedTarget { kind: TargetKind::Group, branch_id: branch, user_id: None, group_id: Some(group) }
        }
        (None, None, Some(branch)) => {
            if issue_branch.is_some_and(|b| b != branch) {
                return Err(invalid("targets must be in the issue's branch"));
            }
            ResolvedTarget { kind: TargetKind::Branch, branch_id: branch, user_id: None, group_id: None }
        }
        _ => return Err(invalid("a target has exactly one of user_id, group_id or branch_id")),
    };
    Ok(target)
}

/// The referenced user, group or branch must exist and be usable.
async fn validate(tx: &mut Tx, t: &ResolvedTarget) -> AppResult<()> {
    let ok = match t.kind {
        TargetKind::User => sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM branch_membership m JOIN app_user u ON u.id = m.user_id
                              WHERE m.user_id = $1 AND m.branch_id = $2 AND m.left_at IS NULL AND u.is_active) AS "ok!""#,
            t.user_id,
            t.branch_id
        )
        .fetch_one(&mut **tx)
        .await?,
        TargetKind::Group => sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM user_group
                              WHERE id = $1 AND branch_id = $2 AND archived_at IS NULL) AS "ok!""#,
            t.group_id,
            t.branch_id
        )
        .fetch_one(&mut **tx)
        .await?,
        TargetKind::Branch => sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM branch WHERE id = $1 AND is_active) AS "ok!""#,
            t.branch_id
        )
        .fetch_one(&mut **tx)
        .await?,
    };
    if !ok {
        let msg = match t.kind {
            TargetKind::User => "the user is not an active member of the branch",
            TargetKind::Group => "the group doesn't exist in the branch or is archived",
            TargetKind::Branch => "the branch doesn't exist or is inactive",
        };
        return Err(AppError::validation("invalid_target", msg));
    }
    Ok(())
}

pub struct Added {
    pub target_id: Uuid,
    /// (work item, assignee) for every item created.
    pub work_items: Vec<(Uuid, Option<Uuid>)>,
    /// People told about a ticket aimed at them (Tickets have no work items).
    pub notified: Vec<Uuid>,
}

/// Inserts a target and its work items (Actions and Reports), audits it, and
/// notifies new assignees.
pub async fn add(
    tx: &mut Tx,
    actor: &Actor,
    issue: IssueCtx,
    target: ResolvedTarget,
    sla_due_at: Option<OffsetDateTime>,
) -> AppResult<Added> {
    validate(tx, &target).await?;
    let target_id = sqlx::query_scalar!(
        r#"
        INSERT INTO issue_target (issue_id, branch_id, kind, group_id, user_id, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
        "#,
        issue.id,
        target.branch_id,
        target.kind as TargetKind,
        target.group_id,
        target.user_id,
        actor.user_id,
    )
    .fetch_one(&mut **tx)
    .await?;

    audit::record(
        tx,
        AuditEntry {
            entity_type: "issue_target",
            entity_id: target_id.to_string(),
            branch_id: Some(target.branch_id),
            actor_id: Some(actor.user_id),
            action: "add",
            old_value: None,
            new_value: Some(json!({
                "issue_id": issue.id, "kind": target.kind, "user_id": target.user_id, "group_id": target.group_id,
                "branch_id": target.branch_id,
            })),
        },
    )
    .await?;

    let mut work_items = Vec::new();
    if issue.has_work_items() {
        let assignees: Vec<Option<Uuid>> = match (target.kind, issue.completion_mode) {
            (TargetKind::User, _) => vec![target.user_id],
            (_, CompletionMode::Shared) => vec![None],
            // A snapshot of the current, active members.
            (TargetKind::Group, CompletionMode::PerMember) => {
                sqlx::query_scalar!(
                    r#"SELECT gm.user_id AS "user_id?" FROM group_member gm JOIN app_user u ON u.id = gm.user_id
                   WHERE gm.group_id = $1 AND u.is_active ORDER BY gm.user_id"#,
                    target.group_id
                )
                .fetch_all(&mut **tx)
                .await?
            }
            (TargetKind::Branch, CompletionMode::PerMember) => {
                sqlx::query_scalar!(
                    r#"SELECT m.user_id AS "user_id?" FROM branch_membership m JOIN app_user u ON u.id = m.user_id
                   WHERE m.branch_id = $1 AND m.left_at IS NULL AND u.is_active ORDER BY m.user_id"#,
                    target.branch_id
                )
                .fetch_all(&mut **tx)
                .await?
            }
        };

        for assignee in assignees {
            let item_id = sqlx::query_scalar!(
                r#"
                INSERT INTO work_item (issue_id, target_id, branch_id, assignee_id, sla_due_at)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id
                "#,
                issue.id,
                target_id,
                target.branch_id,
                assignee,
                sla_due_at,
            )
            .fetch_one(&mut **tx)
            .await?;
            audit::record(
                tx,
                AuditEntry {
                    entity_type: "work_item",
                    entity_id: item_id.to_string(),
                    branch_id: Some(target.branch_id),
                    actor_id: Some(actor.user_id),
                    action: "create",
                    old_value: None,
                    new_value: Some(json!({
                        "issue_id": issue.id, "target_id": target_id, "assignee_id": assignee, "sla_due_at": audit::time(sla_due_at),
                    })),
                },
            )
            .await?;
            if let Some(user) = assignee {
                notifications::notify(
                    tx,
                    &[user],
                    Notice {
                        kind: Kind::Assigned,
                        branch_id: Some(target.branch_id),
                        issue_id: Some(issue.id),
                        work_item_id: Some(item_id),
                        actor_id: Some(actor.user_id),
                        payload: json!({}),
                    },
                )
                .await?;
            }
            work_items.push((item_id, assignee));
        }
    }

    // Tickets have no work items, so nothing above tells the people a ticket
    // is aimed at. A whole-branch target is covered by the branch admins.
    let mut notified = Vec::new();
    if issue.issue_type == IssueType::Ticket {
        notified = match target.kind {
            TargetKind::User => target.user_id.into_iter().collect(),
            TargetKind::Group => {
                sqlx::query_scalar!(
                    r#"SELECT gm.user_id FROM group_member gm JOIN app_user u ON u.id = gm.user_id
                   WHERE gm.group_id = $1 AND u.is_active ORDER BY gm.user_id"#,
                    target.group_id
                )
                .fetch_all(&mut **tx)
                .await?
            }
            TargetKind::Branch => Vec::new(),
        };
        if !notified.is_empty() {
            let title =
                sqlx::query_scalar!("SELECT title FROM issue WHERE id = $1", issue.id).fetch_one(&mut **tx).await?;
            notifications::notify(
                tx,
                &notified,
                Notice {
                    kind: Kind::TicketCreated,
                    branch_id: Some(target.branch_id),
                    issue_id: Some(issue.id),
                    work_item_id: None,
                    actor_id: Some(actor.user_id),
                    payload: json!({ "title": title }),
                },
            )
            .await?;
        }
    }

    Ok(Added { target_id, work_items, notified })
}

/// Marks a target removed and cancels its non-final work items (they are
/// never deleted). Returns the cancelled items.
pub async fn remove(tx: &mut Tx, actor: &Actor, issue_id: Uuid, target_id: Uuid) -> AppResult<Vec<Uuid>> {
    let target = sqlx::query!(
        r#"UPDATE issue_target SET removed_at = now(), removed_by = $3
           WHERE id = $1 AND issue_id = $2 AND removed_at IS NULL
           RETURNING branch_id, kind AS "kind: TargetKind", user_id, group_id"#,
        target_id,
        issue_id,
        actor.user_id,
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AppError::NotFound)?;

    audit::record(
        tx,
        AuditEntry {
            entity_type: "issue_target",
            entity_id: target_id.to_string(),
            branch_id: Some(target.branch_id),
            actor_id: Some(actor.user_id),
            action: "remove",
            old_value: Some(json!({
                "issue_id": issue_id, "kind": target.kind, "user_id": target.user_id, "group_id": target.group_id,
            })),
            new_value: None,
        },
    )
    .await?;

    cancel_items(tx, Some(actor.user_id), issue_id, Some(target_id), "target_removed").await
}

/// Cancels the non-final work items of an issue (or of one of its targets).
pub async fn cancel_items(
    tx: &mut Tx,
    actor_id: Option<Uuid>,
    issue_id: Uuid,
    target_id: Option<Uuid>,
    reason: &'static str,
) -> AppResult<Vec<Uuid>> {
    let cancelled = sqlx::query!(
        r#"
        UPDATE work_item w SET status = 'cancelled', version = w.version + 1
        FROM work_item old
        WHERE w.id = old.id AND w.issue_id = $1 AND ($2::uuid IS NULL OR w.target_id = $2)
          AND w.status NOT IN ('approved', 'cancelled')
        RETURNING w.id, w.branch_id, old.status AS "old_status: WorkStatus"
        "#,
        issue_id,
        target_id,
    )
    .fetch_all(&mut **tx)
    .await?;

    for item in &cancelled {
        audit::record(
            tx,
            AuditEntry {
                entity_type: "work_item",
                entity_id: item.id.to_string(),
                branch_id: Some(item.branch_id),
                actor_id,
                action: "cancel",
                old_value: Some(json!({ "status": item.old_status })),
                new_value: Some(json!({ "status": "cancelled", "reason": reason })),
            },
        )
        .await?;
    }
    Ok(cancelled.into_iter().map(|i| i.id).collect())
}
