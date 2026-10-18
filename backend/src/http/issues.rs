use axum::{
    extract::State,
    http::StatusCode,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::{
        issues::{self, HistoryEntry, IssueDetail, IssuePatch, IssueQuery, IssueSummary, NewIssue, NewTarget},
        types::IssueState,
    },
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/issues", get(list).post(create))
        .route("/issues/by-number/{n}", get(by_number))
        .route("/issues/{id}", get(show).patch(update))
        .route("/issues/{id}/close", post(close))
        .route("/issues/{id}/cancel", post(cancel))
        .route("/issues/{id}/targets", post(add_target))
        .route("/issues/{id}/targets/{target_id}", delete(remove_target))
        .route("/issues/{id}/read", post(mark_read))
        .route("/issues/{id}/watch", put(watch).delete(unwatch))
        .route("/issues/{id}/history", get(history))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    after: Option<String>,
    limit: Option<i64>,
    branch_id: Option<Uuid>,
    #[serde(rename = "type")]
    issue_type: Option<String>,
    state: Option<IssueState>,
    assignee: Option<String>,
    q: Option<String>,
}

#[utoipa::path(get, path = "/api/issues", operation_id = "listIssues", tag = "issues", params(ListQuery), responses((status = 200, body = Page<IssueSummary>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<IssueSummary>>> {
    let page = PageParams { after: q.after, limit: q.limit };
    let filter =
        IssueQuery { branch_id: q.branch_id, issue_type: q.issue_type, state: q.state, assignee: q.assignee, q: q.q };
    Ok(Json(issues::list(&s.db, &actor, &filter, &page).await?))
}

#[utoipa::path(post, path = "/api/issues", operation_id = "createIssue", tag = "issues", request_body = NewIssue, responses((status = 201, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiJson(input): ApiJson<NewIssue>,
) -> AppResult<(StatusCode, Json<IssueDetail>)> {
    Ok((StatusCode::CREATED, Json(issues::create(&s.db, &actor, input).await?)))
}

#[utoipa::path(get, path = "/api/issues/{id}", operation_id = "getIssue", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn show(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Json<IssueDetail>> {
    Ok(Json(issues::get(&s.db, &actor, id).await?))
}

#[utoipa::path(get, path = "/api/issues/by-number/{n}", operation_id = "getIssueByNumber", tag = "issues", params(("n" = i64, Path, description = "Issue number, as in ISS-<n>")), responses((status = 200, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn by_number(State(s): State<AppState>, actor: Actor, ApiPath(n): ApiPath<i64>) -> AppResult<Json<IssueDetail>> {
    Ok(Json(issues::get_by_number(&s.db, &actor, n).await?))
}

#[utoipa::path(patch, path = "/api/issues/{id}", operation_id = "updateIssue", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), request_body = IssuePatch, responses((status = 200, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<IssuePatch>,
) -> AppResult<Json<IssueDetail>> {
    Ok(Json(issues::update(&s.db, &actor, id, patch).await?))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
struct VersionBody {
    version: i32,
}

#[utoipa::path(post, path = "/api/issues/{id}/close", operation_id = "closeIssue", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), request_body = VersionBody, responses((status = 200, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn close(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<VersionBody>,
) -> AppResult<Json<IssueDetail>> {
    Ok(Json(issues::close(&s.db, &actor, id, body.version, IssueState::Closed).await?))
}

#[utoipa::path(post, path = "/api/issues/{id}/cancel", operation_id = "cancelIssue", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), request_body = VersionBody, responses((status = 200, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn cancel(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<VersionBody>,
) -> AppResult<Json<IssueDetail>> {
    Ok(Json(issues::close(&s.db, &actor, id, body.version, IssueState::Cancelled).await?))
}

#[utoipa::path(post, path = "/api/issues/{id}/targets", operation_id = "addIssueTarget", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewTarget, responses((status = 201, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn add_target(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewTarget>,
) -> AppResult<(StatusCode, Json<IssueDetail>)> {
    Ok((StatusCode::CREATED, Json(issues::add_target(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(delete, path = "/api/issues/{id}/targets/{target_id}", operation_id = "removeIssueTarget", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id"), ("target_id" = uuid::Uuid, Path, description = "Target id")), responses((status = 200, body = IssueDetail), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove_target(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, target_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<Json<IssueDetail>> {
    Ok(Json(issues::remove_target(&s.db, &actor, id, target_id).await?))
}

#[utoipa::path(post, path = "/api/issues/{id}/read", operation_id = "markIssueRead", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn mark_read(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<StatusCode> {
    issues::mark_read(&s.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(put, path = "/api/issues/{id}/watch", operation_id = "watchIssue", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn watch(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<StatusCode> {
    issues::set_watching(&s.db, &actor, id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/issues/{id}/watch", operation_id = "unwatchIssue", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn unwatch(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<StatusCode> {
    issues::set_watching(&s.db, &actor, id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/issues/{id}/history", operation_id = "getIssueHistory", tag = "issues", params(("id" = uuid::Uuid, Path, description = "id"), PageParams), responses((status = 200, body = Page<HistoryEntry>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn history(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> AppResult<Json<Page<HistoryEntry>>> {
    Ok(Json(issues::history(&s.db, &actor, id, &page).await?))
}
