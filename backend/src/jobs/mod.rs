//! Background jobs (BACKEND_PLAN.md section 11), run in-process.
//!
//! Each run happens in one transaction that first takes
//! `pg_try_advisory_xact_lock(<job id>)`: if another instance holds it, the
//! run is skipped, so several servers can run side by side. Job output
//! carries `actor_id = NULL` (the system) and a `dedupe_key`, so a repeated
//! run never notifies twice.

pub mod cleanup;
pub mod reminders;
pub mod sla;

use std::time::Duration;

use sqlx::PgPool;
use time::OffsetDateTime;

use crate::{db::Tx, error::AppResult};

pub const SLA_LOCK: i64 = 0x4A4F_4253_0001;
pub const REMINDERS_LOCK: i64 = 0x4A4F_4253_0002;
pub const CLEANUP_LOCK: i64 = 0x4A4F_4253_0003;

/// Takes the job's lock for the rest of the transaction, if it's free.
pub async fn try_lock(tx: &mut Tx, lock_id: i64) -> AppResult<bool> {
    Ok(sqlx::query_scalar!(r#"SELECT pg_try_advisory_xact_lock($1) AS "locked!""#, lock_id)
        .fetch_one(&mut **tx)
        .await?)
}

/// Starts the three jobs on their intervals.
pub fn spawn(pool: PgPool) {
    every(Duration::from_secs(60), "sla", pool.clone(), |pool| async move {
        sla::run(&pool, OffsetDateTime::now_utc()).await
    });
    every(Duration::from_secs(60), "reminders", pool.clone(), |pool| async move {
        reminders::run(&pool, OffsetDateTime::now_utc()).await
    });
    every(Duration::from_secs(24 * 60 * 60), "cleanup", pool, |pool| async move {
        cleanup::run(&pool, OffsetDateTime::now_utc()).await.map(|r| r.map(|c| c.notifications + c.sessions))
    });
}

fn every<F, Fut>(period: Duration, name: &'static str, pool: PgPool, job: F)
where
    F: Fn(PgPool) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = AppResult<Option<u64>>> + Send,
{
    tokio::spawn(async move {
        let mut ticks = tokio::time::interval(period);
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticks.tick().await;
            match job(pool.clone()).await {
                Ok(Some(n)) if n > 0 => tracing::info!(job = name, affected = n, "job ran"),
                Ok(Some(_)) => tracing::debug!(job = name, "job ran, nothing to do"),
                Ok(None) => tracing::debug!(job = name, "another instance holds the job lock"),
                Err(e) => tracing::error!(job = name, error = %e, "job failed"),
            }
        }
    });
}
