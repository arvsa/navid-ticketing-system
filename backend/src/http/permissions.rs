use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::{authz::Actor, error::AppResult, AppState};

pub fn routes() -> Router<AppState> {
    Router::new().route("/permissions", get(catalog))
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
struct CatalogEntry {
    key: String,
    description: String,
    per_issue_type: bool,
    allowed_scopes: Vec<String>,
}

/// GET /api/permissions: the grantable permission catalog, for the admin UI.
/// Any signed-in user may read it; it describes rules, not data.
#[utoipa::path(get, path = "/api/permissions", operation_id = "listPermissions", tag = "groups", responses((status = 200, body = Vec<CatalogEntry>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn catalog(State(state): State<AppState>, _actor: Actor) -> AppResult<Json<Vec<CatalogEntry>>> {
    let rows = sqlx::query_as!(
        CatalogEntry,
        r#"
        SELECT key, description, per_issue_type, allowed_scopes::text[] AS "allowed_scopes!"
        FROM permission ORDER BY key
        "#
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}
