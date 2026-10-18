use std::net::SocketAddr;

use axum::{
    extract::{ConnectInfo, FromRequestParts, Request, State},
    http::{header, request::Parts, HeaderMap, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};
use uuid::Uuid;

use super::session::{self, ClientMeta, SessionToken};
use crate::{authz::Actor, error::AppError, AppState};

fn unauthenticated() -> AppError {
    AppError::unauthorized("unauthenticated", "sign in to continue")
}

/// Reads the session token from the `Cookie` header(s).
pub fn session_token(headers: &HeaderMap) -> Option<SessionToken> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == session::COOKIE_NAME)
        .and_then(|(_, value)| SessionToken::parse(value))
}

/// A signed-in user, *without* the `must_change_password` gate. Only the
/// endpoints a user needs while changing their password use this directly:
/// `GET /api/me`, `POST /api/me/password` and logout. Everything else
/// extracts [`Actor`], which applies the gate.
pub struct Authenticated {
    pub session_id: Uuid,
    pub must_change_password: bool,
    pub actor: Actor,
}

impl FromRequestParts<AppState> for Authenticated {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = session_token(&parts.headers).ok_or_else(unauthenticated)?;
        let session = session::lookup(&state.db, &token).await?.ok_or_else(unauthenticated)?;
        let actor = Actor::load(&state.db, session.user_id, session.is_super_admin).await?;
        Ok(Self { session_id: session.session_id, must_change_password: session.must_change_password, actor })
    }
}

impl FromRequestParts<AppState> for Actor {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let auth = Authenticated::from_request_parts(parts, state).await?;
        if auth.must_change_password {
            return Err(AppError::forbidden("password_change_required", "change your password to continue"));
        }
        Ok(auth.actor)
    }
}

impl<S: Send + Sync> FromRequestParts<S> for ClientMeta {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let user_agent =
            parts.headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok()).map(|v| v.chars().take(512).collect());
        let ip = parts.extensions.get::<ConnectInfo<SocketAddr>>().map(|c| c.0.ip());
        Ok(Self { user_agent, ip })
    }
}

/// CSRF protection: every non-GET request must carry an `Origin` header equal
/// to the configured app origin. Login included.
pub async fn require_origin(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    let origin_ok = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|origin| origin == state.config.app_origin);
    if safe || origin_ok {
        next.run(req).await
    } else {
        AppError::forbidden("origin_mismatch", "request origin is not allowed").into_response()
    }
}
