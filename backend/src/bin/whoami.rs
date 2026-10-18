//! Shows who the saved session belongs to, or that you're signed out.
//!
//! ```text
//! cargo run --bin whoami
//! cargo run --bin whoami -- --cookie-file cookies.txt --url http://127.0.0.1:8080
//! ```
//!
//! Reads the cookie file written by `cargo run --bin login` (or by
//! `curl -c`).

use std::{fs, process::ExitCode};

use backend::cli::session_token;
use clap::Parser;
use serde_json::Value;

#[derive(Parser)]
#[command(about = "Check whether the saved session is signed in, and as whom")]
struct Cli {
    /// The server's address.
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    url: String,
    /// The cookie file from `login` or `curl -c`.
    #[arg(long, default_value = "cookies.txt")]
    cookie_file: String,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();

    let Ok(contents) = fs::read_to_string(&cli.cookie_file) else {
        println!("Not signed in: there's no {} yet. Sign in with `cargo run --bin login`.", cli.cookie_file);
        return ExitCode::FAILURE;
    };
    let Some(token) = session_token(&contents) else {
        println!("Not signed in: {} has no session cookie. Sign in with `cargo run --bin login`.", cli.cookie_file);
        return ExitCode::FAILURE;
    };

    let url = format!("{}/api/me", cli.url.trim_end_matches('/'));
    let res = match reqwest::Client::new().get(&url).header("Cookie", format!("sid={token}")).send().await {
        Ok(res) => res,
        Err(e) => {
            eprintln!("Can't reach {url} ({e}). Is the server running (`cargo run`)?");
            return ExitCode::FAILURE;
        }
    };
    let status = res.status();
    let body: Value = res.json().await.unwrap_or(Value::Null);

    if status.as_u16() == 401 {
        println!("Not signed in: the session has expired or was signed out. Sign in with `cargo run --bin login`.");
        return ExitCode::FAILURE;
    }
    if !status.is_success() {
        eprintln!("Unexpected answer from {url}: {status} {body}");
        return ExitCode::FAILURE;
    }

    let user = &body["user"];
    println!(
        "Signed in as {} {} <{}>{}",
        user["first_name"].as_str().unwrap_or(""),
        user["last_name"].as_str().unwrap_or(""),
        user["email"].as_str().unwrap_or(""),
        if user["is_super_admin"] == true { " (super admin)" } else { "" },
    );
    if user["must_change_password"] == true {
        println!("Note: this account must change its password (POST /api/me/password) before anything else works.");
    }
    let memberships = body["memberships"].as_array().cloned().unwrap_or_default();
    if memberships.is_empty() {
        println!("Branches: none");
    } else {
        println!("Branches:");
        for m in memberships {
            let role = if m["is_admin"] == true { "admin" } else { "member" };
            println!(
                "  {} ({}) - {role} - id {}",
                m["branch"]["name"].as_str().unwrap_or(""),
                m["branch"]["code"].as_str().unwrap_or(""),
                m["branch"]["id"].as_str().unwrap_or(""),
            );
        }
    }
    ExitCode::SUCCESS
}
