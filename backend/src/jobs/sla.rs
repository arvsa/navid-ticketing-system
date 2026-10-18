//! Every minute: `sla_due_soon` within 24 h of `sla_due_at`, `sla_breached`
//! once it has passed, for open work on open issues. Recipients are the
//! assignee and the branch admins. At most one of each per item, recipient
//! and day (in the branch's timezone).

use sqlx::PgPool;
use time::OffsetDateTime;

use super::{try_lock, SLA_LOCK};
use crate::{domain::notifications, error::AppResult};

/// Returns `None` if another instance is running the job.
pub async fn run(pool: &PgPool, now: OffsetDateTime) -> AppResult<Option<u64>> {
    let mut tx = pool.begin().await?;
    if !try_lock(&mut tx, SLA_LOCK).await? {
        return Ok(None);
    }
    let recipients = sqlx::query_scalar!(
        r#"
        WITH due AS (
            SELECT w.id AS work_item_id, w.issue_id, w.branch_id, w.assignee_id, w.sla_due_at,
                   CASE WHEN w.sla_due_at <= $1 THEN 'sla_breached' ELSE 'sla_due_soon' END AS kind,
                   to_char(($1 AT TIME ZONE b.timezone)::date, 'YYYY-MM-DD') AS day
            FROM work_item w
            JOIN issue i ON i.id = w.issue_id AND i.state = 'open'
            JOIN branch b ON b.id = w.branch_id
            WHERE w.status IN ('open', 'in_progress', 'blocked')
              AND w.sla_due_at <= $1 + interval '24 hours'
        ),
        recipients AS (
            SELECT d.*, d.assignee_id AS recipient_id FROM due d WHERE d.assignee_id IS NOT NULL
            UNION
            SELECT d.*, m.user_id FROM due d
            JOIN branch_membership m ON m.branch_id = d.branch_id AND m.is_admin AND m.left_at IS NULL
        )
        INSERT INTO notification (recipient_id, kind, branch_id, issue_id, work_item_id, actor_id, payload, dedupe_key)
        SELECT r.recipient_id, r.kind, r.branch_id, r.issue_id, r.work_item_id, NULL,
               jsonb_build_object('sla_due_at', r.sla_due_at),
               r.kind || ':' || r.work_item_id || ':' || r.recipient_id || ':' || r.day
        FROM recipients r
        JOIN app_user u ON u.id = r.recipient_id AND u.is_active
        ON CONFLICT (dedupe_key) DO NOTHING
        RETURNING recipient_id
        "#,
        now
    )
    .fetch_all(&mut *tx)
    .await?;
    let count = recipients.len() as u64;
    notifications::signal_recipients(&mut tx, recipients).await?;
    tx.commit().await?;
    Ok(Some(count))
}
