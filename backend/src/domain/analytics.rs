//! `GET /api/analytics`: the whole school at a glance, for super admins.
//!
//! Over the last `weeks` weeks (Monday to Sunday, UTC), per active branch:
//! - activity: items created and work finished (approved), week by week;
//! - average time to finish: from work given out to its final approval;
//! - on-time rate: of finished work that had a due date, the share handed in
//!   (for the last time) by then.
//!
//! And now, per person: open work, how much of it is overdue, and how much
//! they've handed in and wait on (the busiest first).

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    authz::{authorize, Action, Actor},
    error::{AppError, AppResult},
};

pub const DEFAULT_WEEKS: i32 = 12;
pub const MAX_WEEKS: i32 = 52;
/// People listed under workload.
pub const WORKLOAD_LIMIT: i64 = 15;

#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AnalyticsQuery {
    /// 1 to 52; default 12.
    pub weeks: Option<i32>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Analytics {
    pub weeks: i32,
    /// Monday of the first week shown.
    #[serde(with = "time::serde::rfc3339")]
    pub since: OffsetDateTime,
    pub branches: Vec<BranchAnalytics>,
    pub workload: Vec<Workload>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct BranchAnalytics {
    pub branch_id: Uuid,
    pub code: String,
    pub name: String,
    /// One per week, oldest first.
    pub activity: Vec<WeekActivity>,
    /// Work finished (approved) in the period.
    pub finished: i64,
    /// Average hours from work given out to its approval; `null` with nothing finished.
    pub avg_hours_to_finish: Option<f64>,
    /// Finished work that had a due date.
    pub finished_with_due_date: i64,
    /// Of those, the share handed in on time (0 to 1); `null` with none.
    pub on_time_rate: Option<f64>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct WeekActivity {
    #[serde(with = "time::serde::rfc3339")]
    pub week_start: OffsetDateTime,
    /// Items created in the branch, or sent to it from elsewhere.
    pub created: i64,
    /// Work in the branch approved that week.
    pub finished: i64,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Workload {
    pub user_id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub branch_id: Uuid,
    /// Not started, in progress or blocked.
    pub open: i64,
    /// Of `open`, past its due date.
    pub overdue: i64,
    /// Handed in and waiting for review.
    pub handed_in: i64,
}

pub async fn get(db: &PgPool, actor: &Actor, query: &AnalyticsQuery) -> AppResult<Analytics> {
    authorize(actor, Action::ViewAnalytics)?;
    let weeks = query.weeks.unwrap_or(DEFAULT_WEEKS);
    if !(1..=MAX_WEEKS).contains(&weeks) {
        return Err(AppError::validation("invalid_query", format!("weeks must be 1 to {MAX_WEEKS}")));
    }

    let since = sqlx::query_scalar!(
        r#"SELECT date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(weeks => $1 - 1) AS "since!""#,
        weeks
    )
    .fetch_one(db)
    .await?;

    let activity = sqlx::query!(
        r#"
        WITH weeks AS (
            SELECT generate_series($1::timestamptz, $1::timestamptz + make_interval(weeks => $2 - 1), interval '1 week') AS week
        )
        SELECT b.id AS branch_id, w.week AS "week!",
               (SELECT count(*) FROM issue i
                WHERE i.created_at >= w.week AND i.created_at < w.week + interval '1 week'
                  AND (i.branch_id = b.id OR (i.branch_id IS NULL AND EXISTS (
                        SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = b.id)))) AS "created!",
               (SELECT count(*) FROM work_item wi
                WHERE wi.branch_id = b.id AND wi.status = 'approved'
                  AND wi.decided_at >= w.week AND wi.decided_at < w.week + interval '1 week') AS "finished!"
        FROM branch b CROSS JOIN weeks w
        WHERE b.is_active
        ORDER BY b.id, w.week
        "#,
        since,
        weeks
    )
    .fetch_all(db)
    .await?;

    let rows = sqlx::query!(
        r#"
        SELECT b.id, b.code, b.name,
               count(wi.id) AS "finished!",
               avg(extract(epoch FROM wi.decided_at - wi.created_at) / 3600)::float8 AS avg_hours,
               count(wi.id) FILTER (WHERE wi.sla_due_at IS NOT NULL) AS "with_due!",
               count(wi.id) FILTER (WHERE wi.sla_due_at IS NOT NULL AND wi.submitted_at <= wi.sla_due_at) AS "on_time!"
        FROM branch b
        LEFT JOIN work_item wi ON wi.branch_id = b.id AND wi.status = 'approved' AND wi.decided_at >= $1
        WHERE b.is_active
        GROUP BY b.id
        ORDER BY lower(b.name), b.id
        "#,
        since
    )
    .fetch_all(db)
    .await?;

    let branches = rows
        .into_iter()
        .map(|r| BranchAnalytics {
            activity: activity
                .iter()
                .filter(|a| a.branch_id == r.id)
                .map(|a| WeekActivity { week_start: a.week, created: a.created, finished: a.finished })
                .collect(),
            branch_id: r.id,
            code: r.code,
            name: r.name,
            finished: r.finished,
            avg_hours_to_finish: r.avg_hours,
            finished_with_due_date: r.with_due,
            on_time_rate: (r.with_due > 0).then(|| r.on_time as f64 / r.with_due as f64),
        })
        .collect();

    let workload = sqlx::query_as!(
        Workload,
        r#"
        SELECT u.id AS user_id, u.first_name, u.last_name, w.branch_id,
               count(*) FILTER (WHERE w.status IN ('open', 'in_progress', 'blocked')) AS "open!",
               count(*) FILTER (WHERE w.status IN ('open', 'in_progress', 'blocked') AND w.sla_due_at < now()) AS "overdue!",
               count(*) FILTER (WHERE w.status = 'pending_approval') AS "handed_in!"
        FROM work_item w
        JOIN issue i ON i.id = w.issue_id AND i.state = 'open'
        JOIN app_user u ON u.id = w.assignee_id AND u.is_active
        JOIN branch b ON b.id = w.branch_id AND b.is_active
        WHERE w.status IN ('open', 'in_progress', 'blocked', 'pending_approval')
        GROUP BY u.id, w.branch_id
        ORDER BY 5 DESC, 6 DESC, lower(u.first_name), u.id
        LIMIT $1
        "#,
        WORKLOAD_LIMIT
    )
    .fetch_all(db)
    .await?;

    Ok(Analytics { weeks, since, branches, workload })
}
