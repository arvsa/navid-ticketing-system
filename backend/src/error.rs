use std::borrow::Cow;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// The single error type returned by handlers. Every variant maps to an HTTP
/// status and a stable snake_case `code` in the body:
///
/// ```json
/// {"error": {"code": "not_found", "message": "not found"}}
/// ```
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// 401: no valid session.
    #[error("{message}")]
    Unauthorized { code: &'static str, message: Cow<'static, str> },

    /// 403: signed in and allowed to see the resource, but not to do this.
    #[error("{message}")]
    Forbidden { code: &'static str, message: Cow<'static, str> },

    /// 404: missing, or not readable by the actor (never reveal which).
    #[error("not found")]
    NotFound,

    /// 409: version conflicts and invariant violations.
    #[error("{message}")]
    Conflict { code: &'static str, message: Cow<'static, str> },

    /// 413: the body is larger than the route allows.
    #[error("{message}")]
    PayloadTooLarge { message: Cow<'static, str> },

    /// 422: invalid input.
    #[error("{message}")]
    Validation { code: &'static str, message: Cow<'static, str> },

    /// 500: logged in full, reported to the client without details.
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn unauthorized(code: &'static str, message: impl Into<Cow<'static, str>>) -> Self {
        Self::Unauthorized { code, message: message.into() }
    }

    pub fn forbidden(code: &'static str, message: impl Into<Cow<'static, str>>) -> Self {
        Self::Forbidden { code, message: message.into() }
    }

    pub fn conflict(code: &'static str, message: impl Into<Cow<'static, str>>) -> Self {
        Self::Conflict { code, message: message.into() }
    }

    pub fn validation(code: &'static str, message: impl Into<Cow<'static, str>>) -> Self {
        Self::Validation { code, message: message.into() }
    }

    pub fn internal(err: impl std::fmt::Display) -> Self {
        Self::Internal(err.to_string())
    }

    pub fn version_conflict() -> Self {
        Self::conflict("version_conflict", "this record was changed by someone else; reload and try again")
    }

    pub fn status(&self) -> StatusCode {
        match self {
            Self::Unauthorized { .. } => StatusCode::UNAUTHORIZED,
            Self::Forbidden { .. } => StatusCode::FORBIDDEN,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Conflict { .. } => StatusCode::CONFLICT,
            Self::PayloadTooLarge { .. } => StatusCode::PAYLOAD_TOO_LARGE,
            Self::Validation { .. } => StatusCode::UNPROCESSABLE_ENTITY,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Unauthorized { code, .. }
            | Self::Forbidden { code, .. }
            | Self::Conflict { code, .. }
            | Self::Validation { code, .. } => code,
            Self::NotFound => "not_found",
            Self::PayloadTooLarge { .. } => "payload_too_large",
            Self::Internal(_) => "internal_error",
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let message = match &self {
            Self::Internal(err) => {
                tracing::error!(error = %err, "internal error");
                "internal server error".to_owned()
            }
            other => other.to_string(),
        };
        let body = json!({ "error": { "code": self.code(), "message": message } });
        (self.status(), Json(body)).into_response()
    }
}

/// Postgres errors are translated into readable codes. Constraint and trigger
/// text never reaches the client.
impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        match &err {
            sqlx::Error::RowNotFound => return Self::NotFound,
            sqlx::Error::Database(db) => {
                let pg_code = db.code();
                let constraint = db.constraint().unwrap_or_default();
                if let Some(mapped) = map_constraint(constraint) {
                    return mapped;
                }
                match pg_code.as_deref() {
                    // unique_violation
                    Some("23505") => {
                        return Self::conflict("already_exists", "a record with these values already exists")
                    }
                    // foreign_key_violation
                    Some("23503") => {
                        return Self::validation("invalid_reference", "a referenced record does not exist")
                    }
                    // check_violation, not_null_violation
                    Some("23514") | Some("23502") => {
                        return Self::validation("invalid_value", "a value is not allowed")
                    }
                    // invalid_text_representation (bad enum/uuid literal)
                    Some("22P02") => return Self::validation("invalid_value", "a value has the wrong format"),
                    // raise_exception: messages from the schema's triggers
                    Some("P0001") => return map_trigger_message(db.message()),
                    _ => {}
                }
            }
            _ => {}
        }
        Self::internal(err)
    }
}

/// Named constraints from `0001_init.sql` that deserve a specific code.
fn map_constraint(constraint: &str) -> Option<AppError> {
    let err = match constraint {
        "app_user_email_key" => AppError::conflict("email_taken", "a user with this email already exists"),
        "branch_code_key" => AppError::conflict("branch_code_taken", "a branch with this code already exists"),
        "branch_name_key" => AppError::conflict("branch_name_taken", "a branch with this name already exists"),
        "branch_code_check" => {
            AppError::validation("invalid_branch_code", "branch code must be 2-10 uppercase letters or digits")
        }
        "user_group_name_uq" => {
            AppError::conflict("group_name_taken", "a group with this name already exists in the branch")
        }
        "group_permission_uq" => AppError::conflict("grant_exists", "this group already has this grant"),
        "issue_target_once" => AppError::conflict("target_exists", "the issue is already sent to this target"),
        "work_item_once_per_assignee" => {
            AppError::conflict("already_assigned", "this person already has work for this target")
        }
        "issue_title_check" | "issue_report_title_check" => {
            AppError::validation("invalid_title", "title must be between 1 and 200 characters")
        }
        "issue_event_range" => AppError::validation("invalid_event_range", "an event must end after it starts"),
        "branch_membership_admin_active" => {
            AppError::conflict("member_is_admin", "an admin can't leave the branch; demote them first")
        }
        _ => return None,
    };
    Some(err)
}

/// Exceptions raised by the schema's trigger functions, matched on their message text.
fn map_trigger_message(message: &str) -> AppError {
    let has = |needle: &str| message.contains(needle);
    if has("must have at least one active admin") || has("leaves a branch without an admin") {
        AppError::conflict("last_admin", "a branch must keep at least one active admin")
    } else if has("at least one active super admin is required") {
        AppError::conflict("last_super_admin", "at least one active super admin is required")
    } else if has("the default group cannot be deleted") || has("is_default cannot be changed") {
        AppError::conflict("default_group", "the All members group can't be deleted or changed")
    } else if has("has left branch") {
        AppError::conflict("not_a_member", "the user is not a current member of this branch")
    } else if has("is not allowed for") {
        AppError::validation("invalid_scope", "this scope is not allowed for the permission")
    } else if has("cannot be limited to an issue type") {
        AppError::validation("invalid_issue_type", "this permission can't be limited to an issue type")
    } else if has("target branch must match the issue branch") {
        AppError::validation("invalid_target", "targets must be in the issue's branch")
    } else if has("only super admin issues can target a whole branch") {
        AppError::validation("invalid_target", "only super admin issues can target a whole branch")
    } else {
        // Includes "is append-only": that is a bug in our code, not user error.
        AppError::internal(format!("unmapped trigger exception: {message}"))
    }
}

pub type AppResult<T> = Result<T, AppError>;
