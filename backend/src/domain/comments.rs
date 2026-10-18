//! Comments (BACKEND_PLAN.md 7.4).
//!
//! Internal-only comments are invisible, everywhere, to anyone who is not an
//! admin, a super admin or a `comment.internal` holder: lists, mentions,
//! notifications, history, attachments and unread activity.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    attachments::{self, AttachmentMeta},
    audit::{self, AuditEntry},
    issues,
    notifications::{self, Kind, Notice},
};
use crate::{
    authz::{authorize, policy::can_read, relations, relations::IssueFacts, Action, Actor},
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

pub const MAX_BODY_CHARS: usize = 20_000;
pub const MAX_MENTIONS: usize = 50;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Comment {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub work_item_id: Option<Uuid>,
    pub author_id: Uuid,
    /// `null` once deleted; the entry stays so threads keep their shape.
    pub body: Option<String>,
    pub is_internal_only: bool,
    pub deleted: bool,
    pub edited: bool,
    pub mentions: Vec<Uuid>,
    pub attachments: Vec<AttachmentMeta>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

/// May the actor see internal comments on this (readable) issue?
pub(crate) fn sees_internal(actor: &Actor, issue: &IssueFacts) -> bool {
    authorize(actor, Action::InternalComments { issue }).is_ok()
}

/// Could this user see a comment on the issue? Used to filter mentions and
/// notification recipients.
async fn user_can_see(db: &PgPool, user_id: Uuid, issue_id: Uuid, internal: bool) -> AppResult<bool> {
    let Some(user) = sqlx::query!("SELECT is_super_admin, is_active FROM app_user WHERE id = $1", user_id)
        .fetch_optional(db)
        .await?
    else {
        return Ok(false);
    };
    if !user.is_active {
        return Ok(false);
    }
    let actor = Actor::load(db, user_id, user.is_super_admin).await?;
    let Some(issue) = relations::load_issue(db, &actor, issue_id).await? else { return Ok(false) };
    Ok(can_read(&actor, &issue) && (!internal || sees_internal(&actor, &issue)))
}

#[derive(Debug, Serialize, Deserialize)]
struct Cursor {
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    id: Uuid,
}

/// Oldest first. `work_item_id` narrows to one work item's thread.
pub async fn list(
    db: &PgPool,
    actor: &Actor,
    issue_id: Uuid,
    work_item_id: Option<Uuid>,
    page: &PageParams,
) -> AppResult<Page<Comment>> {
    let issue = issues::readable(db, actor, issue_id).await?;
    let internal = sees_internal(actor, &issue);
    let limit = page.limit()?;
    let after: Option<Cursor> = page.cursor()?;

    let rows = sqlx::query!(
        r#"
        SELECT c.id, c.issue_id, c.work_item_id, c.author_id, c.body, c.is_internal_only, c.created_at,
               c.updated_at, c.deleted_at,
               ARRAY(SELECT m.user_id FROM comment_mention m WHERE m.comment_id = c.id ORDER BY m.user_id)
                   AS "mentions!"
        FROM issue_comment c
        WHERE c.issue_id = $1
          AND ($2 OR NOT c.is_internal_only)
          AND ($3::uuid IS NULL OR c.work_item_id = $3)
          AND ($4::timestamptz IS NULL OR (c.created_at, c.id) > ($4, $5))
        ORDER BY c.created_at, c.id
        LIMIT $6
        "#,
        issue_id,
        internal,
        work_item_id,
        after.as_ref().map(|c| c.created_at),
        after.as_ref().map(|c| c.id),
        limit + 1,
    )
    .fetch_all(db)
    .await?;

    let ids: Vec<Uuid> = rows.iter().filter(|r| r.deleted_at.is_none()).map(|r| r.id).collect();
    let mut files = attachments::for_comments(db, &ids).await?;
    let comments = rows
        .into_iter()
        .map(|r| {
            let deleted = r.deleted_at.is_some();
            Comment {
                id: r.id,
                issue_id: r.issue_id,
                work_item_id: r.work_item_id,
                author_id: r.author_id,
                body: (!deleted).then_some(r.body),
                is_internal_only: r.is_internal_only,
                deleted,
                edited: r.updated_at > r.created_at,
                mentions: if deleted { vec![] } else { r.mentions },
                attachments: files.remove(&r.id).unwrap_or_default(),
                created_at: r.created_at,
                updated_at: r.updated_at,
            }
        })
        .collect();
    Ok(Page::from_rows(comments, limit, |c| Cursor { created_at: c.created_at, id: c.id }))
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewComment {
    pub body: String,
    pub work_item_id: Option<Uuid>,
    #[serde(default)]
    pub is_internal_only: bool,
    /// Parsed client-side from `@` mentions; non-readers are dropped silently.
    #[serde(default)]
    pub mention_user_ids: Vec<Uuid>,
}

pub async fn create(db: &PgPool, actor: &Actor, issue_id: Uuid, input: NewComment) -> AppResult<Comment> {
    let issue = issues::readable(db, actor, issue_id).await?;
    authorize(actor, Action::CommentOnIssue { issue: &issue })?;
    if input.is_internal_only {
        authorize(actor, Action::InternalComments { issue: &issue })?;
    }
    let body = validate_body(&input.body)?;
    if input.mention_user_ids.len() > MAX_MENTIONS {
        return Err(AppError::validation("too_many_mentions", format!("at most {MAX_MENTIONS} mentions")));
    }
    if let Some(item) = input.work_item_id {
        let on_issue = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM work_item WHERE id = $1 AND issue_id = $2) AS "ok!""#,
            item,
            issue_id
        )
        .fetch_one(db)
        .await?;
        if !on_issue {
            return Err(AppError::validation("invalid_work_item", "the work item is not part of this issue"));
        }
    }

    // Mentions: keep only people who can read this comment.
    let mut mentions = BTreeSet::new();
    for user in input.mention_user_ids.iter().copied().filter(|u| *u != actor.user_id) {
        if user_can_see(db, user, issue_id, input.is_internal_only).await? {
            mentions.insert(user);
        }
    }

    // `commented`: the creator, the relevant assignees and the watchers,
    // minus the author and anyone mentioned (they get `mentioned`).
    let candidates: BTreeSet<Uuid> = sqlx::query_scalar!(
        r#"
        SELECT created_by AS "user_id!" FROM issue WHERE id = $1
        UNION SELECT assignee_id FROM work_item
              WHERE issue_id = $1 AND assignee_id IS NOT NULL AND ($2::uuid IS NULL OR id = $2)
        UNION SELECT user_id FROM issue_watcher WHERE issue_id = $1
        "#,
        issue_id,
        input.work_item_id,
    )
    .fetch_all(db)
    .await?
    .into_iter()
    .filter(|u| *u != actor.user_id && !mentions.contains(u))
    .collect();
    let mut commented = Vec::new();
    for user in candidates {
        if user_can_see(db, user, issue_id, input.is_internal_only).await? {
            commented.push(user);
        }
    }

    let mut tx = db.begin().await?;
    let comment_id = sqlx::query_scalar!(
        r#"INSERT INTO issue_comment (issue_id, work_item_id, author_id, body, is_internal_only)
           VALUES ($1, $2, $3, $4, $5) RETURNING id"#,
        issue_id,
        input.work_item_id,
        actor.user_id,
        body,
        input.is_internal_only,
    )
    .fetch_one(&mut *tx)
    .await?;
    let mention_ids: Vec<Uuid> = mentions.iter().copied().collect();
    sqlx::query!(
        "INSERT INTO comment_mention (comment_id, user_id) SELECT $1, u FROM unnest($2::uuid[]) AS u",
        comment_id,
        &mention_ids
    )
    .execute(&mut *tx)
    .await?;

    let notice = |kind| Notice {
        kind,
        branch_id: issue.branch_id,
        issue_id: Some(issue_id),
        work_item_id: input.work_item_id,
        actor_id: Some(actor.user_id),
        payload: json!({ "comment_id": comment_id }),
    };
    notifications::notify(&mut tx, &mention_ids, notice(Kind::Mentioned)).await?;
    notifications::notify(&mut tx, &commented, notice(Kind::Commented)).await?;
    issues::emit(&mut tx, "comment_created", issue_id).await?;
    tx.commit().await?;

    fetch_one(db, comment_id).await
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CommentPatch {
    pub body: String,
}

/// Authors edit their own comments.
pub async fn update(db: &PgPool, actor: &Actor, comment_id: Uuid, patch: CommentPatch) -> AppResult<Comment> {
    let (row, _) = load_visible(db, actor, comment_id).await?;
    if row.author_id != actor.user_id {
        return Err(AppError::forbidden("forbidden", "only the author can edit a comment"));
    }
    if row.deleted {
        return Err(AppError::conflict("comment_deleted", "the comment was deleted"));
    }
    let body = validate_body(&patch.body)?;
    let mut tx = db.begin().await?;
    sqlx::query!("UPDATE issue_comment SET body = $2 WHERE id = $1", comment_id, body).execute(&mut *tx).await?;
    issues::emit(&mut tx, "comment_updated", row.issue_id).await?;
    tx.commit().await?;
    fetch_one(db, comment_id).await
}

/// Soft delete: the author, or a moderator (`comment.moderate`, admins).
pub async fn delete(db: &PgPool, actor: &Actor, comment_id: Uuid) -> AppResult<()> {
    let (row, issue) = load_visible(db, actor, comment_id).await?;
    if row.deleted {
        return Err(AppError::NotFound);
    }
    let moderated = row.author_id != actor.user_id;
    if moderated {
        authorize(actor, Action::ModerateComments { issue: &issue })?;
    }
    let mut tx = db.begin().await?;
    sqlx::query!("UPDATE issue_comment SET deleted_at = now() WHERE id = $1", comment_id).execute(&mut *tx).await?;
    // The body is never copied into the audit log.
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "issue_comment",
            entity_id: comment_id.to_string(),
            branch_id: issue.branch_id,
            actor_id: Some(actor.user_id),
            action: "delete",
            old_value: Some(json!({ "author_id": row.author_id, "issue_id": row.issue_id })),
            new_value: Some(json!({ "deleted": true, "moderated": moderated })),
        },
    )
    .await?;
    issues::emit(&mut tx, "comment_deleted", row.issue_id).await?;
    tx.commit().await?;
    Ok(())
}

