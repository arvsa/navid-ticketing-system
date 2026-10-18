use std::time::Duration;

use sqlx::{postgres::PgListener, PgPool};
use tokio::task::JoinHandle;

use super::{Hub, Signal, CHANNEL};

const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// Listens on `app_events` and publishes every payload on the hub.
/// Reconnects with exponential backoff; after any gap, publishes a `resync`
/// so clients refetch what they may have missed.
pub fn spawn(pool: PgPool, hub: Hub) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut backoff = Duration::from_secs(1);
        let mut first = true;
        loop {
            match listen(&pool, &hub, &mut first, &mut backoff).await {
                Ok(()) => {}
                Err(e) => tracing::warn!(error = %e, ?backoff, "realtime listener lost its connection"),
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(MAX_BACKOFF);
        }
    })
}

async fn listen(pool: &PgPool, hub: &Hub, first: &mut bool, backoff: &mut Duration) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(CHANNEL).await?;
    tracing::info!("realtime listener connected");
    *backoff = Duration::from_secs(1);
    if !std::mem::take(first) {
        hub.publish(Signal::resync());
    }
    loop {
        // `None`: the connection dropped and sqlx is reconnecting; anything
        // sent meanwhile is lost, so clients must resync.
        match listener.try_recv().await? {
            Some(n) => match serde_json::from_str::<Signal>(n.payload()) {
                Ok(signal) => hub.publish(signal),
                Err(e) => tracing::warn!(error = %e, "unreadable realtime payload"),
            },
            None => hub.publish(Signal::resync()),
        }
    }
}
