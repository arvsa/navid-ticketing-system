//! Changes the password of whoever is signed in. Any user can run it for
//! their own account.
//!
//! ```text
//! cargo run --bin login -- --email you@school.org --password old-password
//! cargo run --bin change_password -- --current-password old-password --new-password new-password
//! ```
//!
//! Uses the cookie file written by `cargo run --bin login`. The session in it
//! stays signed in; every other session of the account is signed out.

use std::{fs, process::ExitCode};

use backend::cli::session_token;
use clap::Parser;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(about = "Change the password of the signed-in user")]
struct Cli {
    #[arg(long)]
    current_password: String,
    /// At least 8 characters.
    #[arg(long)]
    new_password: String,
    /// The server's address.
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    url: String,
    /// Must match the server's APP_ORIGIN.
    #[arg(long, env = "APP_ORIGIN", default_value = "http://localhost:5173")]
    origin: String,
    /// The cookie file from `login` or `curl -c`.
    #[arg(long, default_value = "cookies.txt")]
    cookie_file: String,
}

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();

    let Some(token) = fs::read_to_string(&cli.cookie_file).ok().and_then(|c| session_token(&c)) else {
        println!("Not signed in: there's no session in {}. Sign in with `cargo run --bin login`.", cli.cookie_file);
        return ExitCode::FAILURE;
    };

    let url = format!("{}/api/me/password", cli.url.trim_end_matches('/'));
    let res = match reqwest::Client::new()
        .post(&url)
        .header("Cookie", format!("sid={token}"))
        .header("Origin", &cli.origin)
        .json(&json!({ "current_password": cli.current_password, "new_password": cli.new_password }))
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            eprintln!("Can't reach {url} ({e}). Is the server running (`cargo run`)?");
            return ExitCode::FAILURE;
        }
    };

    let status = res.status();
    if status.as_u16() == 204 {
        println!("Password changed. Your other sessions were signed out.");
        return ExitCode::SUCCESS;
    }
    let body: Value = res.json().await.unwrap_or(Value::Null);
    let code = body["error"]["code"].as_str().unwrap_or("");
    let message = body["error"]["message"].as_str().unwrap_or("");
    match (status.as_u16(), code) {
        (401, _) => eprintln!("Not signed in: the session has expired or was signed out. Sign in with `cargo run --bin login`."),
        (403, "origin_mismatch") => eprintln!("Refused: --origin must match the server's APP_ORIGIN."),
        _ => eprintln!("Password not changed: {code}: {message}"),
    }
    ExitCode::FAILURE
}
