//! Lists the users in the database and what's known about them. Needs only
//! `DATABASE_URL`.
//!
//! ```text
//! cargo run --bin users
//! cargo run --bin users -- --branch NORTH --admins
//! cargo run --bin users -- --search jane --pending
//! docker compose exec backend users --inactive
//! ```
//!
//! PASSWORD is the temporary password an admin handed out, until the person
//! signs in and replaces it. Passwords people choose are stored only as
//! argon2 hashes, so they can't be shown: `admin reset-password` issues a new
//! temporary one.

use std::process::ExitCode;

use backend::cli;
use clap::Parser;
use sqlx::Row;
use time::{format_description::BorrowedFormatItem, macros::format_description, OffsetDateTime};

#[derive(Parser)]
#[command(about = "List the users in the database, with their temporary passwords")]
struct Cli {
    #[arg(long, env = "DATABASE_URL", hide_env_values = true)]
    database_url: String,
    /// Only users in this branch (its code, such as NORTH).
    #[arg(long)]
    branch: Option<String>,
    /// Only users whose email or name contains this text.
    #[arg(long, short)]
    search: Option<String>,
    /// Only super admins.
    #[arg(long)]
    super_admins: bool,
    /// Only branch admins (of --branch, if given).
    #[arg(long)]
    admins: bool,
    /// Only deactivated accounts.
    #[arg(long, conflicts_with = "active")]
    inactive: bool,
    /// Only active accounts.
    #[arg(long)]
    active: bool,
    /// Only accounts locked after too many failed sign-ins.
    #[arg(long)]
    locked: bool,
    /// Only people who still have to replace a temporary password.
    #[arg(long)]
    pending: bool,
    /// Only people who have never signed in.
    #[arg(long)]
    never_signed_in: bool,
    /// Print comma-separated values instead of a table.
    #[arg(long)]
    csv: bool,
}

const DATE: &[BorrowedFormatItem<'static>] = format_description!("[year]-[month]-[day] [hour]:[minute]");

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

    let rows = sqlx::query(
        r#"
        SELECT u.email::text AS email,
               u.first_name || ' ' || u.last_name AS name,
               u.is_super_admin, u.is_active, u.must_change_password, u.temporary_password,
               (u.locked_until > now()) IS TRUE AS locked,
               u.last_login_at, u.created_at,
               coalesce(string_agg(b.code || CASE WHEN m.is_admin THEN ' (admin)' ELSE '' END, ', ' ORDER BY b.code), '') AS branches
        FROM app_user u
        LEFT JOIN branch_membership m ON m.user_id = u.id AND m.left_at IS NULL
        LEFT JOIN branch b ON b.id = m.branch_id
        WHERE ($1::text IS NULL OR u.id IN (
                  SELECT m2.user_id FROM branch_membership m2 JOIN branch b2 ON b2.id = m2.branch_id
                  WHERE m2.left_at IS NULL AND b2.code = upper($1)))
          AND ($2::text IS NULL OR u.email::text ILIKE '%' || $2 || '%'
               OR (u.first_name || ' ' || u.last_name) ILIKE '%' || $2 || '%')
          AND (NOT $3 OR u.is_super_admin)
          AND (NOT $4 OR u.id IN (
                  SELECT m3.user_id FROM branch_membership m3 JOIN branch b3 ON b3.id = m3.branch_id
                  WHERE m3.left_at IS NULL AND m3.is_admin AND ($1::text IS NULL OR b3.code = upper($1))))
          AND (NOT $5 OR NOT u.is_active)
          AND (NOT $6 OR u.is_active)
          AND (NOT $7 OR u.locked_until > now())
          AND (NOT $8 OR u.must_change_password)
          AND (NOT $9 OR u.last_login_at IS NULL)
        GROUP BY u.id
        ORDER BY u.is_super_admin DESC, u.email
        "#,
    )
    .bind(&cli.branch)
    .bind(&cli.search)
    .bind(cli.super_admins)
    .bind(cli.admins)
    .bind(cli.inactive)
    .bind(cli.active)
    .bind(cli.locked)
    .bind(cli.pending)
    .bind(cli.never_signed_in)
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

    let date = |d: Option<OffsetDateTime>| d.and_then(|d| d.format(DATE).ok()).unwrap_or_else(|| "never".into());
    let table: Vec<[String; 7]> = rows
        .iter()
        .map(|r| {
            let mut status = Vec::new();
            if r.get::<bool, _>("is_super_admin") {
                status.push("super admin");
            }
            status.push(if r.get::<bool, _>("is_active") { "active" } else { "deactivated" });
            if r.get::<bool, _>("locked") {
                status.push("locked");
            }
            let password = match r.get::<Option<String>, _>("temporary_password") {
                Some(p) => p,
                None if r.get::<bool, _>("must_change_password") => "(unknown: reset it)".into(),
                None => "(chosen by them)".into(),
            };
            [
                r.get("email"),
                r.get("name"),
                r.get("branches"),
                status.join(", "),
                date(r.get("last_login_at")),
                date(Some(r.get("created_at"))),
                password,
            ]
        })
        .collect();

    let header = ["EMAIL", "NAME", "BRANCHES", "STATUS", "LAST SIGN-IN", "CREATED", "PASSWORD"];
    if cli.csv {
        let field = |s: &str| {
            if s.contains([',', '"', '\n']) {
                format!("\"{}\"", s.replace('"', "\"\""))
            } else {
                s.to_owned()
            }
        };
        println!("{}", header.map(field).join(","));
        for row in &table {
            println!("{}", row.iter().map(|c| field(c)).collect::<Vec<_>>().join(","));
        }
        return ExitCode::SUCCESS;
    }

    let widths: Vec<usize> = (0..header.len())
        .map(|i| table.iter().map(|row| row[i].chars().count()).chain([header[i].len()]).max().unwrap_or(0))
        .collect();
    let print = |cells: &[&str]| {
        let line: Vec<String> = cells.iter().zip(&widths).map(|(c, w)| format!("{c:<w$}")).collect();
        println!("{}", line.join("  ").trim_end());
    };
    print(&header);
    for row in &table {
        print(&row.iter().map(String::as_str).collect::<Vec<_>>());
    }
    println!("\n{} user(s)", table.len());
    ExitCode::SUCCESS
}
