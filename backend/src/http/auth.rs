use axum::{
    extract::State,
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::json::ApiJson;
use crate::{
    auth::{
        login,
        password::Password,
        session::{self, ClientMeta},
        Authenticated,
    },
    authz::{Actor, Grant},
    error::AppResult,
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/login", post(login_handler))
        .route("/auth/logout", post(logout))
        .route("/me", get(me))
        .route("/me/password", post(change_password))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
struct LoginRequest {
    email: String,
    password: Password,
}

/// POST /api/auth/login
#[utoipa::path(post, path = "/api/auth/login", operation_id = "login", tag = "auth", security(()), request_body = LoginRequest, responses((status = 200, body = MeResponse, description = "Signed in; sets the `sid` cookie"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn login_handler(
    State(state): State<AppState>,
    meta: ClientMeta,
    ApiJson(req): ApiJson<LoginRequest>,
) -> AppResult<Response> {
    let outcome = login::login(&state.db, &req.email, req.password, &meta).await?;
    let actor = Actor::load(&state.db, outcome.user_id, outcome.is_super_admin).await?;
    let body = me_response(&state.db, &actor).await?;
    let cookie = session::cookie(&outcome.token, state.config.cookie_secure);
    Ok(([(header::SET_COOKIE, cookie)], Json(body)).into_response())
}

/// POST /api/auth/logout
#[utoipa::path(post, path = "/api/auth/logout", operation_id = "logout", tag = "auth", responses((status = 204, description = "Signed out"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn logout(State(state): State<AppState>, auth: Authenticated) -> AppResult<Response> {
    session::revoke(&state.db, auth.session_id).await?;
    let cookie = session::clear_cookie(state.config.cookie_secure);
    Ok((StatusCode::NO_CONTENT, [(header::SET_COOKIE, cookie)]).into_response())
}

/// GET /api/me: available while a password change is pending.
#[utoipa::path(get, path = "/api/me", operation_id = "getMe", tag = "auth", responses((status = 200, body = MeResponse), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn me(State(state): State<AppState>, auth: Authenticated) -> AppResult<Json<MeResponse>> {
    Ok(Json(me_response(&state.db, &auth.actor).await?))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
struct ChangePasswordRequest {
    current_password: Password,
    new_password: Password,
}

/// POST /api/me/password
#[utoipa::path(post, path = "/api/me/password", operation_id = "changePassword", tag = "auth", request_body = ChangePasswordRequest, responses((status = 204), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn change_password(
    State(state): State<AppState>,
    auth: Authenticated,
    ApiJson(req): ApiJson<ChangePasswordRequest>,
) -> AppResult<StatusCode> {
    login::change_password(&state.db, auth.actor.user_id, auth.session_id, req.current_password, req.new_password)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MeResponse {
    pub user: UserProfile,
    pub memberships: Vec<MembershipView>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct UserProfile {
    pub id: Uuid,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub is_super_admin: bool,
    pub must_change_password: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_login_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct MembershipView {
    pub branch: BranchRef,
    pub is_admin: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
    /// Effective grants in this branch (union over the user's groups).
    /// Branch admins can do everything except super admin actions regardless.
    pub grants: Vec<Grant>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct BranchRef {
    pub id: Uuid,
    pub code: String,
    pub name: String,
}

async fn me_response(db: &PgPool, actor: &Actor) -> AppResult<MeResponse> {
    let user = sqlx::query_as!(
        UserProfile,
        r#"
        SELECT id, email::text AS "email!", first_name, last_name, is_super_admin, must_change_password, last_login_at
        FROM app_user WHERE id = $1
        "#,
        actor.user_id
    )
    .fetch_one(db)
    .await?;

    let rows = sqlx::query!(
        r#"
        SELECT b.id, b.code, b.name, m.joined_at
        FROM branch_membership m
        JOIN branch b ON b.id = m.branch_id
        WHERE m.user_id = $1 AND m.left_at IS NULL
        ORDER BY b.name
        "#,
        actor.user_id
    )
    .fetch_all(db)
    .await?;

    // Grants and the admin flag come from the Actor so /me shows exactly what
    // authorization will use.
    let memberships = rows
        .into_iter()
        .filter_map(|r| {
            let access = actor.branch(r.id)?;
            Some(MembershipView {
                branch: BranchRef { id: r.id, code: r.code, name: r.name },
                is_admin: access.is_admin,
                joined_at: r.joined_at,
                grants: access.grants.clone(),
            })
        })
        .collect();

    Ok(MeResponse { user, memberships })
}
