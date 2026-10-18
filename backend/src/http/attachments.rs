use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Multipart, State},
    http::{header, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use super::json::ApiPath;
use crate::{
    authz::Actor,
    domain::attachments::{self, AttachmentMeta, Upload, MAX_BYTES},
    error::{AppError, AppResult},
    AppState,
};

/// Room for one 25 MB file plus the multipart framing and form fields.
const UPLOAD_BODY_LIMIT: usize = MAX_BYTES + 1024 * 1024;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/issues/{id}/attachments", post(upload).layer(DefaultBodyLimit::max(UPLOAD_BODY_LIMIT)))
        .route("/attachments/{id}", get(download))
}

fn upload_error(err: axum::extract::multipart::MultipartError) -> AppError {
    if err.status() == StatusCode::PAYLOAD_TOO_LARGE {
        AppError::PayloadTooLarge { message: "files are limited to 25 MB".into() }
    } else {
        AppError::validation("invalid_upload", err.body_text())
    }
}

/// POST /api/issues/{id}/attachments, `multipart/form-data` with a `file`
/// part and optional `comment_id` or `report_id` fields.
#[utoipa::path(post, path = "/api/issues/{id}/attachments", operation_id = "uploadAttachment", tag = "attachments", params(("id" = uuid::Uuid, Path, description = "id")), request_body(content_type = "multipart/form-data", description = "A `file` part (max 25 MB) and optional `comment_id` or `report_id` fields"), responses((status = 201, body = AttachmentMeta), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn upload(
    State(s): State<AppState>,
    actor: Actor,
    ApiPath(issue_id): ApiPath<Uuid>,
    multipart: Result<Multipart, axum::extract::multipart::MultipartRejection>,
) -> AppResult<(StatusCode, Json<AttachmentMeta>)> {
    let mut multipart = multipart.map_err(|e| AppError::validation("invalid_upload", e.body_text()))?;
    let mut file = None;
    let (mut comment_id, mut report_id) = (None, None);
    while let Some(field) = multipart.next_field().await.map_err(upload_error)? {
        let parse_id = |text: String| {
            text.trim().parse::<Uuid>().map_err(|_| AppError::validation("invalid_upload", "ids must be UUIDs"))
        };
        match field.name() {
            Some("file") => {
                let file_name = field.file_name().unwrap_or("file").to_owned();
                let content_type = field.content_type().unwrap_or("application/octet-stream").to_owned();
                let data = field.bytes().await.map_err(upload_error)?;
                file = Some((file_name, content_type, data));
            }
            Some("comment_id") => comment_id = Some(parse_id(field.text().await.map_err(upload_error)?)?),
            Some("report_id") => report_id = Some(parse_id(field.text().await.map_err(upload_error)?)?),
            _ => {}
        }
    }
    let (file_name, content_type, data) =
        file.ok_or_else(|| AppError::validation("invalid_upload", "a `file` part is required"))?;
    let meta = attachments::upload(
        &s.db,
        s.storage.as_ref(),
        &actor,
        issue_id,
        Upload { file_name, content_type, data, comment_id, report_id },
    )
    .await?;
    Ok((StatusCode::CREATED, Json(meta)))
}

/// GET /api/attachments/{id}: streams the file after the authorization check.
#[utoipa::path(get, path = "/api/attachments/{id}", operation_id = "downloadAttachment", tag = "attachments", params(("id" = uuid::Uuid, Path, description = "id")), responses((status = 200, description = "The file, as a download", content_type = "application/octet-stream"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn download(State(s): State<AppState>, actor: Actor, ApiPath(id): ApiPath<Uuid>) -> AppResult<Response> {
    let file = attachments::download(&s.db, s.storage.as_ref(), &actor, id).await?;
    let meta = &file.meta;
    let content_type = HeaderValue::from_str(&meta.content_type).map_err(AppError::internal)?;
    let disposition = HeaderValue::from_str(&content_disposition(&meta.file_name)).map_err(AppError::internal)?;
    let body = Body::from_stream(ReaderStream::new(file.reader));
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CONTENT_LENGTH, HeaderValue::from(meta.file_size_bytes)),
            (header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")),
            (header::CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
        ],
        body,
    )
        .into_response())
}

/// Always a download, never rendered inline. ASCII fallback plus the
/// RFC 5987 UTF-8 form for non-ASCII names.
fn content_disposition(name: &str) -> String {
    let ascii: String = name.chars().map(|c| if c.is_ascii() && c != '\\' { c } else { '_' }).collect();
    let encoded: String = name
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'.' | b'-' | b'_' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect();
    format!("attachment; filename=\"{ascii}\"; filename*=UTF-8''{encoded}")
}
