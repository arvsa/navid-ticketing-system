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

/// The three issue types (`issue_type.code`). Reports are actions made
/// from the Report template.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum IssueType {
    Ticket,
    Event,
    Action,
}

impl IssueType {
    pub fn code(self) -> &'static str {
        match self {
            Self::Ticket => "ticket",
            Self::Event => "event",
            Self::Action => "action",
        }
    }

    pub fn from_code(code: &str) -> Option<Self> {
        Some(match code {
            "ticket" => Self::Ticket,
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
    /// Other people's issues: editing your own is the baseline.
    IssueEdit,
    /// Other people's issues: closing your own is the baseline.
    IssueClose,
    WorkItemUpdate,
    WorkItemAssign,
    WorkItemApprove,
    CommentCreate,
    /// Deprecated: staff-only comments will be removed in the future.
    CommentInternal,
    CommentModerate,
    MemberView,
    MemberManage,
    DashboardBranch,
    ExportRun,
    /// Create, rename and archive departments, choose their heads.
    DepartmentManage,
    /// Add people to departments and remove them; granted per department.
    DepartmentMembersManage,
}

impl Permission {
    pub const ALL: [Permission; 15] = [
        Self::IssueRead,
        Self::IssueEdit,
        Self::IssueClose,
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
        Self::DepartmentManage,
        Self::DepartmentMembersManage,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Self::IssueRead => "issue.read",
            Self::IssueEdit => "issue.edit",
            Self::IssueClose => "issue.close",
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
            Self::DepartmentManage => "department.manage",
            Self::DepartmentMembersManage => "department.members.manage",
        }
    }

    pub fn from_key(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.key() == key)
    }

    /// May a grant of this permission be limited to one issue type?
    pub fn per_issue_type(self) -> bool {
        use Permission::*;
        matches!(self, IssueRead | IssueEdit | IssueClose | WorkItemUpdate | WorkItemAssign | WorkItemApprove)
    }

    /// Is a grant of this permission for named departments?
    pub fn per_department(self) -> bool {
        self == Permission::DepartmentMembersManage
    }

    /// Every grant is branch-wide: your own issues and what's sent to you
    /// are the baseline, which needs no grant.
    pub fn allowed_scopes(self) -> &'static [Scope] {
        &[Scope::Branch]
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
/// `per_issue_type`, `per_department` or `allowed_scopes`. Run at startup.
pub async fn verify_catalog(db: &PgPool) -> Result<(), CatalogError> {
    let rows = sqlx::query!(
        r#"SELECT key, per_issue_type, per_department, allowed_scopes::text[] AS "allowed_scopes!" FROM permission"#
    )
    .fetch_all(db)
    .await?;

    type Shape = (bool, bool, BTreeSet<String>);
    let table: BTreeMap<String, Shape> = rows
        .into_iter()
        .map(|r| (r.key, (r.per_issue_type, r.per_department, r.allowed_scopes.into_iter().collect())))
        .collect();
    let code: BTreeMap<String, Shape> = Permission::ALL
        .into_iter()
        .map(|p| {
            let scopes = p.allowed_scopes().iter().map(|s| s.as_str().to_owned()).collect();
            (p.key().to_owned(), (p.per_issue_type(), p.per_department(), scopes))
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
