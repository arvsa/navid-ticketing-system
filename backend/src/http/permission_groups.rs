use axum::{
    body::Bytes,
    extract::State,
    http::{header, StatusCode},
    response::IntoResponse,
    routing::{get, patch, put},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::{
        permission_config::{self, ConfigImportOutcome, Format},
        permission_groups::{self, NewPermissionGroup, PermissionGroup, PermissionGroupPatch},
    },
    error::{AppError, AppResult},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/branches/{id}/permission-groups", get(list).post(create))
        .route("/school-permission-groups", get(list_school).post(create_school))
        .route("/permission-groups/{id}", patch(update).delete(remove))
        .route("/departments/{id}/permission-groups/{group_id}", put(attach).delete(detach))
        .route("/permission-config", get(export).post(import))
}

/// The branch's own permission groups and the school-wide ones it may attach
/// (branch admins).
#[utoipa::path(get, path = "/api/branches/{id}/permission-groups", operation_id = "listPermissionGroups", tag = "permission groups", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = Vec<PermissionGroup>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
) -> AppResult<Json<Vec<PermissionGroup>>> {
    Ok(Json(permission_groups::list(&s.db, &actor, id).await?))
}

#[utoipa::path(post, path = "/api/branches/{id}/permission-groups", operation_id = "createPermissionGroup", tag = "permission groups", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewPermissionGroup, responses((status = 201, body = PermissionGroup), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewPermissionGroup>,
) -> AppResult<(StatusCode, Json<PermissionGroup>)> {
    Ok((StatusCode::CREATED, Json(permission_groups::create(&s.db, &actor, Some(id), input).await?)))
}

/// School-wide permission groups, "Everyone" first (root users).
#[utoipa::path(get, path = "/api/school-permission-groups", operation_id = "listSchoolPermissionGroups", tag = "permission groups", responses((status = 200, body = Vec<PermissionGroup>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list_school(State(s): State<AppState>, actor: Actor) -> AppResult<Json<Vec<PermissionGroup>>> {
    Ok(Json(permission_groups::list_school(&s.db, &actor).await?))
}

#[utoipa::path(post, path = "/api/school-permission-groups", operation_id = "createSchoolPermissionGroup", tag = "permission groups", request_body = NewPermissionGroup, responses((status = 201, body = PermissionGroup), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create_school(
    State(s): State<AppState>,
    actor: Actor,
    ApiJson(input): ApiJson<NewPermissionGroup>,
) -> AppResult<(StatusCode, Json<PermissionGroup>)> {
    Ok((StatusCode::CREATED, Json(permission_groups::create(&s.db, &actor, None, input).await?)))
}

/// Rename, describe, or replace every grant of a permission group.
#[utoipa::path(patch, path = "/api/permission-groups/{id}", operation_id = "updatePermissionGroup", tag = "permission groups", params(("id" = uuid::Uuid, Path, description = "id")), request_body = PermissionGroupPatch, responses((status = 200, body = PermissionGroup), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<PermissionGroupPatch>,
) -> AppResult<Json<PermissionGroup>> {
    Ok(Json(permission_groups::update(&s.db, &actor, id, patch).await?))
}

#[utoipa::path(delete, path = "/api/permission-groups/{id}", operation_id = "deletePermissionGroup", tag = "permission groups", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<StatusCode> {
    permission_groups::delete(&s.db, &actor, id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Attach a permission group to a department: its members get its grants.
#[utoipa::path(put, path = "/api/departments/{id}/permission-groups/{group_id}", operation_id = "attachPermissionGroup", tag = "permission groups", params(("id" = uuid::Uuid, Path, description = "Department id"), ("group_id" = uuid::Uuid, Path, description = "Permission group id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn attach(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, group_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    permission_groups::set_attached(&s.db, &actor, id, group_id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/departments/{id}/permission-groups/{group_id}", operation_id = "detachPermissionGroup", tag = "permission groups", params(("id" = uuid::Uuid, Path, description = "Department id"), ("group_id" = uuid::Uuid, Path, description = "Permission group id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn detach(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, group_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    permission_groups::set_attached(&s.db, &actor, id, group_id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ConfigQuery {
    /// `yaml` (default) or `json`.
    format: Option<Format>,
    /// Import only: list the changes without saving them.
    #[serde(default)]
    dry_run: bool,
}

/// The permission setup as one document: permission groups with their
/// grants, and each branch's departments with their permission groups and
/// heads. Root users get everything; branch admins the school-wide groups
/// and their own branches.
#[utoipa::path(get, path = "/api/permission-config", operation_id = "exportPermissionConfig", tag = "permission groups", params(ConfigQuery), responses((status = 200, description = "The document, as YAML or JSON", content_type = "application/yaml", body = String), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn export(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<ConfigQuery>,
) -> AppResult<impl IntoResponse> {
    let format = q.format.unwrap_or(Format::Yaml);
    let config = permission_config::export(&s.db, &actor).await?;
    let body = permission_config::render(&config, format)?;
    let filename = match format {
        Format::Yaml => "permissions.yaml",
        Format::Json => "permissions.json",
    };
    Ok((
        [
            (header::CONTENT_TYPE, format!("{}; charset=utf-8", format.content_type())),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\"")),
        ],
        body,
    ))
}

/// Import an edited document (the request body, as YAML or JSON). Creates
/// and updates only; anything missing from the document is left as it is.
/// With `dry_run`, nothing is saved and the changes are listed.
#[utoipa::path(post, path = "/api/permission-config", operation_id = "importPermissionConfig", tag = "permission groups", params(ConfigQuery), request_body(content = String, content_type = "application/yaml"), responses((status = 200, body = ConfigImportOutcome), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn import(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<ConfigQuery>,
    body: Bytes,
) -> AppResult<Json<ConfigImportOutcome>> {
    let text = std::str::from_utf8(&body)
        .map_err(|_| AppError::validation("invalid_config", "the document must be UTF-8 text"))?;
    let config = permission_config::parse(text, q.format.unwrap_or(Format::Yaml))?;
    Ok(Json(permission_config::import(&s.db, &actor, config, q.dry_run).await?))
}
