//! Every minute: for each event reminder whose time has come (and whose
//! event hasn't started), notify the invitees who haven't declined. Once per
//! event, invitee, reminder and start time, so rescheduling re-arms them.

use sqlx::PgPool;
use time::OffsetDateTime;

use super::{try_lock, REMINDERS_LOCK};
use crate::{domain::notifications, error::AppResult};

/// Returns `None` if another instance is running the job.
pub async fn run(pool: &PgPool, now: OffsetDateTime) -> AppResult<Option<u64>> {
    let mut tx = pool.begin().await?;
    if !try_lock(&mut tx, REMINDERS_LOCK).await? {
        return Ok(None);
    }
    let recipients = sqlx::query_scalar!(
        r#"
        INSERT INTO notification (recipient_id, kind, branch_id, issue_id, actor_id, payload, dedupe_key)
        SELECT r.user_id, 'event_reminder', i.branch_id, i.id, NULL,
               jsonb_build_object('minutes_before', er.minutes_before, 'starts_at', e.starts_at),
               'reminder:' || i.id || ':' || r.user_id || ':' || er.minutes_before
                   || ':' || extract(epoch FROM e.starts_at)::bigint
        FROM event_reminder er
        JOIN issue_event e ON e.issue_id = er.issue_id
        JOIN issue i ON i.id = e.issue_id AND i.state = 'open'
        JOIN event_rsvp r ON r.issue_id = i.id AND r.response <> 'declined'
        JOIN app_user u ON u.id = r.user_id AND u.is_active
        WHERE e.starts_at - make_interval(mins => er.minutes_before) <= $1
          AND e.starts_at > $1
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
