use axum::extract::{
    rejection::{JsonRejection, PathRejection, QueryRejection},
    FromRequest, FromRequestParts,
};

use crate::error::AppError;

/// `axum::Json`, but malformed bodies come back in the standard error shape
/// (`422 invalid_body`) instead of axum's plain-text rejection.
#[derive(FromRequest)]
#[from_request(via(axum::Json), rejection(AppError))]
pub struct ApiJson<T>(pub T);

/// `axum::extract::Path`; a malformed id is `404 not_found`.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Path), rejection(AppError))]
pub struct ApiPath<T>(pub T);

/// `axum::extract::Query`; bad parameters are `422 invalid_query`.
#[derive(FromRequestParts)]
#[from_request(via(axum::extract::Query), rejection(AppError))]
pub struct ApiQuery<T>(pub T);

impl From<JsonRejection> for AppError {
    fn from(rejection: JsonRejection) -> Self {
        if rejection.status() == axum::http::StatusCode::PAYLOAD_TOO_LARGE {
            return AppError::PayloadTooLarge { message: "the request body is too large".into() };
        }
        AppError::validation("invalid_body", rejection.body_text())
    }
}

impl From<PathRejection> for AppError {
    fn from(_: PathRejection) -> Self {
        AppError::NotFound
    }
}

impl From<QueryRejection> for AppError {
    fn from(rejection: QueryRejection) -> Self {
        AppError::validation("invalid_query", rejection.body_text())
    }
}
