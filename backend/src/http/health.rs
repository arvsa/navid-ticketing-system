use axum::{extract::State, routing::get, Json, Router};
use serde_json::{json, Value};

use crate::{error::AppResult, AppState};

pub fn routes() -> Router<AppState> {
    Router::new().route("/healthz", get(healthz))
}

/// GET /api/healthz: no auth. Fails with 500 if the database is unreachable.
#[utoipa::path(get, path = "/api/healthz", operation_id = "healthCheck", tag = "health", security(()), responses((status = 200, description = "The database is reachable"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn healthz(State(state): State<AppState>) -> AppResult<Json<Value>> {
    sqlx::query_scalar!(r#"SELECT 1 AS "one!""#).fetch_one(&state.db).await?;
    Ok(Json(json!({ "status": "ok" })))
}
