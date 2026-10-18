//! Lists the users in the database. Needs only `DATABASE_URL`.
//!
//! ```text
//! cargo run --bin users
//! cargo run --bin users -- --branch NORTH
//! cargo run --bin users -- --search jane
//! ```
//!
//! Passwords are stored only as argon2 hashes, so they can't be shown.

use std::process::ExitCode;

use clap::Parser;
use sqlx::{postgres::PgPoolOptions, Row};

#[derive(Parser)]
#[command(about = "List the users in the database")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    /// Only users in this branch (its code, such as NORTH).
    #[arg(long)]
    branch: Option<String>,
    /// Only users whose email or name contains this text.
    #[arg(long)]
    search: Option<String>,
}

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();

    let pool = match PgPoolOptions::new().max_connections(1).connect(&cli.database_url).await {
        Ok(pool) => pool,
        Err(e) => {
            eprintln!("Can't connect to the database ({e}). Is it running (`docker compose up -d`)?");
            return ExitCode::FAILURE;
        }
    };

    let rows = sqlx::query(
        r#"
        SELECT u.email::text AS email,
               u.first_name || ' ' || u.last_name AS name,
               u.is_super_admin, u.is_active, u.must_change_password,
               (u.locked_until > now()) IS TRUE AS locked,
               coalesce(string_agg(b.code || CASE WHEN m.is_admin THEN ' (admin)' ELSE '' END, ', ' ORDER BY b.code), '') AS branches
        FROM app_user u
        LEFT JOIN branch_membership m ON m.user_id = u.id AND m.left_at IS NULL
        LEFT JOIN branch b ON b.id = m.branch_id
        WHERE ($1::text IS NULL OR u.id IN (
                  SELECT m2.user_id FROM branch_membership m2 JOIN branch b2 ON b2.id = m2.branch_id
                  WHERE m2.left_at IS NULL AND b2.code = upper($1)))
          AND ($2::text IS NULL OR u.email::text ILIKE '%' || $2 || '%'
               OR (u.first_name || ' ' || u.last_name) ILIKE '%' || $2 || '%')
        GROUP BY u.id
        ORDER BY u.is_super_admin DESC, u.email
        "#,
    )
    .bind(&cli.branch)
    .bind(&cli.search)
    .fetch_all(&pool)
    .await;
    let rows = match rows {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("Can't read the users: {e}");
            return ExitCode::FAILURE;
        }
    };
    if rows.is_empty() {
        println!("No users found.");
        return ExitCode::SUCCESS;
    }

    let table: Vec<[String; 4]> = rows
        .iter()
        .map(|r| {
            let mut notes = Vec::new();
            if r.get::<bool, _>("is_super_admin") {
                notes.push("super admin");
            }
            if !r.get::<bool, _>("is_active") {
                notes.push("deactivated");
            }
            if r.get::<bool, _>("locked") {
                notes.push("locked");
            }
            if r.get::<bool, _>("must_change_password") {
                notes.push("must change password");
            }
            [r.get("email"), r.get("name"), r.get("branches"), notes.join(", ")]
        })
        .collect();

    let header = ["EMAIL", "NAME", "BRANCHES", "NOTES"];
    let widths: Vec<usize> = (0..4)
        .map(|i| table.iter().map(|row| row[i].chars().count()).chain([header[i].len()]).max().unwrap_or(0))
        .collect();
    let print = |cells: [&str; 4]| {
        let line: Vec<String> = cells.iter().zip(&widths).map(|(c, w)| format!("{c:<w$}")).collect();
        println!("{}", line.join("  ").trim_end());
    };
    print(header);
    for row in &table {
        print([&row[0], &row[1], &row[2], &row[3]]);
    }
    println!("\n{} user(s)", table.len());
    ExitCode::SUCCESS
}
