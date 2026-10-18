use std::{env, net::SocketAddr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    Pretty,
    Json,
}

#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub database_max_connections: u32,
    pub bind_addr: SocketAddr,
    /// Origin of the frontend, e.g. `https://tickets.example.org`. Used for the
    /// CSRF origin check and CORS.
    pub app_origin: String,
    /// Sets the `Secure` flag on the session cookie. Off in dev (plain HTTP).
    pub cookie_secure: bool,
    pub log_format: LogFormat,
    /// Root directory of the local attachment store.
    pub storage_dir: String,
    /// Run the background jobs (SLA, reminders, cleanup) in this process.
    pub jobs_enabled: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("config: {0}")]
pub struct ConfigError(String);

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        let log_format = match optional("LOG_FORMAT").as_deref() {
            None | Some("pretty") => LogFormat::Pretty,
            Some("json") => LogFormat::Json,
            Some(other) => return Err(ConfigError(format!("LOG_FORMAT must be pretty or json, got {other:?}"))),
        };

        Ok(Self {
            database_url: required("DATABASE_URL")?,
            database_max_connections: parse_or("DATABASE_MAX_CONNECTIONS", 10)?,
            bind_addr: parse_or("BIND_ADDR", SocketAddr::from(([127, 0, 0, 1], 8080)))?,
            app_origin: required("APP_ORIGIN")?.trim_end_matches('/').to_owned(),
            cookie_secure: parse_or("COOKIE_SECURE", true)?,
            log_format,
            storage_dir: optional("STORAGE_DIR").unwrap_or_else(|| "./data/attachments".into()),
            jobs_enabled: parse_or("JOBS_ENABLED", true)?,
        })
    }
}

fn optional(key: &str) -> Option<String> {
    env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn required(key: &str) -> Result<String, ConfigError> {
    optional(key).ok_or_else(|| ConfigError(format!("{key} must be set")))
}

fn parse_or<T: std::str::FromStr>(key: &str, default: T) -> Result<T, ConfigError> {
    match optional(key) {
        None => Ok(default),
        Some(v) => v.parse().map_err(|_| ConfigError(format!("{key} has an invalid value: {v:?}"))),
    }
}
