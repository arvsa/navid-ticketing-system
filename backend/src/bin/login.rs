//! Signs in through the API and saves the session cookie for curl.
//!
//! ```text
//! cargo run --bin login                      # the demo super admin
//! cargo run --bin login -- --email admin@north.demo.school
//! curl -b cookies.txt http://127.0.0.1:8080/api/me
//! ```
//!
//! The cookie file uses curl's (Netscape) format, so `curl -b cookies.txt`
//! sends it. The server must be running.

use std::{fs, process::ExitCode};

use clap::Parser;
use serde_json::{json, Value};

#[derive(Parser)]
#[command(about = "Sign in and save the session cookie (default: the demo super admin)")]
struct Cli {
    #[arg(long, default_value = backend::seed::DEMO_SUPER_ADMIN)]
    email: String,
    #[arg(long, default_value = backend::seed::DEMO_PASSWORD)]
    password: String,
    /// The server's address.
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    url: String,
    /// Must match the server's APP_ORIGIN.
    #[arg(long, env = "APP_ORIGIN", default_value = "http://localhost:5173")]
    origin: String,
    /// Where to save the cookie.
    #[arg(long, default_value = "cookies.txt")]
    cookie_file: String,
}

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    let cli = Cli::parse();
    match run(&cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("Login failed: {message}");
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: &Cli) -> Result<(), String> {
    let base = cli.url.trim_end_matches('/');
    let res = reqwest::Client::new()
        .post(format!("{base}/api/auth/login"))
        .header("Origin", &cli.origin)
        .json(&json!({ "email": cli.email, "password": cli.password }))
        .send()
        .await
        .map_err(|e| format!("can't reach {base} ({e}). Is the server running (`cargo run`)?"))?;

    let status = res.status();
    let cookie = res
        .headers()
        .get("set-cookie")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.split(';').next())
        .and_then(|pair| pair.strip_prefix("sid="))
        .map(str::to_owned);
    let body: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let code = body["error"]["code"].as_str().unwrap_or("unknown");
        let hint = match code {
            "invalid_credentials" => " (wrong email or password; did you run `cargo run --bin admin -- seed-demo`?)",
            "origin_mismatch" => " (--origin must match the server's APP_ORIGIN)",
            _ => "",
        };
        return Err(format!("{status} {code}{hint}"));
    }
    let token = cookie.ok_or("the server didn't set a session cookie")?;

    // curl's cookie-file format: domain, subdomains, path, secure, expiry, name, value.
    let host = base.split("://").nth(1).unwrap_or(base).split(['/', ':']).next().unwrap_or("127.0.0.1");
    let jar = format!("# Netscape HTTP Cookie File\n#HttpOnly_{host}\tFALSE\t/\tFALSE\t0\tsid\t{token}\n");
    fs::write(&cli.cookie_file, jar).map_err(|e| format!("can't write {}: {e}", cli.cookie_file))?;

    let user = &body["user"];
    println!(
        "Signed in as {} {} <{}>{}",
        user["first_name"].as_str().unwrap_or(""),
        user["last_name"].as_str().unwrap_or(""),
        user["email"].as_str().unwrap_or(""),
        if user["is_super_admin"] == true { " (super admin)" } else { "" },
    );
    if user["must_change_password"] == true {
        println!("Note: this account must change its password before anything but /api/me works.");
    }
    println!("Saved the session cookie to {}. Use it with curl:", cli.cookie_file);
    println!();
    println!("  curl -b {} {base}/api/me", cli.cookie_file);
    println!("  curl -b {} -X POST {base}/api/... -H 'Origin: {}' -H 'Content-Type: application/json' -d '{{...}}'", cli.cookie_file, cli.origin);
    Ok(())
}
