//! Checks that the server is up and can reach its database.
//!
//! ```text
//! cargo run --bin health
//! cargo run --bin health -- --url http://127.0.0.1:8080
//! ```

use std::process::ExitCode;

use clap::Parser;

#[derive(Parser)]
#[command(about = "Check the server's health endpoint")]
struct Cli {
    /// The server's address.
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    url: String,
}

#[tokio::main]
async fn main() -> ExitCode {
    let cli = Cli::parse();
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
