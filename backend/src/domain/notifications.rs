use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    authz::{Actor, IssueFilter},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
    realtime,
};

/// `notification.kind`; the values are fixed by the schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Assigned,
    Unassigned,
    Mentioned,
    Commented,
    StatusChanged,
    SubmittedForApproval,
    Approved,
    Rejected,
    ChangedByAdmin,
    TicketCreated,
    EventInvited,
    EventUpdated,
    EventCancelled,
    EventReminder,
    SlaDueSoon,
    SlaBreached,
    AddedToGroup,
    PermissionsChanged,
}

impl Kind {
    pub const ALL: [Kind; 18] = [
        Self::Assigned,
        Self::Unassigned,
        Self::Mentioned,
        Self::Commented,
        Self::StatusChanged,
        Self::SubmittedForApproval,
        Self::Approved,
        Self::Rejected,
        Self::ChangedByAdmin,
        Self::TicketCreated,
        Self::EventInvited,
        Self::EventUpdated,
        Self::EventCancelled,
        Self::EventReminder,
        Self::SlaDueSoon,
        Self::SlaBreached,
        Self::AddedToGroup,
        Self::PermissionsChanged,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Assigned => "assigned",
            Self::Unassigned => "unassigned",
            Self::Mentioned => "mentioned",
            Self::Commented => "commented",
            Self::StatusChanged => "status_changed",
            Self::SubmittedForApproval => "submitted_for_approval",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::ChangedByAdmin => "changed_by_admin",
            Self::TicketCreated => "ticket_created",
            Self::EventInvited => "event_invited",
            Self::EventUpdated => "event_updated",
            Self::EventCancelled => "event_cancelled",
            Self::EventReminder => "event_reminder",
            Self::SlaDueSoon => "sla_due_soon",
            Self::SlaBreached => "sla_breached",
            Self::AddedToGroup => "added_to_group",
            Self::PermissionsChanged => "permissions_changed",
        }
    }
}

pub struct Notice {
    pub kind: Kind,
    pub branch_id: Option<Uuid>,
    pub issue_id: Option<Uuid>,
    pub work_item_id: Option<Uuid>,
    /// `None` = system job.
    pub actor_id: Option<Uuid>,
    pub payload: Value,
}

/// Inserts one notification per recipient, in the caller's transaction. The
/// actor is never notified about their own change.
pub async fn notify(tx: &mut Tx, recipients: &[Uuid], notice: Notice) -> AppResult<()> {
    let recipients: Vec<Uuid> = recipients.iter().copied().filter(|r| Some(*r) != notice.actor_id).collect();
    if recipients.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        r#"
        INSERT INTO notification (recipient_id, kind, branch_id, issue_id, work_item_id, actor_id, payload)
        SELECT DISTINCT r, $2::text, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::jsonb FROM unnest($1::uuid[]) AS r
        "#,
        &recipients,
        notice.kind.as_str(),
        notice.branch_id,
        notice.issue_id,
        notice.work_item_id,
        notice.actor_id,
        notice.payload,
    )
    .execute(&mut **tx)
    .await?;
    signal_recipients(tx, recipients).await
}

/// Tells the recipients' open streams their inbox changed.
pub(crate) async fn signal_recipients(tx: &mut Tx, recipients: Vec<Uuid>) -> AppResult<()> {
    if recipients.is_empty() {
        return Ok(());
    }
    realtime::emit(
        tx,
        realtime::Event { kind: "notification", issue_id: None, branch_ids: vec![], recipient_ids: recipients },
    )
    .await
}

/// Active, current admins of a branch.
pub async fn branch_admins(tx: &mut Tx, branch_id: Uuid) -> AppResult<Vec<Uuid>> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT m.user_id FROM branch_membership m JOIN app_user u ON u.id = m.user_id
        WHERE m.branch_id = $1 AND m.is_admin AND m.left_at IS NULL AND u.is_active
        "#,
        branch_id
    )
    .fetch_all(&mut **tx)
    .await?)
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Notification {
    pub id: i64,
    pub kind: String,
    pub branch_id: Option<Uuid>,
    pub issue_id: Option<Uuid>,
    /// `ISS-<number>` and title, for display.
    pub issue_key: Option<String>,
    pub issue_title: Option<String>,
    pub work_item_id: Option<Uuid>,
    /// `null` = the system.
    pub actor_id: Option<Uuid>,
    pub payload: Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub read_at: Option<OffsetDateTime>,
}

/// GET /notifications?unread=true: newest first. Notifications about issues
/// the actor can no longer read are left out.
pub async fn list(db: &PgPool, actor: &Actor, unread_only: bool, page: &PageParams) -> AppResult<Page<Notification>> {
    let limit = page.limit()?;
    let after: Option<i64> = page.cursor()?;
    let filter = IssueFilter::for_actor(actor).into_json();
    let rows = sqlx::query_as!(
        Notification,
        r#"
        SELECT n.id, n.kind, n.branch_id, n.issue_id, 'ISS-' || i.number AS issue_key, i.title AS "issue_title?",
               n.work_item_id, n.actor_id, n.payload, n.created_at, n.read_at
        FROM notification n
        LEFT JOIN issue i ON i.id = n.issue_id
        WHERE n.recipient_id = $1
          AND (NOT $2 OR n.read_at IS NULL)
          AND (n.issue_id IS NULL OR issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $3))
          AND ($4::bigint IS NULL OR n.id < $4)
        ORDER BY n.id DESC
        LIMIT $5
        "#,
        actor.user_id,
        unread_only,
        filter,
        after,
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |n| n.id))
}

pub async fn unread_count(db: &PgPool, actor: &Actor) -> AppResult<i64> {
    let filter = IssueFilter::for_actor(actor).into_json();
    Ok(sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "n!" FROM notification n
        LEFT JOIN issue i ON i.id = n.issue_id
        WHERE n.recipient_id = $1 AND n.read_at IS NULL
          AND (n.issue_id IS NULL OR issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $2))
        "#,
        actor.user_id,
        filter
    )
    .fetch_one(db)
    .await?)
}

/// POST /notifications/{id}/read: only your own (others are 404).
pub async fn mark_read(db: &PgPool, actor: &Actor, id: i64) -> AppResult<()> {
    let mut tx = db.begin().await?;
    let found = sqlx::query!(
        "UPDATE notification SET read_at = coalesce(read_at, now()) WHERE id = $1 AND recipient_id = $2",
        id,
        actor.user_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if found == 0 {
        return Err(AppError::NotFound);
    }
    signal_recipients(&mut tx, vec![actor.user_id]).await?;
    tx.commit().await?;
    Ok(())
}

/// POST /notifications/read-all. Returns how many were marked.
pub async fn mark_all_read(db: &PgPool, actor: &Actor) -> AppResult<u64> {
    let mut tx = db.begin().await?;
    let marked = sqlx::query!(
        "UPDATE notification SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL",
        actor.user_id
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    signal_recipients(&mut tx, vec![actor.user_id]).await?;
    tx.commit().await?;
    Ok(marked)
}
