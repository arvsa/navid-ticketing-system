//! Rust mirrors of the schema's enum types.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "issue_priority", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum Priority {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "issue_state", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum IssueState {
    Open,
    Closed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "completion_mode", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum CompletionMode {
    #[default]
    Shared,
    PerMember,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "target_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum TargetKind {
    Branch,
    Group,
    User,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "work_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WorkStatus {
    Open,
    InProgress,
    Blocked,
    PendingApproval,
    Approved,
    Cancelled,
}

impl WorkStatus {
    pub fn is_final(self) -> bool {
        matches!(self, Self::Approved | Self::Cancelled)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::InProgress => "in_progress",
            Self::Blocked => "blocked",
            Self::PendingApproval => "pending_approval",
            Self::Approved => "approved",
            Self::Cancelled => "cancelled",
        }
    }
}
