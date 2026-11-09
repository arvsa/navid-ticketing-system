//! Checks that the server is up and can reach its database, or, with
//! `--db-idle`, that nothing holds a lock on the database.
//!
//! ```text
//! cargo run --bin health
//! cargo run --bin health -- --url http://127.0.0.1:8080
//! cargo run --bin health -- --db-idle      # needs DATABASE_URL
//! ```

use std::{process::ExitCode, time::Duration};

use clap::Parser;
use sqlx::{postgres::PgPoolOptions, Row};

#[derive(Parser)]
#[command(about = "Check the server's health endpoint, or whether the database is idle")]
struct Cli {
    /// The server's address.
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    url: String,
    /// Instead: exit 0 when no other session holds a lock that matters on
    /// the database (a job's advisory lock, rows being written, schema
    /// changes), 1 while one does, 2 when the database can't be reached.
    /// Used by the container to restart the backend at a quiet moment.
    #[arg(long)]
    db_idle: bool,
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: Option<String>,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
    if cli.db_idle {
        return db_idle(cli.database_url.as_deref()).await;
    }
    let url = format!("{}/api/healthz", cli.url.trim_end_matches('/'));
    match reqwest::get(&url).await {
        Ok(res) if res.status().is_success() => {
            println!("OK: the server and its database are up ({url})");
            ExitCode::SUCCESS
        }
        Ok(res) => {
            let status = res.status();
            let body = res.text().await.unwrap_or_default();
            eprintln!("UNHEALTHY: {status} from {url}: {body}");
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("DOWN: can't reach {url} ({e}). Is the server running (`cargo run`)?");
            ExitCode::FAILURE
        }
    }
}

/// Plain reads (`AccessShareLock`) don't count: interrupting one loses
/// nothing. Everything the app locks on purpose does: the jobs' and the
/// super admin check's advisory locks, the transaction id of any transaction
/// that has written, and row or table locks (`FOR UPDATE`, writes, migrations).
const BUSY: &str = r#"
    SELECT a.pid, l.locktype, l.mode,
           coalesce(round(extract(epoch FROM now() - a.xact_start))::bigint, 0) AS secs
    FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.granted AND l.pid <> pg_backend_pid() AND a.datname = current_database()
      AND (l.locktype IN ('advisory', 'transactionid')
           OR (l.locktype IN ('relation', 'tuple') AND l.mode <> 'AccessShareLock'))
    ORDER BY a.pid
"#;

async fn db_idle(database_url: Option<&str>) -> ExitCode {
    let Some(database_url) = database_url else {
        eprintln!("DATABASE_URL must be set for --db-idle");
        return ExitCode::from(2);
    };
    let pool = match PgPoolOptions::new()
        .max_connections(1)
        .acquire_timeout(Duration::from_secs(5))
        .connect(database_url)
        .await
    {
        Ok(pool) => pool,
        Err(e) => {
            eprintln!("DOWN: can't reach the database ({e})");
            return ExitCode::from(2);
        }
    };
    match sqlx::query(BUSY).fetch_all(&pool).await {
        Ok(rows) if rows.is_empty() => {
            println!("IDLE: no locks on the database");
            ExitCode::SUCCESS
        }
        Ok(rows) => {
            for r in rows {
                println!(
                    "BUSY: session {} holds a lock: {} ({}), transaction open {} s",
                    r.get::<i32, _>("pid"),
                    r.get::<String, _>("locktype"),
                    r.get::<String, _>("mode"),
                    r.get::<i64, _>("secs"),
                );
            }
            ExitCode::FAILURE
        }
        Err(e) => {
            eprintln!("ERROR: {e}");
            ExitCode::from(2)
        }
    }
}
