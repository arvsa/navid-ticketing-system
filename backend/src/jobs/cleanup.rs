//! Daily: delete read notifications older than 90 days, and sessions that
//! expired or were revoked more than 30 days ago.

use sqlx::PgPool;
use time::OffsetDateTime;

use super::{try_lock, CLEANUP_LOCK};
use crate::error::AppResult;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Cleaned {
    pub notifications: u64,
    pub sessions: u64,
}

/// Returns `None` if another instance is running the job.
pub async fn run(pool: &PgPool, now: OffsetDateTime) -> AppResult<Option<Cleaned>> {
    let mut tx = pool.begin().await?;
    if !try_lock(&mut tx, CLEANUP_LOCK).await? {
        return Ok(None);
    }
    let notifications = sqlx::query!(
        "DELETE FROM notification WHERE read_at IS NOT NULL AND created_at < $1::timestamptz - interval '90 days'",
        now
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    let sessions = sqlx::query!(
        r#"DELETE FROM user_session
           WHERE expires_at < $1::timestamptz - interval '30 days' OR revoked_at < $1::timestamptz - interval '30 days'"#,
        now
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    tx.commit().await?;
    Ok(Some(Cleaned { notifications, sessions }))
}
