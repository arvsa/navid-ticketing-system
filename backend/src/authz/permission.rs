use std::collections::{BTreeMap, BTreeSet};

use serde::{Serialize, Serializer};
use sqlx::PgPool;

/// Scope of a grant (`permission_scope` in the schema).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "permission_scope", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum Scope {
    Own,
    Targeted,
    Branch,
}

impl Scope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Own => "own",
            Self::Targeted => "targeted",
            Self::Branch => "branch",
        }
    }
}

/// The four issue types (`issue_type.code`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IssueType {
    Ticket,
    Report,
    Event,
    Action,
}

impl IssueType {
    pub fn code(self) -> &'static str {
        match self {
            Self::Ticket => "ticket",
            Self::Report => "report",
            Self::Event => "event",
            Self::Action => "action",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Some(match code {
            "ticket" => Self::Ticket,
            "report" => Self::Report,
            "event" => Self::Event,
            "action" => Self::Action,
            _ => return None,
        })
    }
}

/// The grantable permissions. Variants map 1:1 to rows of the `permission`
/// table; [`verify_catalog`] checks this at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Permission {
    IssueRead,
    IssueReadPrivate,
    IssueCreate,
    IssueEdit,
    IssueClose,
    IssueSetPrivate,
    IssueTarget,
    WorkItemUpdate,
    WorkItemAssign,
    WorkItemApprove,
    CommentCreate,
    CommentInternal,
    CommentModerate,
    MemberView,
    MemberManage,
    DashboardBranch,
    ExportRun,
}

impl Permission {
    pub const ALL: [Permission; 17] = [
        Self::IssueRead,
        Self::IssueReadPrivate,
        Self::IssueCreate,
        Self::IssueEdit,
        Self::IssueClose,
        Self::IssueSetPrivate,
        Self::IssueTarget,
        Self::WorkItemUpdate,
        Self::WorkItemAssign,
        Self::WorkItemApprove,
        Self::CommentCreate,
        Self::CommentInternal,
        Self::CommentModerate,
        Self::MemberView,
        Self::MemberManage,
        Self::DashboardBranch,
        Self::ExportRun,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Self::IssueRead => "issue.read",
            Self::IssueReadPrivate => "issue.read_private",
            Self::IssueCreate => "issue.create",
            Self::IssueEdit => "issue.edit",
            Self::IssueClose => "issue.close",
            Self::IssueSetPrivate => "issue.set_private",
            Self::IssueTarget => "issue.target",
            Self::WorkItemUpdate => "work_item.update",
            Self::WorkItemAssign => "work_item.assign",
            Self::WorkItemApprove => "work_item.approve",
            Self::CommentCreate => "comment.create",
            Self::CommentInternal => "comment.internal",
            Self::CommentModerate => "comment.moderate",
            Self::MemberView => "member.view",
            Self::MemberManage => "member.manage",
            Self::DashboardBranch => "dashboard.branch",
            Self::ExportRun => "export.run",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.key() == key)
    }

    /// May a grant of this permission be limited to one issue type?
    pub fn per_issue_type(self) -> bool {
        use Permission::*;
        matches!(
            self,
            IssueRead
                | IssueReadPrivate
                | IssueCreate
                | IssueEdit
                | IssueClose
                | IssueSetPrivate
                | IssueTarget
                | WorkItemUpdate
                | WorkItemAssign
                | WorkItemApprove
        )
    }

    pub fn allowed_scopes(self) -> &'static [Scope] {
        use Permission::*;
        use Scope::*;
        match self {
            IssueRead => &[Own, Targeted, Branch],
            IssueEdit | IssueClose | IssueSetPrivate | IssueTarget => &[Own, Branch],
            WorkItemUpdate | WorkItemAssign | CommentCreate => &[Targeted, Branch],
            IssueReadPrivate | IssueCreate | WorkItemApprove | CommentInternal | CommentModerate | MemberView
            | MemberManage | DashboardBranch | ExportRun => &[Branch],
        }
    }
}

impl Serialize for Permission {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.key())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("permission catalog mismatch: {0}")]
    Mismatch(String),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

/// Fails if the `permission` table and [`Permission`] disagree on keys,
/// `per_issue_type` or `allowed_scopes`. Run at startup.
pub async fn verify_catalog(db: &PgPool) -> Result<(), CatalogError> {
    let rows =
        sqlx::query!(r#"SELECT key, per_issue_type, allowed_scopes::text[] AS "allowed_scopes!" FROM permission"#)
            .fetch_all(db)
            .await?;

    let table: BTreeMap<String, (bool, BTreeSet<String>)> =
        rows.into_iter().map(|r| (r.key, (r.per_issue_type, r.allowed_scopes.into_iter().collect()))).collect();
    let code: BTreeMap<String, (bool, BTreeSet<String>)> = Permission::ALL
        .into_iter()
        .map(|p| {
            let scopes = p.allowed_scopes().iter().map(|s| s.as_str().to_owned()).collect();
            (p.key().to_owned(), (p.per_issue_type(), scopes))
        })
        .collect();

    let mut problems = Vec::new();
    for key in table.keys().filter(|k| !code.contains_key(*k)) {
        problems.push(format!("{key} is in the table but not in the enum"));
    }
    for (key, expected) in &code {
        match table.get(key) {
            None => problems.push(format!("{key} is in the enum but not in the table")),
            Some(actual) if actual != expected => {
                problems.push(format!("{key}: table has {actual:?}, enum has {expected:?}"))
            }
            Some(_) => {}
        }
    }
    if problems.is_empty() {
        Ok(())
    } else {
        Err(CatalogError::Mismatch(problems.join("; ")))
    }
}

/// In the OpenAPI document: a string, one of the catalog keys.
impl utoipa::PartialSchema for Permission {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::Type::String)
            .enum_values(Some(Permission::ALL.iter().map(|p| p.key())))
            .into()
    }
}

impl utoipa::ToSchema for Permission {}
