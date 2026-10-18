use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::{
        types::WorkStatus,
        work_items::{self, Transition, TransitionInput, WorkItem, WorkItemQuery},
    },
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/work-items", get(list))
        .route("/work-items/{id}", get(show))
        // start | block | unblock | submit | approve | reject | claim | assign | cancel
        .route("/work-items/{id}/{transition}", post(transition))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    after: Option<String>,
    limit: Option<i64>,
    assignee: Option<String>,
    status: Option<WorkStatus>,
    branch_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/work-items", operation_id = "listWorkItems", tag = "work items", params(ListQuery), responses((status = 200, body = Page<WorkItem>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<WorkItem>>> {
    let page = PageParams { after: q.after, limit: q.limit };
    let filter = WorkItemQuery { assignee: q.assignee, status: q.status, branch_id: q.branch_id };
    Ok(Json(work_items::list(&s.db, &actor, &filter, &page).await?))
}

#[utoipa::path(get, path = "/api/work-items/{id}", operation_id = "getWorkItem", tag = "work items", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = WorkItem), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn show(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Json<WorkItem>> {
    Ok(Json(work_items::get(&s.db, &actor, id).await?))
}

#[utoipa::path(post, path = "/api/work-items/{id}/{transition}", operation_id = "transitionWorkItem", tag = "work items", params(("id" = uuid::Uuid, Path, description = "id"), ("transition" = Transition, Path)), request_body = TransitionInput, responses((status = 200, body = WorkItem), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn transition(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, transition)): ApiPath<(Uuid, Transition)>,
    ApiJson(input): ApiJson<TransitionInput>,
) -> AppResult<Json<WorkItem>> {
    Ok(Json(work_items::transition(&s.db, &actor, id, transition, input).await?))
}
