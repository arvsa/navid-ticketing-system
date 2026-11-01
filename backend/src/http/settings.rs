use axum::{extract::State, routing::get, Json, Router};

use super::json::{ApiJson, ApiQuery};
use crate::{
    authz::Actor,
    domain::{
        analytics::{self, Analytics, AnalyticsQuery},
        settings::{self, Settings, SettingsPatch},
    },
    error::AppResult,
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/settings", get(show).patch(update)).route("/analytics", get(analytics))
}

/// GET /api/settings: no sign-in needed (the sign-in page shows the school's name).
#[utoipa::path(get, path = "/api/settings", operation_id = "getSettings", tag = "settings", security(()), responses((status = 200, body = Settings), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn show(State(s): State<AppState>) -> AppResult<Json<Settings>> {
    Ok(Json(settings::get(&s.db).await?))
}

/// PATCH /api/settings: super admins only.
#[utoipa::path(patch, path = "/api/settings", operation_id = "updateSettings", tag = "settings", request_body = SettingsPatch, responses((status = 200, body = Settings), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn update(
    State(s): State<AppState>,
    actor: Actor,
    ApiJson(patch): ApiJson<SettingsPatch>,
) -> AppResult<Json<Settings>> {
    Ok(Json(settings::update(&s.db, &actor, patch).await?))
}

/// GET /api/analytics?weeks=12: the whole school, for super admins.
#[utoipa::path(get, path = "/api/analytics", operation_id = "getAnalytics", tag = "settings", params(AnalyticsQuery), responses((status = 200, body = Analytics), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn analytics(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<AnalyticsQuery>,
) -> AppResult<Json<Analytics>> {
    Ok(Json(analytics::get(&s.db, &actor, &q).await?))
}
