//! Real-time updates (BACKEND_PLAN.md section 8).
//!
//! 1. Every mutating transaction ends with [`emit`], a `pg_notify` on
//!    `app_events` that Postgres delivers only on commit.
//! 2. [`listener`] holds one `LISTEN app_events` connection and publishes
//!    each payload on the in-process [`Hub`].
//! 3. [`stream`] serves `GET /api/stream` (SSE): each connection forwards
//!    the signals its actor may know about.
//!
//! Events carry IDs only, never content: clients refetch through the API,
//! which applies permissions.

pub mod listener;
pub mod stream;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{db::Tx, error::AppResult};

pub const CHANNEL: &str = "app_events";

/// What a transaction sends on commit.
#[derive(Debug, Serialize)]
pub struct Event {
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_id: Option<Uuid>,
    pub branch_ids: Vec<Uuid>,
    pub recipient_ids: Vec<Uuid>,
}

pub async fn emit(tx: &mut Tx, event: Event) -> AppResult<()> {
    let payload = serde_json::to_string(&event).map_err(crate::error::AppError::internal)?;
    sqlx::query!("SELECT pg_notify($1, $2)", CHANNEL, payload).execute(&mut **tx).await?;
    Ok(())
}

/// A received event, as published on the hub.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Signal {
    pub kind: String,
    #[serde(default)]
    pub issue_id: Option<Uuid>,
    #[serde(default)]
    pub branch_ids: Vec<Uuid>,
    #[serde(default)]
    pub recipient_ids: Vec<Uuid>,
}

impl Signal {
    /// Tells every client to refetch everything (missed events).
    pub fn resync() -> Self {
        Self { kind: "resync".into(), issue_id: None, branch_ids: vec![], recipient_ids: vec![] }
    }
}

/// Fan-out of signals to every open stream in this process.
#[derive(Clone)]
pub struct Hub {
    tx: broadcast::Sender<Arc<Signal>>,
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

impl Hub {
    pub fn new() -> Self {
        Self { tx: broadcast::channel(1024).0 }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<Signal>> {
        self.tx.subscribe()
    }

    pub fn publish(&self, signal: Signal) {
        // No subscribers is fine: nobody is connected.
        let _ = self.tx.send(Arc::new(signal));
    }
}
