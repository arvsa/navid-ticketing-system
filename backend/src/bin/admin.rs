//! Operator CLI. Needs only `DATABASE_URL`.
//!
//! ```text
//! cargo run --bin admin -- create-root-user --email x --first-name y --last-name z
//! cargo run --bin admin -- reset-password --email x
//! ```
//!
//! In Docker, run it in the backend container, which has `DATABASE_URL` set:
//! `docker compose exec backend admin create-root-user ...`.

use std::process::ExitCode;

use backend::{auth::bootstrap, cli, db, error::AppError};
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(about = "School ticketing admin tasks")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Create a root user (sees and runs every branch) and print a temporary password.
    #[command(alias = "create-super-admin")]
    CreateRootUser {
        #[arg(long)]
        email: String,
        #[arg(long)]
        first_name: String,
        #[arg(long)]
        last_name: String,
    },
    /// Set a temporary password, force a change at next login, and sign the user out everywhere.
    ResetPassword {
        #[arg(long)]
        email: String,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    let pool = match cli::connect(&cli.database_url).await {
        Ok(pool) => pool,
        Err(msg) => {
            eprintln!("{msg}");
            return ExitCode::FAILURE;
        }
    };
    if let Err(e) = db::migrate(&pool).await {
        eprintln!("Can't apply the database migrations: {e}");
        return ExitCode::FAILURE;
    }

    let result = match &cli.command {
        Command::CreateRootUser { email, first_name, last_name } => {
            bootstrap::create_super_admin(&pool, email, first_name, last_name)
                .await
                .map(|created| (email, created, format!("Created root user {email}")))
        }
        Command::ResetPassword { email } => bootstrap::reset_password(&pool, email)
            .await
            .map(|created| (email, created, format!("Reset the password of {email}; their sessions were signed out"))),
    };
    let (email, created, done) = match result {
        Ok(ok) => ok,
        Err(AppError::NotFound) => {
            eprintln!("There's no account with that email (`users` lists them).");
            return ExitCode::FAILURE;
        }
        Err(e) => {
            eprintln!("Failed: {e}");
            return ExitCode::FAILURE;
        }
    };
    println!("{done} ({})", created.user_id);
    println!();
    println!("  Temporary password: {}", created.temporary_password.expose());
    println!();
    println!("{email} must choose a new password after signing in. Until then `users` shows it too.");
    ExitCode::SUCCESS
}
