use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, patch, put},
    Json, Router,
};
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::branches::{self, Branch, BranchPatch, NewBranch},
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/branches", get(list).post(create))
        .route("/branches/{id}", patch(update).get(show))
        .route("/branches/{id}/admins/{user_id}", put(appoint_admin).delete(demote_admin))
        .route("/users/{id}/super-admin", put(grant_super_admin).delete(revoke_super_admin))
}

#[utoipa::path(get, path = "/api/branches", operation_id = "listBranches", tag = "branches", params(PageParams), responses((status = 200, body = Page<Branch>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(page): ApiQuery<PageParams>,
) -> AppResult<Json<Page<Branch>>> {
    Ok(Json(branches::list(&s.db, &actor, &page).await?))
}

#[utoipa::path(get, path = "/api/branches/{id}", operation_id = "getBranch", tag = "branches", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = Branch), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn show(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Json<Branch>> {
    Ok(Json(branches::get(&s.db, &actor, id).await?))
}

#[utoipa::path(post, path = "/api/branches", operation_id = "createBranch", tag = "branches", request_body = NewBranch, responses((status = 201, body = Branch), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiJson(input): ApiJson<NewBranch>,
) -> AppResult<(StatusCode, Json<Branch>)> {
    Ok((StatusCode::CREATED, Json(branches::create(&s.db, &actor, input).await?)))
}

#[utoipa::path(patch, path = "/api/branches/{id}", operation_id = "updateBranch", tag = "branches", params(("id" = uuid::Uuid, Path, description = "id")), request_body = BranchPatch, responses((status = 200, body = Branch), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<BranchPatch>,
) -> AppResult<Json<Branch>> {
    Ok(Json(branches::update(&s.db, &actor, id, patch).await?))
}

#[utoipa::path(put, path = "/api/branches/{id}/admins/{user_id}", operation_id = "appointBranchAdmin", tag = "branches", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn appoint_admin(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    branches::set_admin(&s.db, &actor, id, user_id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/branches/{id}/admins/{user_id}", operation_id = "demoteBranchAdmin", tag = "branches", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn demote_admin(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    branches::set_admin(&s.db, &actor, id, user_id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(put, path = "/api/users/{id}/super-admin", operation_id = "grantSuperAdmin", tag = "users", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn grant_super_admin(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
) -> AppResult<StatusCode> {
    branches::set_super_admin(&s.db, &actor, id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/users/{id}/super-admin", operation_id = "revokeSuperAdmin", tag = "users", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn revoke_super_admin(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
) -> AppResult<StatusCode> {
    branches::set_super_admin(&s.db, &actor, id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}
