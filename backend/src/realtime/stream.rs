//! `GET /api/stream`: Server-Sent Events.
//!
//! Each connection keeps its Actor, refreshed every 60 s and whenever a
//! `permissions_changed` signal names it. A signal is forwarded when the
//! actor is a super admin, is a recipient, or shares a branch with it.
//! A comment heartbeat goes out every 25 s.

use std::{convert::Infallible, sync::Arc, time::Duration};

use axum::{
    extract::State,
    http::HeaderMap,
    response::sse::{Event as SseEvent, KeepAlive, Sse},
};
use serde_json::json;
use tokio::sync::{broadcast::error::RecvError, mpsc};
use tokio_stream::{wrappers::ReceiverStream, Stream};

use super::Signal;
use crate::{
    auth::{
        middleware::session_token,
        session::{self, SessionToken},
        Authenticated,
    },
    authz::Actor,
    error::{AppError, AppResult},
    AppState,
};

pub const REFRESH_EVERY: Duration = Duration::from_secs(60);
pub const HEARTBEAT_EVERY: Duration = Duration::from_secs(25);

type Item = Result<SseEvent, Infallible>;

pub async fn handler(
    State(state): State<AppState>,
    auth: Authenticated,
    headers: HeaderMap,
) -> AppResult<Sse<impl Stream<Item = Item>>> {
    if auth.must_change_password {
        return Err(AppError::forbidden("password_change_required", "change your password to continue"));
    }
    let token =
        session_token(&headers).ok_or_else(|| AppError::unauthorized("unauthenticated", "sign in to continue"))?;
    let (tx, rx) = mpsc::channel(64);
    tokio::spawn(connection(state, token, auth.actor, tx));
    Ok(Sse::new(ReceiverStream::new(rx)).keep_alive(KeepAlive::new().interval(HEARTBEAT_EVERY).text("heartbeat")))
}

async fn connection(state: AppState, token: SessionToken, mut actor: Actor, tx: mpsc::Sender<Item>) {
    let mut signals = state.realtime.subscribe();
    let mut refresh = tokio::time::interval(REFRESH_EVERY);
    refresh.tick().await; // the first tick is immediate
    if tx.send(Ok(SseEvent::default().event("ready").data("{}"))).await.is_err() {
        return;
    }

    loop {
        tokio::select! {
            _ = tx.closed() => break,
            _ = refresh.tick() => match reload(&state, &token).await {
                Some(fresh) => actor = fresh,
                None => {
                    let _ = tx.send(Ok(SseEvent::default().event("session_ended").data("{}"))).await;
                    break;
                }
            },
            received = signals.recv() => {
                let signal = match received {
                    Ok(signal) => signal,
                    // Too slow to keep up: tell the client to refetch everything.
                    Err(RecvError::Lagged(_)) => Arc::new(Signal::resync()),
                    Err(RecvError::Closed) => break,
                };
                if signal.kind == "permissions_changed" && signal.recipient_ids.contains(&actor.user_id) {
                    match reload(&state, &token).await {
                        Some(fresh) => actor = fresh,
                        None => {
                            let _ = tx.send(Ok(SseEvent::default().event("session_ended").data("{}"))).await;
                            break;
                        }
                    }
                }
                if let Some(event) = forward(&actor, &signal) {
                    if tx.send(Ok(event)).await.is_err() {
                        break;
                    }
                }
            }
        }
    }
}

/// The session must still be valid; returns a freshly loaded Actor.
async fn reload(state: &AppState, token: &SessionToken) -> Option<Actor> {
    let session = session::lookup(&state.db, token).await.ok()??;
    if session.must_change_password {
        return None;
    }
    Actor::load(&state.db, session.user_id, session.is_super_admin).await.ok()
}

/// The SSE event for this actor, or `None` if the signal isn't theirs.
/// Only IDs go out, and only the actor's own branches.
pub fn forward(actor: &Actor, signal: &Signal) -> Option<SseEvent> {
    let is_recipient = signal.recipient_ids.contains(&actor.user_id);
    let branch_ids: Vec<_> = if actor.is_super_admin {
        signal.branch_ids.clone()
    } else {
        signal.branch_ids.iter().copied().filter(|b| actor.branches.contains_key(b)).collect()
    };
    let wanted = signal.kind == "resync" || actor.is_super_admin || is_recipient || !branch_ids.is_empty();
    if !wanted {
        return None;
    }
    let data = json!({ "kind": signal.kind, "issue_id": signal.issue_id, "branch_ids": branch_ids });
    Some(SseEvent::default().event(signal.kind.as_str()).data(data.to_string()))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use uuid::Uuid;

    use super::*;
    use crate::authz::BranchAccess;

    const A: Uuid = Uuid::from_u128(0xA);
    const B: Uuid = Uuid::from_u128(0xB);
    const ME: Uuid = Uuid::from_u128(1);

    fn actor(branches: &[Uuid], super_admin: bool) -> Actor {
        Actor {
            user_id: ME,
            is_super_admin: super_admin,
            branches: branches.iter().map(|b| (*b, BranchAccess::default())).collect::<HashMap<_, _>>(),
        }
    }

    fn signal(kind: &str, branches: &[Uuid], recipients: &[Uuid]) -> Signal {
        Signal {
            kind: kind.into(),
            issue_id: Some(Uuid::from_u128(0x99)),
            branch_ids: branches.to_vec(),
            recipient_ids: recipients.to_vec(),
        }
    }

    #[test]
    fn forwards_by_branch_recipient_or_super_admin() {
        let in_a = actor(&[A], false);
        assert!(forward(&in_a, &signal("issue_created", &[A], &[])).is_some());
        assert!(forward(&in_a, &signal("issue_created", &[B], &[])).is_none());
        assert!(forward(&in_a, &signal("notification", &[], &[ME])).is_some());
        assert!(forward(&in_a, &signal("notification", &[], &[Uuid::from_u128(2)])).is_none());
        assert!(forward(&actor(&[], true), &signal("issue_created", &[B], &[])).is_some());
        assert!(forward(&actor(&[], false), &Signal::resync()).is_some());
        // Cross-branch: forwarded if any branch matches.
        assert!(forward(&in_a, &signal("issue_created", &[B, A], &[])).is_some());
    }
}
