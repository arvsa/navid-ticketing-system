//! Written reports (BACKEND_PLAN.md 7.4): drafted, then submitted. A report
//! linked to a work item is what lets that item be submitted for approval
//! (the gate lives in `work_items`). Authors may edit until the work item is
//! approved; a self-filed report until its issue closes.
//!
//! Drafts are visible to their author only; submitted reports to everyone
//! who can read the issue.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    attachments::{self, AttachmentMeta},
    issues,
    types::{IssueState, WorkStatus},
};
use crate::{
    authz::{Actor, IssueType},
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

pub const MAX_BODY_CHARS: usize = 100_000;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Report {
    pub id: Uuid,
    pub issue_id: Uuid,
    /// `null` for a self-filed report.
    pub work_item_id: Option<Uuid>,
    pub author_id: Uuid,
    pub title: String,
    pub body: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub submitted_at: Option<OffsetDateTime>,
    pub version: i32,
    pub attachments: Vec<AttachmentMeta>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

struct Row {
    id: Uuid,
    issue_id: Uuid,
    work_item_id: Option<Uuid>,
    author_id: Uuid,
    title: String,
    body: String,
    submitted_at: Option<OffsetDateTime>,
    version: i32,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

fn with_files(rows: Vec<Row>, mut files: HashMap<Uuid, Vec<AttachmentMeta>>) -> Vec<Report> {
    rows.into_iter()
        .map(|r| Report {
            attachments: files.remove(&r.id).unwrap_or_default(),
            id: r.id,
            issue_id: r.issue_id,
            work_item_id: r.work_item_id,
            author_id: r.author_id,
            title: r.title,
            body: r.body,
            submitted_at: r.submitted_at,
            version: r.version,
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect()
}

#[derive(Debug, Serialize, Deserialize)]
struct Cursor {
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    id: Uuid,
}

pub async fn list(db: &PgPool, actor: &Actor, issue_id: Uuid, page: &PageParams) -> AppResult<Page<Report>> {
    issues::readable(db, actor, issue_id).await?;
    let limit = page.limit()?;
    let after: Option<Cursor> = page.cursor()?;
    let rows = sqlx::query_as!(
        Row,
        r#"
        SELECT id, issue_id, work_item_id, author_id, title, body, submitted_at, version, created_at, updated_at
        FROM issue_report
        WHERE issue_id = $1 AND (submitted_at IS NOT NULL OR author_id = $2)
          AND ($3::timestamptz IS NULL OR (created_at, id) > ($3, $4))
        ORDER BY created_at, id
        LIMIT $5
        "#,
        issue_id,
        actor.user_id,
        after.as_ref().map(|c| c.created_at),
        after.as_ref().map(|c| c.id),
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    let ids: Vec<Uuid> = rows.iter().map(|r| r.id).collect();
    let files = attachments::for_reports(db, &ids).await?;
    let reports = with_files(rows, files);
    Ok(Page::from_rows(reports, limit, |r| Cursor { created_at: r.created_at, id: r.id }))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewReport {
    pub title: String,
    pub body: String,
    /// The work item this report is for; omit for a self-filed report.
    pub work_item_id: Option<Uuid>,
}

pub async fn create(db: &PgPool, actor: &Actor, issue_id: Uuid, input: NewReport) -> AppResult<Report> {
    let issue = issues::readable(db, actor, issue_id).await?;
    if issue.issue_type != IssueType::Report {
        return Err(AppError::validation("not_a_report", "reports can only be written on report issues"));
    }
    let (title, body) = (validate_title(&input.title)?, validate_body(&input.body)?);

    let mut tx = db.begin().await?;
    let state =
        sqlx::query_scalar!(r#"SELECT state AS "state: IssueState" FROM issue WHERE id = $1 FOR UPDATE"#, issue_id)
            .fetch_one(&mut *tx)
            .await?;
    if state != IssueState::Open {
        return Err(AppError::conflict("issue_not_open", "the issue is closed or cancelled"));
    }
    match input.work_item_id {
        Some(item_id) => {
            let item = sqlx::query!(
                r#"SELECT assignee_id, status AS "status: WorkStatus" FROM work_item WHERE id = $1 AND issue_id = $2"#,
                item_id,
                issue_id
            )
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(|| AppError::validation("invalid_work_item", "the work item is not part of this issue"))?;
            if item.assignee_id != Some(actor.user_id) {
                return Err(AppError::forbidden("forbidden", "only the assignee writes the report for this work"));
            }
            if item.status.is_final() {
                return Err(AppError::conflict("report_locked", "the work is already approved or cancelled"));
            }
        }
        None if issue.created_by != actor.user_id => {
            return Err(AppError::forbidden("forbidden", "only the issue's creator files a report for themselves"));
        }
        None => {}
    }
    // One report per work item, and one self-filed report per author.
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM issue_report
                          WHERE issue_id = $1 AND work_item_id IS NOT DISTINCT FROM $2
                            AND ($2::uuid IS NOT NULL OR author_id = $3)) AS "e!""#,
        issue_id,
        input.work_item_id,
        actor.user_id
    )
    .fetch_one(&mut *tx)
    .await?;
    if exists {
        return Err(AppError::conflict("report_exists", "there is already a report for this; edit it instead"));
    }

    let id = sqlx::query_scalar!(
        "INSERT INTO issue_report (issue_id, work_item_id, author_id, title, body) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        issue_id,
        input.work_item_id,
        actor.user_id,
        title,
        body
    )
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    fetch(db, id).await
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct ReportPatch {
    pub version: i32,
    pub title: Option<String>,
    pub body: Option<String>,
}

pub async fn update(db: &PgPool, actor: &Actor, id: Uuid, patch: ReportPatch) -> AppResult<Report> {
    let title = patch.title.as_deref().map(validate_title).transpose()?;
    let body = patch.body.as_deref().map(validate_body).transpose()?;
    let mut tx = db.begin().await?;
    let issue_id = lock_editable(db, &mut tx, actor, id, patch.version).await?;
    sqlx::query!(
        r#"UPDATE issue_report SET title = coalesce($2, title), body = coalesce($3, body), version = version + 1
           WHERE id = $1"#,
        id,
        title,
        body
    )
    .execute(&mut *tx)
    .await?;
    issues::emit(&mut tx, "report_updated", issue_id).await?;
    tx.commit().await?;
    fetch(db, id).await
}

/// POST /reports/{id}/submit: marks the report submitted (again, after
/// edits). Submitting the work item for approval is a separate step.
pub async fn submit(db: &PgPool, actor: &Actor, id: Uuid, version: i32) -> AppResult<Report> {
    let mut tx = db.begin().await?;
    let issue_id = lock_editable(db, &mut tx, actor, id, version).await?;
    sqlx::query!("UPDATE issue_report SET submitted_at = now(), version = version + 1 WHERE id = $1", id)
        .execute(&mut *tx)
        .await?;
    issues::emit(&mut tx, "report_submitted", issue_id).await?;
    tx.commit().await?;
    fetch(db, id).await
}

/// The report must be visible and the actor's own, with the right version,
/// and still editable. Returns its issue.
async fn lock_editable(db: &PgPool, tx: &mut crate::db::Tx, actor: &Actor, id: Uuid, version: i32) -> AppResult<Uuid> {
    let row = sqlx::query!(
        r#"
        SELECT r.issue_id, r.author_id, r.submitted_at IS NOT NULL AS "submitted!", r.version,
               w.status AS "item_status: Option<WorkStatus>", i.state AS "issue_state: IssueState"
        FROM issue_report r
        JOIN issue i ON i.id = r.issue_id
        LEFT JOIN work_item w ON w.id = r.work_item_id
        WHERE r.id = $1
        FOR UPDATE OF r
        "#,
        id
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AppError::NotFound)?;
    issues::readable(db, actor, row.issue_id).await?;
    if row.author_id != actor.user_id {
        // Someone else's draft doesn't exist for this actor.
        return Err(if row.submitted {
            AppError::forbidden("forbidden", "only the author edits a report")
        } else {
            AppError::NotFound
        });
    }
    if row.version != version {
        return Err(AppError::version_conflict());
    }
    let locked = match row.item_status {
        Some(status) => status.is_final(),
        None => row.issue_state != IssueState::Open,
    };
    if locked {
        return Err(AppError::conflict("report_locked", "the report can no longer be changed"));
    }
    Ok(row.issue_id)
}

/// Is this report visible to the actor (used by attachment downloads)?
pub(crate) async fn is_visible(db: &PgPool, actor: &Actor, report_id: Uuid) -> AppResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM issue_report
                          WHERE id = $1 AND (submitted_at IS NOT NULL OR author_id = $2)) AS "v!""#,
        report_id,
        actor.user_id
    )
    .fetch_one(db)
    .await?)
}

/// The author of a report, if it is still editable (for attachment uploads).
pub(crate) async fn editable_author(db: &PgPool, report_id: Uuid, issue_id: Uuid) -> AppResult<Option<Uuid>> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT r.author_id FROM issue_report r
        JOIN issue i ON i.id = r.issue_id
        LEFT JOIN work_item w ON w.id = r.work_item_id
        WHERE r.id = $1 AND r.issue_id = $2
          AND CASE WHEN r.work_item_id IS NULL THEN i.state = 'open'
                   ELSE w.status NOT IN ('approved', 'cancelled') END
        "#,
        report_id,
        issue_id
    )
    .fetch_optional(db)
    .await?)
}

async fn fetch(db: &PgPool, id: Uuid) -> AppResult<Report> {
    let row = sqlx::query_as!(
        Row,
        r#"SELECT id, issue_id, work_item_id, author_id, title, body, submitted_at, version, created_at, updated_at
           FROM issue_report WHERE id = $1"#,
        id
    )
    .fetch_one(db)
    .await?;
    let files = attachments::for_reports(db, &[id]).await?;
    Ok(with_files(vec![row], files).remove(0))
}

fn validate_title(title: &str) -> AppResult<String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::validation("invalid_title", "title must be between 1 and 200 characters"));
    }
    Ok(title.to_owned())
}

fn validate_body(body: &str) -> AppResult<String> {
    let body = body.trim();
    if body.is_empty() || body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::validation("invalid_report", format!("a report needs 1 to {MAX_BODY_CHARS} characters")));
    }
    Ok(body.to_owned())
}
