//! Attachments (BACKEND_PLAN.md 7.4): at most 25 MB, an allow-list of
//! content types, stored under `issues/{issue_id}/{uuid}`, downloaded only
//! through an authorization check. No public URLs.
//!
//! An attachment is visible when its issue is readable and its parent is:
//! a comment that isn't deleted (and, if internal, the actor sees internal
//! comments), or a report that is submitted or the actor's own draft.

use std::collections::HashMap;

use axum::body::Bytes;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{comments, issues, reports};
use crate::{
    authz::{authorize, Action, Actor},
    error::{AppError, AppResult},
    storage::{ObjectReader, ObjectStore},
};

pub const MAX_BYTES: usize = 25 * 1024 * 1024;

/// PDF, images (no SVG: it can carry script), office documents, CSV, text.
pub const ALLOWED_TYPES: &[&str] = &[
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
    "text/csv",
    "application/msword",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
];

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
pub struct AttachmentMeta {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub comment_id: Option<Uuid>,
    pub report_id: Option<Uuid>,
    pub file_name: String,
    pub content_type: String,
    pub file_size_bytes: i64,
    pub checksum_sha256: String,
    pub uploaded_by: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

pub struct Upload {
    pub file_name: String,
    pub content_type: String,
    pub data: Bytes,
    pub comment_id: Option<Uuid>,
    pub report_id: Option<Uuid>,
}

pub async fn upload(
    db: &PgPool,
    store: &dyn ObjectStore,
    actor: &Actor,
    issue_id: Uuid,
    up: Upload,
) -> AppResult<AttachmentMeta> {
    let issue = issues::readable(db, actor, issue_id).await?;

    // Who may attach where: to your own comment, to your own editable
    // report, or to the issue thread if you may comment on it.
    match (up.comment_id, up.report_id) {
        (Some(_), Some(_)) => {
            return Err(AppError::validation("invalid_parent", "attach to a comment or a report, not both"));
        }
        (Some(comment_id), None) => {
            let author = sqlx::query_scalar!(
                "SELECT author_id FROM issue_comment WHERE id = $1 AND issue_id = $2 AND deleted_at IS NULL",
                comment_id,
                issue_id
            )
            .fetch_optional(db)
            .await?;
            if !comments::is_visible(db, actor, &issue, comment_id).await? || author.is_none() {
                return Err(AppError::validation("invalid_parent", "the comment doesn't exist on this issue"));
            }
            if author != Some(actor.user_id) {
                return Err(AppError::forbidden("forbidden", "only the author attaches files to a comment"));
            }
        }
        (None, Some(report_id)) => match reports::editable_author(db, report_id, issue_id).await? {
            None => return Err(AppError::validation("invalid_parent", "the report doesn't exist or is locked")),
            Some(author) if author != actor.user_id => {
                return Err(AppError::forbidden("forbidden", "only the author attaches files to a report"));
            }
            Some(_) => {}
        },
        (None, None) => authorize(actor, Action::CommentOnIssue { issue: &issue })?,
    }

    let content_type = up.content_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    if !ALLOWED_TYPES.contains(&content_type.as_str()) {
        return Err(AppError::validation(
            "unsupported_type",
            format!("files of type {content_type:?} aren't accepted"),
        ));
    }
    if up.data.len() > MAX_BYTES {
        return Err(AppError::PayloadTooLarge { message: "files are limited to 25 MB".into() });
    }
    if up.data.is_empty() {
        return Err(AppError::validation("empty_file", "the file is empty"));
    }
    let file_name = clean_file_name(&up.file_name);
    let checksum: String = Sha256::digest(&up.data).iter().map(|b| format!("{b:02x}")).collect();
    let id = Uuid::new_v4();
    let key = format!("issues/{issue_id}/{id}");
    let size = up.data.len() as i64;

    // File first, then the row; if the row fails, remove the file again.
    store.put(&key, up.data).await.map_err(AppError::internal)?;
    let inserted = sqlx::query_as!(
        AttachmentMeta,
        r#"
        INSERT INTO issue_attachment (id, issue_id, comment_id, report_id, uploaded_by, file_name, storage_key,
                                      content_type, file_size_bytes, checksum_sha256)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, issue_id, comment_id, report_id, file_name, content_type, file_size_bytes,
                  checksum_sha256 AS "checksum_sha256!", uploaded_by, created_at
        "#,
        id,
        issue_id,
        up.comment_id,
        up.report_id,
        actor.user_id,
        file_name,
        key,
        content_type,
        size,
        checksum,
    )
    .fetch_one(db)
    .await;
    match inserted {
        Ok(meta) => Ok(meta),
        Err(e) => {
            if let Err(cleanup) = store.delete(&key).await {
                tracing::warn!(error = %cleanup, %key, "failed to remove orphaned attachment");
            }
            Err(e.into())
        }
    }
}

pub struct Download {
    pub meta: AttachmentMeta,
    pub reader: ObjectReader,
}

/// GET /attachments/{id}: 404 unless the actor can see the attachment.
pub async fn download(db: &PgPool, store: &dyn ObjectStore, actor: &Actor, id: Uuid) -> AppResult<Download> {
    let row = sqlx::query!(
        r#"SELECT id, issue_id, comment_id, report_id, file_name, content_type, file_size_bytes,
                  checksum_sha256 AS "checksum_sha256!", uploaded_by, created_at, storage_key
           FROM issue_attachment WHERE id = $1"#,
        id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    let issue = issues::readable(db, actor, row.issue_id).await?;
    let visible = match (row.comment_id, row.report_id) {
        (Some(c), _) => comments::is_visible(db, actor, &issue, c).await?,
        (_, Some(r)) => reports::is_visible(db, actor, r).await?,
        _ => true,
    };
    if !visible {
        return Err(AppError::NotFound);
    }
    let reader = store.get(&row.storage_key).await.map_err(AppError::internal)?;
    Ok(Download {
        meta: AttachmentMeta {
            id: row.id,
            issue_id: row.issue_id,
            comment_id: row.comment_id,
            report_id: row.report_id,
            file_name: row.file_name,
            content_type: row.content_type,
            file_size_bytes: row.file_size_bytes,
            checksum_sha256: row.checksum_sha256,
            uploaded_by: row.uploaded_by,
            created_at: row.created_at,
        },
        reader,
    })
}

/// Issue-level attachments (not on a comment or report).
pub(crate) async fn for_issue(db: &PgPool, issue_id: Uuid) -> AppResult<Vec<AttachmentMeta>> {
    Ok(sqlx::query_as!(
        AttachmentMeta,
        r#"SELECT id, issue_id, comment_id, report_id, file_name, content_type, file_size_bytes,
                  checksum_sha256 AS "checksum_sha256!", uploaded_by, created_at
           FROM issue_attachment WHERE issue_id = $1 AND comment_id IS NULL AND report_id IS NULL
           ORDER BY created_at, id"#,
        issue_id
    )
    .fetch_all(db)
    .await?)
}

/// Attachments of the given comments. Callers pass only comments the actor
/// can see.
pub(crate) async fn for_comments(db: &PgPool, ids: &[Uuid]) -> AppResult<HashMap<Uuid, Vec<AttachmentMeta>>> {
    let rows = sqlx::query_as!(
        AttachmentMeta,
        r#"SELECT id, issue_id, comment_id, report_id, file_name, content_type, file_size_bytes,
                  checksum_sha256 AS "checksum_sha256!", uploaded_by, created_at
           FROM issue_attachment WHERE comment_id = ANY($1) ORDER BY created_at, id"#,
        ids
    )
    .fetch_all(db)
    .await?;
    Ok(group(rows, |a| a.comment_id))
}

/// Attachments of the given reports. Callers pass only visible reports.
pub(crate) async fn for_reports(db: &PgPool, ids: &[Uuid]) -> AppResult<HashMap<Uuid, Vec<AttachmentMeta>>> {
    let rows = sqlx::query_as!(
        AttachmentMeta,
        r#"SELECT id, issue_id, comment_id, report_id, file_name, content_type, file_size_bytes,
                  checksum_sha256 AS "checksum_sha256!", uploaded_by, created_at
           FROM issue_attachment WHERE report_id = ANY($1) ORDER BY created_at, id"#,
        ids
    )
    .fetch_all(db)
    .await?;
    Ok(group(rows, |a| a.report_id))
}

fn group(
    rows: Vec<AttachmentMeta>,
    key: impl Fn(&AttachmentMeta) -> Option<Uuid>,
) -> HashMap<Uuid, Vec<AttachmentMeta>> {
    let mut out: HashMap<Uuid, Vec<AttachmentMeta>> = HashMap::new();
    for row in rows {
        if let Some(k) = key(&row) {
            out.entry(k).or_default().push(row);
        }
    }
    out
}

/// The base name only, without control characters or quotes, at most 200 chars.
pub fn clean_file_name(name: &str) -> String {
    let base = name.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String =
        base.chars().filter(|c| !c.is_control() && *c != '"').take(200).collect::<String>().trim().to_owned();
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        "file".to_owned()
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::clean_file_name;

    #[test]
    fn file_names_are_cleaned() {
        assert_eq!(clean_file_name("report.pdf"), "report.pdf");
        assert_eq!(clean_file_name("../../etc/passwd"), "passwd");
        assert_eq!(clean_file_name("C:\\Users\\x\\Q3 \"final\".xlsx"), "Q3 final.xlsx");
        assert_eq!(clean_file_name("a\nb\r.txt"), "ab.txt");
        assert_eq!(clean_file_name(".."), "file");
        assert_eq!(clean_file_name(""), "file");
    }
}
