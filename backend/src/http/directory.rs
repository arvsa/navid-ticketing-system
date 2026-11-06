use axum::{extract::State, routing::get, Json, Router};

use crate::{
    authz::Actor,
    domain::directory::{self, DirectoryBranch},
    error::AppResult,
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new().route("/directory", get(list))
}

/// GET /api/directory: every active branch with its departments and people,
/// for everyone signed in.
#[utoipa::path(get, path = "/api/directory", operation_id = "getDirectory", tag = "members", responses((status = 200, body = Vec<DirectoryBranch>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn list(State(s): State<AppState>, actor: Actor) -> AppResult<Json<Vec<DirectoryBranch>>> {
    Ok(Json(directory::list(&s.db, &actor).await?))
}
