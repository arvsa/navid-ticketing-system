use std::{future::Future, pin::Pin, time::Duration};

use sqlx::{
    migrate::Migrator,
    postgres::{PgConnectOptions, PgPool, PgPoolOptions},
    Postgres, Transaction,
};

use crate::{config::Config, error::AppError};

pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub type Tx = Transaction<'static, Postgres>;

pub async fn connect(config: &Config) -> Result<PgPool, sqlx::Error> {
    // A runaway query or a transaction left open can't hold connections
    // and locks for long.
    let options: PgConnectOptions = config.database_url.parse::<PgConnectOptions>()?.options([
        ("statement_timeout", "15s"),
        ("idle_in_transaction_session_timeout", "60s"),
        ("lock_timeout", "10s"),
    ]);
    PgPoolOptions::new()
        .max_connections(config.database_max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}

/// Runs `f` in one transaction: commits on `Ok`, rolls back on `Err`.
///
/// Every mutating domain function goes through this, so its audit rows,
/// notification rows and `pg_notify` call commit or roll back together.
pub async fn with_tx<T, F>(pool: &PgPool, f: F) -> Result<T, AppError>
where
    F: for<'c> FnOnce(&'c mut Tx) -> Pin<Box<dyn Future<Output = Result<T, AppError>> + Send + 'c>>,
{
    let mut tx = pool.begin().await?;
    match f(&mut tx).await {
        Ok(value) => {
            tx.commit().await?;
            Ok(value)
        }
        Err(err) => {
            // Dropping the transaction rolls it back; do it explicitly so a
            // failed rollback is at least logged.
            if let Err(rollback_err) = tx.rollback().await {
                tracing::warn!(error = %rollback_err, "rollback failed");
            }
            Err(err)
        }
    }
}
