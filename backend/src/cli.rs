//! Helpers shared by the small command-line tools in `src/bin`.

use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};

/// Connects to the database for an operator tool, failing within a few
/// seconds with a message that says where it tried, instead of sqlx's bare
/// `PoolTimedOut` after 30.
pub async fn connect(database_url: &str) -> Result<PgPool, String> {
    let options: PgConnectOptions = database_url.parse().map_err(|e| format!("DATABASE_URL is not valid: {e}"))?;
    let host = options.get_host().to_owned();
    let port = options.get_port();
    PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .connect_with(options)
        .await
        .map_err(|e| {
            let mut msg = format!("Can't reach the database at {host}:{port} ({e}).");
            if matches!(host.as_str(), "localhost" | "127.0.0.1" | "::1") {
                msg.push_str(
                    "\nIs it running? If you're inside a container, localhost is the container itself: \
                     run the tool in the backend container instead, which has the right DATABASE_URL:\n  \
                     docker compose exec backend admin --help",
                );
            } else {
                msg.push_str("\nIs the database running and reachable from here?");
            }
            msg
        })
}

/// The `sid` value from a curl (Netscape) cookie file, as written by
/// `cargo run --bin login` or `curl -c`, or from a plain `sid=...` line.
pub fn session_token(contents: &str) -> Option<String> {
    for line in contents.lines() {
        let line = line.trim();
        // curl marks HttpOnly cookies with this prefix; other `#` lines are comments.
        let line = match line.strip_prefix("#HttpOnly_") {
            Some(rest) => rest,
            None if line.starts_with('#') || line.is_empty() => continue,
            None => line,
        };
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() >= 7 && fields[5] == "sid" {
            return Some(fields[6].to_owned());
        }
        if let Some(value) = line.strip_prefix("sid=") {
            return Some(value.split(';').next().unwrap_or(value).to_owned());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::session_token;

    #[test]
    fn reads_curl_and_plain_cookie_files() {
        let curl = "# Netscape HTTP Cookie File\n#HttpOnly_127.0.0.1\tFALSE\t/\tFALSE\t0\tsid\tabc123\n";
        assert_eq!(session_token(curl).as_deref(), Some("abc123"));
        assert_eq!(session_token("sid=xyz; Path=/").as_deref(), Some("xyz"));
        assert_eq!(session_token("# only a comment\n"), None);
        assert_eq!(session_token(""), None);
    }
}
