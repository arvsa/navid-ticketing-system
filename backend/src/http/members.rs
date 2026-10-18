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
    domain::{
        groups::{self, EffectivePermissions},
        members::{self, AddedMember, Member, MemberQuery, NewMember, PasswordReset, ProfilePatch},
    },
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/branches/{id}/members", get(list).post(add))
        .route("/branches/{id}/members/{user_id}", patch(update).delete(remove))
        .route("/branches/{id}/members/{user_id}/effective-permissions", get(effective_permissions))
        .route("/users/{id}/reset-password", post(reset_password))
        .route("/users/{id}/active", patch(set_active))
}

/// Flat on purpose: `serde(flatten)` breaks typed query-string fields.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ListQuery {
    after: Option<String>,
    limit: Option<i64>,
    #[serde(default)]
    include_left: bool,
    group_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/branches/{id}/members", operation_id = "listMembers", tag = "members", params(("id" = uuid::Uuid, Path, description = "id"), ListQuery), responses((status = 200, body = Page<Member>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<Member>>> {
    Ok(Json(
        members::list(
            &s.db,
            &actor,
            id,
            &MemberQuery { include_left: q.include_left, group_id: q.group_id },
            &PageParams { after: q.after, limit: q.limit },
        )
        .await?,
    ))
}

#[utoipa::path(post, path = "/api/branches/{id}/members", operation_id = "addMember", tag = "members", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewMember, responses((status = 201, body = AddedMember), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn add(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewMember>,
) -> AppResult<(StatusCode, Json<AddedMember>)> {
    Ok((StatusCode::CREATED, Json(members::add(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(patch, path = "/api/branches/{id}/members/{user_id}", operation_id = "updateMember", tag = "members", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), request_body = ProfilePatch, responses((status = 200, body = Member), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
    ApiJson(patch): ApiJson<ProfilePatch>,
) -> AppResult<Json<Member>> {
    Ok(Json(members::update_profile(&s.db, &actor, id, user_id, patch).await?))
}

#[utoipa::path(delete, path = "/api/branches/{id}/members/{user_id}", operation_id = "removeMember", tag = "members", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    members::remove(&s.db, &actor, id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/branches/{id}/members/{user_id}/effective-permissions", operation_id = "getEffectivePermissions", tag = "members", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 200, body = EffectivePermissions), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn effective_permissions(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<Json<EffectivePermissions>> {
    Ok(Json(groups::effective_permissions(&s.db, &actor, id, user_id).await?))
}

#[utoipa::path(post, path = "/api/users/{id}/reset-password", operation_id = "resetUserPassword", tag = "users", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = PasswordReset), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn reset_password(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
) -> AppResult<Json<PasswordReset>> {
    Ok(Json(members::reset_password(&s.db, &actor, id).await?))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
struct ActiveBody {
    is_active: bool,
}

#[utoipa::path(patch, path = "/api/users/{id}/active", operation_id = "setUserActive", tag = "users", params(("id" = uuid::Uuid, Path, description = "id")), request_body = ActiveBody, responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn set_active(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(body): ApiJson<ActiveBody>,
) -> AppResult<StatusCode> {
    members::set_active(&s.db, &actor, id, body.is_active).await?;
    Ok(StatusCode::NO_CONTENT)
}
