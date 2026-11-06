use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, put},
    Json, Router,
};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::json::ApiPath;
use crate::{
    authz::Actor,
    domain::profile::{self, AvatarRef, Image, PublicProfile, AVATAR_MAX_BYTES, COVER_MAX_BYTES},
    error::{AppError, AppResult},
    AppState,
};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/users/{id}/profile", get(public))
        .route("/users/{id}/cover", get(cover))
        .route("/users/{id}/avatar", get(avatar))
        .route("/avatars", get(avatars))
}

/// Cover uploads, with the upload body limit and timeout.
pub fn upload_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/me/cover",
            put(set_cover).delete(remove_cover).layer(DefaultBodyLimit::max(COVER_MAX_BYTES + 64 * 1024)),
        )
        .route(
            "/me/avatar",
            put(set_avatar).delete(remove_avatar).layer(DefaultBodyLimit::max(AVATAR_MAX_BYTES + 64 * 1024)),
        )
}

/// PUT /api/me/cover, `multipart/form-data` with a `file` part.
#[utoipa::path(put, path = "/api/me/cover", operation_id = "setMyCover", tag = "auth", request_body(content_type = "multipart/form-data", description = "A `file` part: JPEG, PNG or WebP, max 5 MB"), responses((status = 204, description = "Saved"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn set_cover(
    State(s): State<AppState>,
    actor: Actor,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> AppResult<StatusCode> {
    upload(&s, &actor, Image::Cover, multipart).await
}

/// PUT /api/me/avatar, `multipart/form-data` with a `file` part.
#[utoipa::path(put, path = "/api/me/avatar", operation_id = "setMyAvatar", tag = "auth", request_body(content_type = "multipart/form-data", description = "A `file` part: JPEG, PNG or WebP, max 2 MB"), responses((status = 204, description = "Saved"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn set_avatar(
    State(s): State<AppState>,
    actor: Actor,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> AppResult<StatusCode> {
    upload(&s, &actor, Image::Avatar, multipart).await
}

async fn upload(
    s: &AppState,
    actor: &Actor,
    image: Image,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> AppResult<StatusCode> {
    let mut multipart = multipart.map_err(|e| AppError::validation("invalid_upload", e.body_text()))?;
    let limit = image.max_bytes() / (1024 * 1024);
    let too_big = |e: axum::extract::multipart::MultipartError| {
        if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
            AppError::PayloadTooLarge { message: format!("images are limited to {limit} MB").into() }
        } else {
            AppError::validation("invalid_upload", e.body_text())
        }
    };
    let mut data = None;
    while let Some(field) = multipart.next_field().await.map_err(too_big)? {
        if field.name() == Some("file") {
            data = Some(field.bytes().await.map_err(too_big)?);
        }
    }
    let data = data.ok_or_else(|| AppError::validation("invalid_upload", "a `file` part is required"))?;
    profile::set_image(&s.db, s.storage.as_ref(), actor, image, data).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/me/cover
#[utoipa::path(delete, path = "/api/me/cover", operation_id = "removeMyCover", tag = "auth", responses((status = 204, description = "Removed"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove_cover(State(s): State<AppState>, actor: Actor) -> AppResult<StatusCode> {
    profile::remove_image(&s.db, s.storage.as_ref(), &actor, Image::Cover).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// DELETE /api/me/avatar
#[utoipa::path(delete, path = "/api/me/avatar", operation_id = "removeMyAvatar", tag = "auth", responses((status = 204, description = "Removed"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn remove_avatar(State(s): State<AppState>, actor: Actor) -> AppResult<StatusCode> {
    profile::remove_image(&s.db, s.storage.as_ref(), &actor, Image::Avatar).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// GET /api/avatars: everyone with a profile picture and its version.
#[utoipa::path(get, path = "/api/avatars", operation_id = "listAvatars", tag = "members", responses((status = 200, body = Vec<AvatarRef>), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn avatars(State(s): State<AppState>, actor: Actor) -> AppResult<Json<Vec<AvatarRef>>> {
    Ok(Json(profile::avatars(&s.db, &actor).await?))
}

/// GET /api/users/{id}/profile: bio, cover and picture, for everyone signed in.
#[utoipa::path(get, path = "/api/users/{id}/profile", operation_id = "getUserProfile", tag = "members", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, body = PublicProfile), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn public(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Json<PublicProfile>> {
    Ok(Json(profile::public(&s.db, &actor, id).await?))
}

/// GET /api/users/{id}/cover: the image. Its URL changes with every upload
/// (`?v=<cover_version>`), so it's cached for good.
#[utoipa::path(get, path = "/api/users/{id}/cover", operation_id = "getUserCover", tag = "members", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, description = "The image", content_type = "image/*"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn cover(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Response> {
    image_response(profile::image(&s.db, s.storage.as_ref(), &actor, id, Image::Cover).await?)
}

/// GET /api/users/{id}/avatar: the profile picture, cached for good like the cover.
#[utoipa::path(get, path = "/api/users/{id}/avatar", operation_id = "getUserAvatar", tag = "members", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, description = "The image", content_type = "image/*"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn avatar(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Response> {
    image_response(profile::image(&s.db, s.storage.as_ref(), &actor, id, Image::Avatar).await?)
}

fn image_response(file: profile::ImageFile) -> AppResult<Response> {
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(file.content_type)),
            (header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")),
            (header::CACHE_CONTROL, HeaderValue::from_static("private, max-age=31536000, immutable")),
        ],
        Body::from_stream(ReaderStream::new(file.reader)),
    )
        .into_response())
}
