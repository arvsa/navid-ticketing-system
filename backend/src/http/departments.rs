use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, patch, put},
    Json, Router,
};
use serde::Deserialize;
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::departments::{self, DeleteOutcome, Department, DepartmentPatch, DepartmentQuery, NewDepartment},
    error::AppResult,
    pagination::{Page, PageParams},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/branches/{id}/departments", get(list).post(create))
        .route("/departments/{id}", patch(update).delete(remove))
        .route("/departments/{id}/members/{user_id}", put(add_member).delete(remove_member))
        .route("/departments/{id}/heads/{user_id}", put(make_head).delete(remove_head))
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

/// The branch's departments, with their members, heads and permission groups.
#[utoipa::path(get, path = "/api/branches/{id}/departments", operation_id = "listDepartments", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id"), ListQuery), responses((status = 200, body = Page<Department>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiQuery(q): ApiQuery<ListQuery>,
) -> AppResult<Json<Page<Department>>> {
    Ok(Json(
        departments::list(
            &s.db,
            &actor,
            id,
            &DepartmentQuery { include_archived: q.include_archived },
            &PageParams { after: q.after, limit: q.limit },
        )
        .await?,
    ))
}

#[utoipa::path(post, path = "/api/branches/{id}/departments", operation_id = "createDepartment", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id")), request_body = NewDepartment, responses((status = 201, body = Department), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(input): ApiJson<NewDepartment>,
) -> AppResult<(StatusCode, Json<Department>)> {
    Ok((StatusCode::CREATED, Json(departments::create(&s.db, &actor, id, input).await?)))
}

#[utoipa::path(patch, path = "/api/departments/{id}", operation_id = "updateDepartment", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id")), request_body = DepartmentPatch, responses((status = 200, body = Department), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<DepartmentPatch>,
) -> AppResult<Json<Department>> {
    Ok(Json(departments::update(&s.db, &actor, id, patch).await?))
}

/// Deletes the department, or archives it if issues were sent to it.
#[utoipa::path(delete, path = "/api/departments/{id}", operation_id = "deleteDepartment", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = DeleteOutcome), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Json<DeleteOutcome>> {
    Ok(Json(departments::delete(&s.db, &actor, id).await?))
}

#[utoipa::path(put, path = "/api/departments/{id}/members/{user_id}", operation_id = "addDepartmentMember", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn add_member(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    departments::add_member(&s.db, &actor, id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(delete, path = "/api/departments/{id}/members/{user_id}", operation_id = "removeDepartmentMember", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove_member(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    departments::remove_member(&s.db, &actor, id, user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Make a department member one of its heads.
#[utoipa::path(put, path = "/api/departments/{id}/heads/{user_id}", operation_id = "makeDepartmentHead", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn make_head(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    departments::set_head(&s.db, &actor, id, user_id, true).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Stop someone being a head of a department (they stay a member).
#[utoipa::path(delete, path = "/api/departments/{id}/heads/{user_id}", operation_id = "removeDepartmentHead", tag = "departments", params(("id" = uuid::Uuid, Path, description = "id"), ("user_id" = uuid::Uuid, Path, description = "User id")), responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove_head(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath((id, user_id)): ApiPath<(Uuid, Uuid)>,
) -> AppResult<StatusCode> {
    departments::set_head(&s.db, &actor, id, user_id, false).await?;
    Ok(StatusCode::NO_CONTENT)
}
