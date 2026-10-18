use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, patch, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::reports::{self, NewReport, Report, ReportPatch},
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/issues/{id}/reports", get(list).post(create))
        .route("/reports/{id}", patch(update))
        .route("/reports/{id}/submit", post(submit))
}

#[utoipa::path(get, path = "/api/issues/{id}/reports", operation_id = "listReports", tag = "reports", params(("id" = uuid::Uuid, Path, description = "id"), PageParams), responses((status = 200, body = Page<Report>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> AppResult<Json<Page<Report>>> {
    Ok(Json(reports::list(&s.db, &actor, id, &page).await?))
}

#[utoipa::path(post, path = "/api/issues/{id}/reports", operation_id = "createReport", tag = "reports", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewReport, responses((status = 201, body = Report), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewReport>,
) -> AppResult<(StatusCode, Json<Report>)> {
    Ok((StatusCode::CREATED, Json(reports::create(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(patch, path = "/api/reports/{id}", operation_id = "updateReport", tag = "reports", params(("id" = uuid::Uuid, Path, description = "id")), request_body = ReportPatch, responses((status = 200, body = Report), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<ReportPatch>,
) -> AppResult<Json<Report>> {
    Ok(Json(reports::update(&s.db, &actor, id, patch).await?))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
struct VersionBody {
    version: i32,
}

#[utoipa::path(post, path = "/api/reports/{id}/submit", operation_id = "submitReport", tag = "reports", params(("id" = uuid::Uuid, Path, description = "id")), request_body = VersionBody, responses((status = 200, body = Report), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn submit(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<VersionBody>,
) -> AppResult<Json<Report>> {
    Ok(Json(reports::submit(&s.db, &actor, id, body.version).await?))
}