struct CommentRow {
    issue_id: Uuid,
    author_id: Uuid,
    deleted: bool,
}

/// The comment, if the actor can see it: its issue is readable and, if
/// internal, the actor sees internal comments. Otherwise 404.
async fn load_visible(db: &PgPool, actor: &Actor, comment_id: Uuid) -> AppResult<(CommentRow, IssueFacts)> {
    let row = sqlx::query!(
        r#"SELECT issue_id, author_id, is_internal_only, deleted_at IS NOT NULL AS "deleted!"
           FROM issue_comment WHERE id = $1"#,
        comment_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    let issue = issues::readable(db, actor, row.issue_id).await?;
    if row.is_internal_only && !sees_internal(actor, &issue) {
        return Err(AppError::NotFound);
    }
    Ok((CommentRow { issue_id: row.issue_id, author_id: row.author_id, deleted: row.deleted }, issue))
}

/// Is this comment visible to the actor (used by attachment downloads)?
pub(crate) async fn is_visible(db: &PgPool, actor: &Actor, issue: &IssueFacts, comment_id: Uuid) -> AppResult<bool> {
    let row = sqlx::query!(
        r#"SELECT is_internal_only, deleted_at IS NOT NULL AS "deleted!" FROM issue_comment WHERE id = $1"#,
        comment_id
    )
    .fetch_optional(db)
    .await?;
    Ok(row.is_some_and(|r| !r.deleted && (!r.is_internal_only || sees_internal(actor, issue))))
}

async fn fetch_one(db: &PgPool, comment_id: Uuid) -> AppResult<Comment> {
    let r = sqlx::query!(
        r#"
        SELECT c.id, c.issue_id, c.work_item_id, c.author_id, c.body, c.is_internal_only, c.created_at,
               c.updated_at, c.deleted_at,
               ARRAY(SELECT m.user_id FROM comment_mention m WHERE m.comment_id = c.id ORDER BY m.user_id)
                   AS "mentions!"
        FROM issue_comment c WHERE c.id = $1
        "#,
        comment_id
    )
    .fetch_one(db)
    .await?;
    let mut files: HashMap<Uuid, Vec<AttachmentMeta>> = attachments::for_comments(db, &[r.id]).await?;
    Ok(Comment {
        id: r.id,
        issue_id: r.issue_id,
        work_item_id: r.work_item_id,
        author_id: r.author_id,
        body: Some(r.body),
        is_internal_only: r.is_internal_only,
        deleted: r.deleted_at.is_some(),
        edited: r.updated_at > r.created_at,
        mentions: r.mentions,
        attachments: files.remove(&r.id).unwrap_or_default(),
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
}

fn validate_body(body: &str) -> AppResult<String> {
    let body = body.trim();
    if body.is_empty() || body.chars().count() > MAX_BODY_CHARS {
        return Err(AppError::validation(
            "invalid_comment",
            format!("a comment needs 1 to {MAX_BODY_CHARS} characters"),
        ));
    }
    Ok(body.to_owned())
}
