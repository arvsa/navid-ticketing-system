//! Signs out the saved session and deletes the cookie file.
//!
//! ```text
//! cargo run --bin logout
//! cargo run --bin logout -- --cookie-file cookies.txt --url http://127.0.0.1:8080
//! ```

use std::{fs, process::ExitCode};

use backend::cli::session_token;
use clap::Parser;

#[derive(Parser)]
#[command(about = "Sign out the saved session and delete the cookie file")]
struct Cli {
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
        println!("Already signed out: there's no session in {}.", cli.cookie_file);
        return ExitCode::SUCCESS;
    };

    let url = format!("{}/api/auth/logout", cli.url.trim_end_matches('/'));
    let res = match reqwest::Client::new()
        .post(&url)
        .header("Cookie", format!("sid={token}"))
        .header("Origin", &cli.origin)
        .send()
        .await
    {
        Ok(res) => res,
        Err(e) => {
            eprintln!("Can't reach {url} ({e}). Is the server running (`cargo run`)? The cookie file was kept.");
            return ExitCode::FAILURE;
        }
    };

    let status = res.status();
    let message = match status.as_u16() {
        204 => "Signed out.",
        // Expired or already signed out elsewhere: nothing left to end.
        401 => "Already signed out: the session had expired or ended.",
        403 => {
            eprintln!("Sign-out refused: --origin must match the server's APP_ORIGIN. The cookie file was kept.");
            return ExitCode::FAILURE;
        }
        _ => {
            let body = res.text().await.unwrap_or_default();
            eprintln!("Unexpected answer from {url}: {status} {body}. The cookie file was kept.");
            return ExitCode::FAILURE;
        }
    };

    match fs::remove_file(&cli.cookie_file) {
        Ok(()) => println!("{message} Deleted {}.", cli.cookie_file),
        Err(e) => println!("{message} (Couldn't delete {}: {e})", cli.cookie_file),
    }
    ExitCode::SUCCESS
}
