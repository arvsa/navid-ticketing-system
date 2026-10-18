use axum::{
    extract::State,
    routing::{get, put},
    Json, Router,
};
use serde::Deserialize;
use time::OffsetDateTime;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::events::{self, CalendarEntry, CalendarQuery, Rsvp, RsvpInput, RsvpPage},
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/calendar", get(calendar))
        .route("/events/{id}/rsvp", put(respond))
        .route("/events/{id}/rsvps", get(rsvps))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct CalendarParams {
    #[serde(with = "time::serde::rfc3339")]
    from: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    to: OffsetDateTime,
    branch_id: Option<Uuid>,
    after: Option<String>,
    limit: Option<i64>,
}

#[utoipa::path(get, path = "/api/calendar", operation_id = "getCalendar", tag = "events", params(CalendarParams), responses((status = 200, body = Page<CalendarEntry>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn calendar(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<CalendarParams>,
) -> AppResult<Json<Page<CalendarEntry>>> {
    let query = CalendarQuery { from: q.from, to: q.to, branch_id: q.branch_id };
    let page = PageParams { after: q.after, limit: q.limit };
    Ok(Json(events::calendar(&s.db, &actor, &query, &page).await?))
}

#[utoipa::path(put, path = "/api/events/{id}/rsvp", operation_id = "rsvpEvent", tag = "events", params(("id" = uuid::Uuid, Path, description = "id")), request_body = RsvpInput, responses((status = 200, body = Rsvp), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn respond(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<RsvpInput>,
) -> AppResult<Json<Rsvp>> {
    Ok(Json(events::respond(&s.db, &actor, id, input).await?))
}

#[utoipa::path(get, path = "/api/events/{id}/rsvps", operation_id = "listEventRsvps", tag = "events", params(("id" = uuid::Uuid, Path, description = "id"), PageParams), responses((status = 200, body = RsvpPage), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn rsvps(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> AppResult<Json<RsvpPage>> {
    Ok(Json(events::list(&s.db, &actor, id, &page).await?))
}
