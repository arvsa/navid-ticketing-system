use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::json::{ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::notifications::{self, Notification},
    error::AppResult,
    pagination::{Page, PageParams},
    realtime, AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list))
        .route("/notifications/unread-count", get(unread_count))
        .route("/notifications/read-all", post(read_all))
        .route("/notifications/{id}/read", post(read))
        .route("/stream", get(stream))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    #[serde(default)]
    unread: bool,
    after: Option<String>,
    limit: Option<i64>,
}

#[utoipa::path(get, path = "/api/notifications", operation_id = "listNotifications", tag = "notifications", params(ListQuery), responses((status = 200, body = Page<Notification>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<Notification>>> {
    let page = PageParams { after: q.after, limit: q.limit };
    Ok(Json(notifications::list(&s.db, &actor, q.unread, &page).await?))
}

#[utoipa::path(get, path = "/api/notifications/unread-count", operation_id = "getUnreadCount", tag = "notifications", responses((status = 200, description = "`{\"count\": n}`"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn unread_count(State(s): State<AppState>, actor: Actor) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "count": notifications::unread_count(&s.db, &actor).await? })))
}

#[utoipa::path(post, path = "/api/notifications/{id}/read", operation_id = "markNotificationRead", tag = "notifications", params(("id" = i64, Path, description = "Notification id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn read(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<i64>) -> AppResult<StatusCode> {
    notifications::mark_read(&s.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(post, path = "/api/notifications/read-all", operation_id = "markAllNotificationsRead", tag = "notifications", responses((status = 200, description = "`{\"marked\": n}`"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn read_all(State(s): State<AppState>, actor: Actor) -> AppResult<Json<Value>> {
    Ok(Json(json!({ "marked": notifications::mark_all_read(&s.db, &actor).await? })))
}

/// Server-Sent Events: IDs-only change signals for this user. See the README.
#[utoipa::path(get, path = "/api/stream", operation_id = "streamEvents", tag = "notifications", responses((status = 200, description = "An SSE stream", content_type = "text/event-stream"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn stream(
    state: State<AppState>,
    auth: crate::auth::Authenticated,
    headers: axum::http::HeaderMap,
) -> AppResult<axum::response::Response> {
    use axum::response::IntoResponse;
    Ok(realtime::stream::handler(state, auth, headers).await?.into_response())
}
