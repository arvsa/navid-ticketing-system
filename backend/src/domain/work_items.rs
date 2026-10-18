//! The work item state machine (BACKEND_PLAN.md 7.3).
//!
//! ```text
//! open ──► in_progress ◄──► blocked
//!   │           │              │
//!   └───────────┴──────────────┴──► pending_approval ──► approved
//!                                         │
//!                                         └── reject (note required) ──► in_progress
//! any non-final state ──► cancelled
//! ```

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    issues,
    notifications::{self, Kind, Notice},
    types::{CompletionMode, IssueState, TargetKind, WorkStatus},
};
use crate::{
    authz::{authorize, relations, Action, Actor, IssueFilter},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WorkItem {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub target_id: Uuid,
    pub branch_id: Uuid,
    pub assignee_id: Option<Uuid>,
    pub status: WorkStatus,
    #[serde(with = "time::serde::rfc3339::option")]
    pub sla_due_at: Option<OffsetDateTime>,
    pub is_overdue: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub submitted_at: Option<OffsetDateTime>,
    pub decided_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub decided_at: Option<OffsetDateTime>,
    pub decision_note: Option<String>,
    pub version: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

pub(crate) async fn for_issue(db: &PgPool, issue_id: Uuid) -> AppResult<Vec<WorkItem>> {
    Ok(sqlx::query_as!(
        WorkItem,
        r#"
        SELECT id AS "id!", issue_id AS "issue_id!", target_id AS "target_id!", branch_id AS "branch_id!",
               assignee_id, status AS "status!: WorkStatus", sla_due_at, is_overdue AS "is_overdue!",
               submitted_at, decided_by, decided_at, decision_note, version AS "version!",
               created_at AS "created_at!", updated_at AS "updated_at!"
        FROM work_item_overview WHERE issue_id = $1 ORDER BY created_at, id
        "#,
        issue_id
    )
    .fetch_all(db)
    .await?)
}

async fn fetch(db: &PgPool, id: Uuid) -> AppResult<WorkItem> {
    Ok(sqlx::query_as!(
        WorkItem,
        r#"
        SELECT id AS "id!", issue_id AS "issue_id!", target_id AS "target_id!", branch_id AS "branch_id!",
               assignee_id, status AS "status!: WorkStatus", sla_due_at, is_overdue AS "is_overdue!",
               submitted_at, decided_by, decided_at, decision_note, version AS "version!",
               created_at AS "created_at!", updated_at AS "updated_at!"
        FROM work_item_overview WHERE id = $1
        "#,
        id
    )
    .fetch_one(db)
    .await?)
}

pub async fn get(db: &PgPool, actor: &Actor, id: Uuid) -> AppResult<WorkItem> {
    let facts = relations::load_work_item(db, actor, id).await?.ok_or(AppError::NotFound)?;
    authorize(actor, Action::ReadIssue { issue: &facts.issue })?;
    fetch(db, id).await
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct WorkItemQuery {
    /// `me`: only items assigned to the actor.
    pub assignee: Option<String>,
    pub status: Option<WorkStatus>,
    pub branch_id: Option<Uuid>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Cursor {
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    id: Uuid,
}

pub async fn list(db: &PgPool, actor: &Actor, query: &WorkItemQuery, page: &PageParams) -> AppResult<Page<WorkItem>> {
    let limit = page.limit()?;
    let after: Option<Cursor> = page.cursor()?;
    let assignee_me = match query.assignee.as_deref() {
        None => false,
        Some("me") => true,
        Some(_) => return Err(AppError::validation("invalid_query", "assignee only supports `me`")),
    };
    let filter = IssueFilter::for_actor(actor).into_json();
    let rows = sqlx::query_as!(
        WorkItem,
        r#"
        SELECT w.id AS "id!", w.issue_id AS "issue_id!", w.target_id AS "target_id!", w.branch_id AS "branch_id!",
               w.assignee_id, w.status AS "status!: WorkStatus", w.sla_due_at, w.is_overdue AS "is_overdue!",
               w.submitted_at, w.decided_by, w.decided_at, w.decision_note, w.version AS "version!",
               w.created_at AS "created_at!", w.updated_at AS "updated_at!"
        FROM work_item_overview w
        JOIN issue i ON i.id = w.issue_id
        WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
          AND (NOT $2 OR w.assignee_id = $3)
          AND ($4::work_status IS NULL OR w.status = $4)
          AND ($5::uuid IS NULL OR w.branch_id = $5)
          AND ($6::timestamptz IS NULL OR (w.created_at, w.id) < ($6, $7))
        ORDER BY w.created_at DESC, w.id DESC
        LIMIT $8
        "#,
        filter,
        assignee_me,
        actor.user_id,
        query.status as Option<WorkStatus>,
        query.branch_id,
        after.as_ref().map(|c| c.created_at),
        after.as_ref().map(|c| c.id),
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |w| Cursor { created_at: w.created_at, id: w.id }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Transition {
    Start,
    Block,
    Unblock,
    Submit,
    Approve,
    Reject,
    Claim,
    Assign,
    Cancel,
}

impl Transition {
    fn name(self) -> &'static str {
        match self {
            Self::Start => "start",
            Self::Block => "block",
            Self::Unblock => "unblock",
            Self::Submit => "submit",
            Self::Approve => "approve",
            Self::Reject => "reject",
            Self::Claim => "claim",
            Self::Assign => "assign",
            Self::Cancel => "cancel",
        }
    }
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct TransitionInput {
    /// The version the client last saw.
    pub version: i32,
    /// Approve (optional) and reject (required).
    pub note: Option<String>,
    /// Assign only.
    pub assignee_id: Option<Uuid>,
}

pub async fn transition(
    db: &PgPool,
    actor: &Actor,
    id: Uuid,
    t: Transition,
    input: TransitionInput,
) -> AppResult<WorkItem> {
    let facts = relations::load_work_item(db, actor, id).await?.ok_or(AppError::NotFound)?;
    let item = &facts;
    authorize(
        actor,
        match t {
            Transition::Start | Transition::Block | Transition::Unblock | Transition::Submit => {
                Action::UpdateWorkItem { item }
            }
            Transition::Approve | Transition::Reject => Action::ApproveWorkItem { item },
            Transition::Claim => Action::ClaimWorkItem { item },
            Transition::Assign => Action::AssignWorkItem { item },
            Transition::Cancel => Action::CancelWorkItem { item },
        },
    )?;
    let note = input.note.as_deref().map(str::trim).filter(|n| !n.is_empty()).map(str::to_owned);

    let mut tx = db.begin().await?;
    // Lock the item and its issue: auto-close decisions on the same issue
    // are serialized.
    let cur = sqlx::query!(
        r#"
        SELECT w.status AS "status: WorkStatus", w.version, w.assignee_id, w.branch_id, w.issue_id,
               i.state AS "state: IssueState", ty.code AS issue_type, i.requires_super_admin_approval,
               i.completion_mode AS "completion_mode: CompletionMode", t.kind AS "target_kind: TargetKind"
        FROM work_item w
        JOIN issue i ON i.id = w.issue_id
        JOIN issue_type ty ON ty.id = i.type_id
        JOIN issue_target t ON t.id = w.target_id
        WHERE w.id = $1
        FOR UPDATE OF w, i
        "#,
        id
    )
    .fetch_one(&mut *tx)
    .await?;

    if cur.version != input.version {
        return Err(AppError::version_conflict());
    }
    if cur.state != IssueState::Open {
        return Err(AppError::conflict("issue_not_open", "the issue is closed or cancelled"));
    }
    if cur.status.is_final() {
        return Err(invalid(t, cur.status));
    }

    use WorkStatus::*;
    let from = cur.status;
    let mut assignee = cur.assignee_id;
    let mut submitted = false;
    let mut decision: Option<Option<String>> = None;
    let to = match t {
        Transition::Start | Transition::Block | Transition::Unblock | Transition::Submit if assignee.is_none() => {
            return Err(AppError::conflict("not_assigned", "assign or claim the work before working on it"));
        }
        Transition::Start if from == Open => InProgress,
        Transition::Block if from == InProgress => Blocked,
        Transition::Unblock if from == Blocked => InProgress,
        Transition::Submit if matches!(from, Open | InProgress | Blocked) => {
            if cur.issue_type == "report" {
                let has_report = sqlx::query_scalar!(
                    r#"SELECT EXISTS (SELECT 1 FROM issue_report
                                      WHERE work_item_id = $1 AND submitted_at IS NOT NULL) AS "ok!""#,
                    id
                )
                .fetch_one(&mut *tx)
                .await?;
                if !has_report {
                    return Err(AppError::validation("report_required", "submit a written report for this work first"));
                }
            }
            submitted = true;
            PendingApproval
        }
        Transition::Approve | Transition::Reject if from == PendingApproval => {
            // Re-checked under the lock: nobody decides on their own work.
            if assignee == Some(actor.user_id) {
                return Err(AppError::forbidden("forbidden", "you can't approve or reject your own work"));
            }
            if t == Transition::Reject {
                let Some(n) = &note else {
                    return Err(AppError::validation("note_required", "explain why the work is rejected"));
                };
                decision = Some(Some(n.clone()));
                InProgress
            } else {
                decision = Some(note.clone());
                Approved
            }
        }
        Transition::Claim => {
            if cur.target_kind != TargetKind::Group || cur.completion_mode != CompletionMode::Shared {
                return Err(AppError::conflict("not_claimable", "only shared work sent to a group can be claimed"));
            }
            if assignee.is_some() {
                return Err(AppError::conflict("already_assigned", "someone has already taken this work"));
            }
            assignee = Some(actor.user_id);
            from
        }
        Transition::Assign => {
            let new = input
                .assignee_id
                .ok_or_else(|| AppError::validation("assignee_required", "assignee_id is required"))?;
            let eligible = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT 1 FROM branch_membership m JOIN app_user u ON u.id = m.user_id
                                  WHERE m.user_id = $1 AND m.branch_id = $2 AND m.left_at IS NULL AND u.is_active) AS "ok!""#,
                new,
                cur.branch_id
            )
            .fetch_one(&mut *tx)
            .await?;
            if !eligible {
                return Err(AppError::validation(
                    "invalid_assignee",
                    "the assignee must be an active member of the branch",
                ));
            }
            assignee = Some(new);
            from
        }
        Transition::Cancel => Cancelled,
        _ => return Err(invalid(t, from)),
    };

    sqlx::query!(
        r#"
        UPDATE work_item SET
            status = $3,
            assignee_id = $4,
            submitted_at = CASE WHEN $5 THEN now() ELSE submitted_at END,
            decided_by = CASE WHEN $6 THEN $7 ELSE decided_by END,
            decided_at = CASE WHEN $6 THEN now() ELSE decided_at END,
            decision_note = CASE WHEN $6 THEN $8 ELSE decision_note END,
            version = version + 1
        WHERE id = $1 AND version = $2
        "#,
        id,
        input.version,
        to as WorkStatus,
        assignee,
        submitted,
        decision.is_some(),
        actor.user_id,
        decision.clone().flatten(),
    )
    .execute(&mut *tx)
    .await?;

    let mut old_v = json!({ "status": from });
    let mut new_v = json!({ "status": to });
    if assignee != cur.assignee_id {
        old_v["assignee_id"] = json!(cur.assignee_id);
        new_v["assignee_id"] = json!(assignee);
    }
    if let Some(n) = &decision {
        new_v["decision_note"] = json!(n);
    }
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "work_item",
            entity_id: id.to_string(),
            branch_id: Some(cur.branch_id),
            actor_id: Some(actor.user_id),
            action: t.name(),
            old_value: Some(old_v),
            new_value: Some(new_v),
        },
    )
    .await?;

    let notice = |kind, payload| Notice {
        kind,
        branch_id: Some(cur.branch_id),
        issue_id: Some(cur.issue_id),
        work_item_id: Some(id),
        actor_id: Some(actor.user_id),
        payload,
    };
    match t {
        Transition::Submit => {
            let approvers =
                approvers(&mut tx, cur.branch_id, &cur.issue_type, cur.requires_super_admin_approval).await?;
            let approvers: Vec<Uuid> = approvers.into_iter().filter(|a| Some(*a) != assignee).collect();
            notifications::notify(&mut tx, &approvers, notice(Kind::SubmittedForApproval, json!({}))).await?;
        }
        Transition::Approve => {
            notifications::notify(&mut tx, assignee.as_slice(), notice(Kind::Approved, json!({ "note": note })))
                .await?;
        }
        Transition::Reject => {
            notifications::notify(&mut tx, assignee.as_slice(), notice(Kind::Rejected, json!({ "note": note })))
                .await?;
        }
        Transition::Claim | Transition::Assign if assignee != cur.assignee_id => {
            notifications::notify(&mut tx, assignee.as_slice(), notice(Kind::Assigned, json!({}))).await?;
            notifications::notify(&mut tx, cur.assignee_id.as_slice(), notice(Kind::Unassigned, json!({}))).await?;
        }
        Transition::Cancel => {
            notifications::notify(&mut tx, assignee.as_slice(), notice(Kind::StatusChanged, json!({ "status": to })))
                .await?;
        }
        _ => {}
    }

    if to.is_final() {
        issues::auto_close_if_done(&mut tx, cur.issue_id).await?;
    }
    issues::emit(&mut tx, "work_item_updated", cur.issue_id).await?;
    tx.commit().await?;
    fetch(db, id).await
}

fn invalid(t: Transition, from: WorkStatus) -> AppError {
    AppError::conflict("invalid_transition", format!("can't {} work that is {}", t.name(), from.as_str()))
}

/// Everyone who can approve work on the issue: all active super admins for a
/// super admin issue; otherwise the branch's admins and members holding
/// `work_item.approve` for the type.
async fn approvers(tx: &mut Tx, branch_id: Uuid, issue_type: &str, super_issue: bool) -> AppResult<Vec<Uuid>> {
    if super_issue {
        return Ok(sqlx::query_scalar!("SELECT id FROM app_user WHERE is_super_admin AND is_active")
            .fetch_all(&mut **tx)
            .await?);
    }
    Ok(sqlx::query_scalar!(
        r#"
        SELECT m.user_id FROM branch_membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.branch_id = $1 AND m.left_at IS NULL AND u.is_active
          AND (m.is_admin OR EXISTS (
                SELECT 1 FROM group_member gm
                JOIN user_group g ON g.id = gm.group_id AND g.archived_at IS NULL
                JOIN group_permission gp ON gp.group_id = g.id
                WHERE gm.user_id = m.user_id AND gm.branch_id = $1
                  AND gp.permission_key = 'work_item.approve' AND gp.scope = 'branch'
                  AND (gp.issue_type_id IS NULL OR gp.issue_type_id = (SELECT id FROM issue_type WHERE code = $2))))
        "#,
        branch_id,
        issue_type
    )
    .fetch_all(&mut **tx)
    .await?)
}
