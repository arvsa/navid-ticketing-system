use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, patch},
    Json, Router,
};
use uuid::Uuid;

use super::json::{ApiJson, ApiPath, ApiQuery};
use crate::{
    authz::Actor,
    domain::templates::{self, NewTemplate, Template, TemplatePatch, TemplateQuery},
    error::AppResult,
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/templates", get(list).post(create)).route("/templates/{id}", patch(update))
}

/// GET /api/templates: everyone signed in; archived ones for super admins.
#[utoipa::path(get, path = "/api/templates", operation_id = "listTemplates", tag = "templates", params(TemplateQuery), responses((status = 200, body = Vec<Template>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<TemplateQuery>,
) -> AppResult<Json<Vec<Template>>> {
    Ok(Json(templates::list(&s.db, &actor, &q).await?))
}

/// POST /api/templates: super admins only.
#[utoipa::path(post, path = "/api/templates", operation_id = "createTemplate", tag = "templates", request_body = NewTemplate, responses((status = 201, body = Template), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn create(
    State(s): State<AppState>,
    actor: Actor,
    ApiJson(input): ApiJson<NewTemplate>,
) -> AppResult<(StatusCode, Json<Template>)> {
    Ok((StatusCode::CREATED, Json(templates::create(&s.db, &actor, input).await?)))
}

/// PATCH /api/templates/{id}: super admins only; also archives and restores.
#[utoipa::path(patch, path = "/api/templates/{id}", operation_id = "updateTemplate", tag = "templates", params(("id" = uuid::Uuid, Path, description = "id")), request_body = TemplatePatch, responses((status = 200, body = Template), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(id): ApiPath<Uuid>,
    ApiJson(patch): ApiJson<TemplatePatch>,
) -> AppResult<Json<Template>> {
    Ok(Json(templates::update(&s.db, &actor, id, patch).await?))
}
