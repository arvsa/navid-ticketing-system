use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::comments::{self, Comment, CommentPatch, NewComment},
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/issues/{id}/comments", get(list).post(create))
        .route("/comments/{id}", patch(update).delete(remove))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    after: Option<String>,
    limit: Option<i64>,
    work_item_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/issues/{id}/comments", operation_id = "listComments", tag = "comments", params(("id" = uuid::Uuid, Path, description = "id"), ListQuery), responses((status = 200, body = Page<Comment>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<Comment>>> {
    let page = PageParams { after: q.after, limit: q.limit };
    Ok(Json(comments::list(&s.db, &actor, id, q.work_item_id, &page).await?))
}

#[utoipa::path(post, path = "/api/issues/{id}/comments", operation_id = "createComment", tag = "comments", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewComment, responses((status = 201, body = Comment), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewComment>,
) -> AppResult<(StatusCode, Json<Comment>)> {
    Ok((StatusCode::CREATED, Json(comments::create(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(patch, path = "/api/comments/{id}", operation_id = "updateComment", tag = "comments", params(("id" = uuid::Uuid, Path, description = "id")), request_body = CommentPatch, responses((status = 200, body = Comment), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<CommentPatch>,
) -> AppResult<Json<Comment>> {
    Ok(Json(comments::update(&s.db, &actor, id, patch).await?))
}

#[utoipa::path(delete, path = "/api/comments/{id}", operation_id = "deleteComment", tag = "comments", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<StatusCode> {
    comments::delete(&s.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
