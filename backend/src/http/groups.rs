use axum::{
    extract::State,
    http::StatusCode,
    routing::{delete, get, patch, put},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::groups::{self, DeleteOutcome, Group, GroupGrant, GroupPatch, GroupQuery, NewGrant, NewGroup},
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/branches/{id}/groups", get(list).post(create))
        .route("/groups/{id}", patch(update).delete(remove))
        .route("/groups/{id}/members/{user_id}", put(add_member).delete(remove_member))
        .route("/groups/{id}/permissions", get(list_grants).post(grant))
        .route("/group-permissions/{id}", delete(revoke))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    after: Option<String>,
    limit: Option<i64>,
    #[serde(default)]
    include_archived: bool,
}

#[utoipa::path(get, path = "/api/branches/{id}/groups", operation_id = "listGroups", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id"), ListQuery), responses((status = 200, body = Page<Group>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<Group>>> {
    Ok(Json(
        groups::list(
            &s.db,
            &actor,
            id,
            &GroupQuery { include_archived: q.include_archived },
            &PageParams { after: q.after, limit: q.limit },
        )
        .await?,
    ))
}

#[utoipa::path(post, path = "/api/branches/{id}/groups", operation_id = "createGroup", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewGroup, responses((status = 201, body = Group), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewGroup>,
) -> AppResult<(StatusCode, Json<Group>)> {
    Ok((StatusCode::CREATED, Json(groups::create(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(patch, path = "/api/groups/{id}", operation_id = "updateGroup", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id")), request_body = GroupPatch, responses((status = 200, body = Group), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<GroupPatch>,
) -> AppResult<Json<Group>> {
    Ok(Json(groups::update(&s.db, &actor, id, patch).await?))
}

#[utoipa::path(delete, path = "/api/groups/{id}", operation_id = "deleteGroup", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = DeleteOutcome), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Json<DeleteOutcome>> {
    Ok(Json(groups::delete(&s.db, &actor, id).await?))
}

#[utoipa::path(put, path = "/api/groups/{id}/members/{user_id}", operation_id = "addGroupMember", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn add_member(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    groups::add_member(&s.db, &actor, id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/groups/{id}/members/{user_id}", operation_id = "removeGroupMember", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove_member(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    groups::remove_member(&s.db, &actor, id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/groups/{id}/permissions", operation_id = "listGroupGrants", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id"), PageParams), responses((status = 200, body = Page<GroupGrant>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list_grants(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(page): ApiQuery<PageParams>,
) -> AppResult<Json<Page<GroupGrant>>> {
    Ok(Json(groups::list_grants(&s.db, &actor, id, &page).await?))
}

#[utoipa::path(post, path = "/api/groups/{id}/permissions", operation_id = "grantGroupPermission", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewGrant, responses((status = 201, body = GroupGrant), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn grant(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewGrant>,
) -> AppResult<(StatusCode, Json<GroupGrant>)> {
    Ok((StatusCode::CREATED, Json(groups::grant(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(delete, path = "/api/group-permissions/{id}", operation_id = "revokeGroupPermission", tag = "groups", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn revoke(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<StatusCode> {
    groups::revoke(&s.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}
