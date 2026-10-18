//! `GET /api/dashboard?branch_id=` (BACKEND_PLAN.md section 9).
//!
//! Per branch: with `dashboard.branch` (or admin) the branch-wide numbers;
//! without it, only the public open-ticket count. Plus the actor's own
//! numbers across the selected branches. Every count goes through the
//! `issue_visible` filter, so nothing private is counted for someone who
//! couldn't see it. Live queries, no caching.

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{events::RsvpResponse, notifications, types::WorkStatus};
use crate::{
    authz::{authorize, relations, Action, Actor, IssueFilter},
    error::AppResult,
};

pub const UPCOMING_DAYS: i64 = 14;
pub const UPCOMING_LIMIT: i64 = 50;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Dashboard {
    #[serde(with = "time::serde::rfc3339")]
    pub generated_at: OffsetDateTime,
    pub branches: Vec<BranchNumbers>,
    pub mine: MyNumbers,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum NumbersScope {
    /// Branch-wide numbers (`dashboard.branch` or admin).
    Branch,
    /// Only the actor's own numbers and public ticket counts.
    Personal,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct BranchNumbers {
    pub branch_id: Uuid,
    pub code: String,
    pub name: String,
    pub scope: NumbersScope,
    /// Open, non-private tickets the actor can see. Always present.
    pub open_public_tickets: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_issues_by_type: Option<TypeCounts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_items_by_status: Option<StatusCounts>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overdue_work_items: Option<i64>,
    /// Open work due from now to the end of the 7th day after today, in
    /// the branch's timezone.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub due_next_7_days: Option<i64>,
}

#[derive(Debug, Default, Serialize, utoipa::ToSchema)]
pub struct TypeCounts {
    pub ticket: i64,
    pub report: i64,
    pub event: i64,
    pub action: i64,
}

#[derive(Debug, Default, Serialize, utoipa::ToSchema)]
pub struct StatusCounts {
    pub open: i64,
    pub in_progress: i64,
    pub blocked: i64,
    pub pending_approval: i64,
    pub approved: i64,
    pub cancelled: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MyNumbers {
    pub open_work_items: i64,
    pub awaiting_my_approval: i64,
    pub upcoming_events: Vec<UpcomingEvent>,
    pub unread_notifications: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UpcomingEvent {
    pub issue_id: Uuid,
    pub key: String,
    pub title: String,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    pub my_rsvp: Option<RsvpResponse>,
}

pub async fn get(db: &PgPool, actor: &Actor, branch_id: Option<Uuid>) -> AppResult<Dashboard> {
    let now = OffsetDateTime::now_utc();
    if let Some(branch_id) = branch_id {
        authorize(actor, Action::ViewBranch { branch_id })?;
    }
    // The branches shown; `None` for a super admin's all-branch view.
    let scope: Option<Vec<Uuid>> = match branch_id {
        Some(b) => Some(vec![b]),
        None if actor.is_super_admin => None,
        None => Some(actor.branches.keys().copied().collect()),
    };
    let branches = sqlx::query!(
        r#"SELECT id, code, name, timezone FROM branch
           WHERE ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY name, id"#,
        scope.as_deref()
    )
    .fetch_all(db)
    .await?;
    let filter = IssueFilter::for_actor(actor).into_json();

    let mut out = Vec::new();
    for b in branches {
        let wide = authorize(actor, Action::ViewBranchDashboard { branch_id: b.id }).is_ok();
        let open = sqlx::query!(
            r#"
            SELECT ty.code AS issue_type, count(*) AS "n!",
                   count(*) FILTER (WHERE NOT i.is_private) AS "public!"
            FROM issue i JOIN issue_type ty ON ty.id = i.type_id
            WHERE i.state = 'open'
              AND issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
              AND (i.branch_id = $2 OR (i.branch_id IS NULL AND EXISTS (
                    SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = $2 AND t.removed_at IS NULL)))
            GROUP BY ty.code
            "#,
            filter,
            b.id
        )
        .fetch_all(db)
        .await?;
        let open_public_tickets = open.iter().find(|r| r.issue_type == "ticket").map_or(0, |r| r.public);

        let mut numbers = BranchNumbers {
            branch_id: b.id,
            code: b.code,
            name: b.name,
            scope: if wide { NumbersScope::Branch } else { NumbersScope::Personal },
            open_public_tickets,
            open_issues_by_type: None,
            work_items_by_status: None,
            overdue_work_items: None,
            due_next_7_days: None,
        };
        if wide {
            let mut by_type = TypeCounts::default();
            for r in &open {
                match r.issue_type.as_str() {
                    "ticket" => by_type.ticket = r.n,
                    "report" => by_type.report = r.n,
                    "event" => by_type.event = r.n,
                    _ => by_type.action = r.n,
                }
            }
            let work = sqlx::query!(
                r#"
                SELECT w.status AS "status!: WorkStatus", count(*) AS "n!",
                       count(*) FILTER (WHERE w.is_overdue) AS "overdue!",
                       count(*) FILTER (WHERE w.status IN ('open', 'in_progress', 'blocked')
                                          AND w.sla_due_at >= $3
                                          AND w.sla_due_at < (date_trunc('day', $3 AT TIME ZONE $4) + interval '8 days')
                                                             AT TIME ZONE $4) AS "due_soon!"
                FROM work_item_overview w JOIN issue i ON i.id = w.issue_id
                WHERE w.branch_id = $2
                  AND issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
                GROUP BY w.status
                "#,
                filter,
                b.id,
                now,
                b.timezone,
            )
            .fetch_all(db)
            .await?;
            let mut by_status = StatusCounts::default();
            let (mut overdue, mut due_soon) = (0, 0);
            for r in work {
                overdue += r.overdue;
                due_soon += r.due_soon;
                *match r.status {
                    WorkStatus::Open => &mut by_status.open,
                    WorkStatus::InProgress => &mut by_status.in_progress,
                    WorkStatus::Blocked => &mut by_status.blocked,
                    WorkStatus::PendingApproval => &mut by_status.pending_approval,
                    WorkStatus::Approved => &mut by_status.approved,
                    WorkStatus::Cancelled => &mut by_status.cancelled,
                } = r.n;
            }
            numbers.open_issues_by_type = Some(by_type);
            numbers.work_items_by_status = Some(by_status);
            numbers.overdue_work_items = Some(overdue);
            numbers.due_next_7_days = Some(due_soon);
        }
        out.push(numbers);
    }

    let mine = mine(db, actor, scope.as_deref(), &filter, now).await?;
    Ok(Dashboard { generated_at: now, branches: out, mine })
}

async fn mine(
    db: &PgPool,
    actor: &Actor,
    scope: Option<&[Uuid]>,
    filter: &serde_json::Value,
    now: OffsetDateTime,
) -> AppResult<MyNumbers> {
    let open_work_items = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "n!" FROM work_item w JOIN issue i ON i.id = w.issue_id
        WHERE w.assignee_id = $2 AND w.status NOT IN ('approved', 'cancelled')
          AND ($3::uuid[] IS NULL OR w.branch_id = ANY($3))
          AND issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
        "#,
        filter,
        actor.user_id,
        scope,
    )
    .fetch_one(db)
    .await?;

    // Awaiting my approval: decided by the policy itself, item by item, so
    // the number can't drift from what `approve` would actually allow.
    let pending = sqlx::query_scalar!(
        r#"
        SELECT w.id FROM work_item w JOIN issue i ON i.id = w.issue_id
        WHERE w.status = 'pending_approval' AND w.assignee_id IS DISTINCT FROM $2 AND i.state = 'open'
          AND ($3::uuid[] IS NULL OR w.branch_id = ANY($3))
          AND issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
        "#,
        filter,
        actor.user_id,
        scope,
    )
    .fetch_all(db)
    .await?;
    let mut awaiting_my_approval = 0;
    for id in pending {
        if let Some(item) = relations::load_work_item(db, actor, id).await? {
            if authorize(actor, Action::ApproveWorkItem { item: &item }).is_ok() {
                awaiting_my_approval += 1;
            }
        }
    }

    let upcoming = sqlx::query!(
        r#"
        SELECT i.id, i.number, i.title, e.starts_at, r.response AS "my_rsvp?: RsvpResponse"
        FROM issue_event e
        JOIN issue i ON i.id = e.issue_id AND i.state = 'open'
        LEFT JOIN event_rsvp r ON r.issue_id = i.id AND r.user_id = $2
        WHERE e.starts_at >= $4 AND e.starts_at < $4 + make_interval(days => $5)
          AND ($3::uuid[] IS NULL OR i.branch_id = ANY($3) OR (i.branch_id IS NULL AND EXISTS (
                SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = ANY($3) AND t.removed_at IS NULL)))
          AND issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
        ORDER BY e.starts_at, i.id
        LIMIT $6
        "#,
        filter,
        actor.user_id,
        scope,
        now,
        UPCOMING_DAYS as i32,
        UPCOMING_LIMIT,
    )
    .fetch_all(db)
    .await?;

    Ok(MyNumbers {
        open_work_items,
        awaiting_my_approval,
        upcoming_events: upcoming
            .into_iter()
            .map(|e| UpcomingEvent {
                issue_id: e.id,
                key: format!("ISS-{}", e.number),
                title: e.title,
                starts_at: e.starts_at,
                my_rsvp: e.my_rsvp,
            })
            .collect(),
        unread_notifications: notifications::unread_count(db, actor).await?,
    })
}
