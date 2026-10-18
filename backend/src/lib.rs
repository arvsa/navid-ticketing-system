pub mod auth;
pub mod authz;
pub mod cli;
pub mod config;
pub mod db;
pub mod domain;
pub mod error;
pub mod http;
pub mod jobs;
pub mod pagination;
pub mod realtime;
pub mod seed;
pub mod storage;
pub mod telemetry;

use std::sync::Arc;

use sqlx::PgPool;

pub use config::Config;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub config: Arc<Config>,
    pub storage: Arc<dyn storage::ObjectStore>,
    /// Signals for the SSE streams; fed by `realtime::listener`.
    pub realtime: realtime::Hub,
}

impl AppState {
    /// Uses the local-disk store under `config.storage_dir`.
    pub fn new(db: PgPool, config: Config) -> Self {
        let storage = Arc::new(storage::LocalStore::new(&config.storage_dir));
        Self { db, config: Arc::new(config), storage, realtime: realtime::Hub::new() }
    }
}
