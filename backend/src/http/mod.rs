mod attachments;
mod auth;
mod branches;
mod comments;
mod dashboard;
mod events;
mod groups;
mod health;
mod issues;
pub mod json;
mod members;
mod notifications;
pub mod openapi;
mod permissions;
mod reports;
mod work_items;

use std::time::Duration;

use axum::{
    extract::DefaultBodyLimit,
    http::{header, HeaderName, HeaderValue, Method, Request, StatusCode},
    middleware, Router,
};
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer},
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

use crate::{auth::middleware::require_origin, error::AppError, AppState};

/// JSON bodies are small; attachment uploads raise their own limit.
const DEFAULT_BODY_LIMIT: usize = 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// A 25 MB upload over a slow school connection needs longer.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub fn router(state: AppState) -> Router {
    let timed = Router::new()
        .merge(health::routes())
        .merge(auth::routes())
        .merge(permissions::routes())
        .merge(branches::routes())
        .merge(members::routes())
        .merge(groups::routes())
        .merge(issues::routes())
        .merge(work_items::routes())
        .merge(comments::routes())
        .merge(reports::routes())
        .merge(events::routes())
        // The SSE stream's body outlives this: the timeout only bounds the
        // time to the response head.
        .merge(notifications::routes())
        .merge(dashboard::routes())
        .merge(openapi::routes())
        .layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, REQUEST_TIMEOUT));
    let uploads =
        attachments::routes().layer(TimeoutLayer::with_status_code(StatusCode::REQUEST_TIMEOUT, UPLOAD_TIMEOUT));

    let api = timed
        .merge(uploads)
        .fallback(|| async { AppError::NotFound })
        .layer(middleware::from_fn_with_state(state.clone(), require_origin));

    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_str(&state.config.app_origin).expect("APP_ORIGIN is not a valid header value"))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE]);
    let hsts = state.config.cookie_secure.then(|| {
        SetResponseHeaderLayer::if_not_present(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        )
    });
    let request_id = HeaderName::from_static("x-request-id");

    let app = Router::new()
        .nest("/api", api)
        .with_state(state)
        .layer(DefaultBodyLimit::max(DEFAULT_BODY_LIMIT))
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
        .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer")))
        // API responses are per-user: never cache them in shared caches.
        .layer(SetResponseHeaderLayer::if_not_present(header::CACHE_CONTROL, HeaderValue::from_static("no-store")));
    // HSTS only when served over HTTPS (the session cookie is Secure).
    let app = match hsts {
        Some(layer) => app.layer(layer),
        None => app,
    };
    app
        // Logs method, path, status, latency and the request id only; never
        // headers, query strings or bodies, so cookies and passwords stay
        // out of the logs.
        .layer(TraceLayer::new_for_http().make_span_with(|req: &Request<_>| {
            let id = req.headers().get("x-request-id").and_then(|v| v.to_str().ok()).unwrap_or("-");
            tracing::info_span!("request", method = %req.method(), path = %req.uri().path(), request_id = %id)
        }))
        .layer(PropagateRequestIdLayer::new(request_id.clone()))
        .layer(SetRequestIdLayer::new(request_id, MakeRequestUuid))
}
