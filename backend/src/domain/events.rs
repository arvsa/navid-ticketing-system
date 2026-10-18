//! Events (BACKEND_PLAN.md 7.2 and 7.5): invitees come from the targets,
//! RSVPs, reminders, change and cancel notifications, and the calendar.
//!
//! Invitees are resolved like per-member work: the user target, the current
//! active members of a group target, the current active members of a branch
//! target. The organizer (the creator) is never an invitee.

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{
    issues::{self, EventDetails},
    notifications::{self, Kind, Notice},
    types::IssueState,
};
use crate::{
    authz::{Actor, IssueFilter, IssueType},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
};

pub const DEFAULT_REMINDERS: [i32; 2] = [1440, 60];
pub const MAX_REMINDERS: usize = 10;
pub const MAX_CALENDAR_DAYS: i64 = 366;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema)]
#[sqlx(type_name = "rsvp_response", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RsvpResponse {
    Pending,
    Going,
    Maybe,
    Declined,
}

#[derive(Debug, Default, Serialize, utoipa::ToSchema)]
pub struct RsvpCounts {
    pub going: i64,
    pub maybe: i64,
    pub declined: i64,
    pub pending: i64,
}

/// What the event looks like to one viewer.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct EventView {
    #[serde(flatten)]
    pub details: EventDetails,
    /// Minutes before the start, largest first.
    pub reminders: Vec<i32>,
    /// `null` when the viewer isn't invited.
    pub my_rsvp: Option<RsvpResponse>,
    pub rsvp_counts: RsvpCounts,
}

pub(crate) async fn view(db: &PgPool, actor: &Actor, issue_id: Uuid) -> AppResult<Option<EventView>> {
    let Some(details) = sqlx::query_as!(
        EventDetails,
        "SELECT starts_at, ends_at, all_day, location FROM issue_event WHERE issue_id = $1",
        issue_id
    )
    .fetch_optional(db)
    .await?
    else {
        return Ok(None);
    };
    let reminders = sqlx::query_scalar!(
        "SELECT minutes_before FROM event_reminder WHERE issue_id = $1 ORDER BY minutes_before DESC",
        issue_id
    )
    .fetch_all(db)
    .await?;
    let my_rsvp = sqlx::query_scalar!(
        r#"SELECT response AS "response: RsvpResponse" FROM event_rsvp WHERE issue_id = $1 AND user_id = $2"#,
        issue_id,
        actor.user_id
    )
    .fetch_optional(db)
    .await?;
    Ok(Some(EventView { details, reminders, my_rsvp, rsvp_counts: counts(db, issue_id).await? }))
}

async fn counts(db: &PgPool, issue_id: Uuid) -> AppResult<RsvpCounts> {
    let r = sqlx::query!(
        r#"SELECT count(*) FILTER (WHERE response = 'going') AS "going!",
                  count(*) FILTER (WHERE response = 'maybe') AS "maybe!",
                  count(*) FILTER (WHERE response = 'declined') AS "declined!",
                  count(*) FILTER (WHERE response = 'pending') AS "pending!"
           FROM event_rsvp WHERE issue_id = $1"#,
        issue_id
    )
    .fetch_one(db)
    .await?;
    Ok(RsvpCounts { going: r.going, maybe: r.maybe, declined: r.declined, pending: r.pending })
}

// ---------------------------------------------------------------------------
// Invitees and reminders (called from `issues` inside its transactions)
// ---------------------------------------------------------------------------

/// Adds an RSVP row for every resolved invitee who doesn't have one yet,
/// and sends them `event_invited`.
pub(crate) async fn sync_invitees(tx: &mut Tx, actor: &Actor, issue_id: Uuid) -> AppResult<Vec<Uuid>> {
    let invited = sqlx::query_scalar!(
        r#"
        INSERT INTO event_rsvp (issue_id, user_id)
        SELECT $1, u.user_id FROM (
            SELECT t.user_id FROM issue_target t
            JOIN branch_membership m ON m.user_id = t.user_id AND m.branch_id = t.branch_id AND m.left_at IS NULL
            WHERE t.issue_id = $1 AND t.removed_at IS NULL AND t.kind = 'user'
            UNION
            SELECT gm.user_id FROM issue_target t JOIN group_member gm ON gm.group_id = t.group_id
            WHERE t.issue_id = $1 AND t.removed_at IS NULL AND t.kind = 'group'
            UNION
            SELECT m.user_id FROM issue_target t
            JOIN branch_membership m ON m.branch_id = t.branch_id AND m.left_at IS NULL
            WHERE t.issue_id = $1 AND t.removed_at IS NULL AND t.kind = 'branch'
        ) u
        JOIN app_user a ON a.id = u.user_id AND a.is_active
        WHERE u.user_id <> (SELECT created_by FROM issue WHERE id = $1)
        ON CONFLICT (issue_id, user_id) DO NOTHING
        RETURNING user_id
        "#,
        issue_id
    )
    .fetch_all(&mut **tx)
    .await?;

    let branch_id =
        sqlx::query_scalar!("SELECT branch_id FROM issue WHERE id = $1", issue_id).fetch_one(&mut **tx).await?;
    notifications::notify(
        tx,
        &invited,
        Notice {
            kind: Kind::EventInvited,
            branch_id,
            issue_id: Some(issue_id),
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload: json!({}),
        },
    )
    .await?;
    Ok(invited)
}

/// After a target is removed: drops the RSVPs of people no remaining target
/// covers.
pub(crate) async fn prune_invitees(tx: &mut Tx, issue_id: Uuid) -> AppResult<()> {
    sqlx::query!(
        r#"
        DELETE FROM event_rsvp r
        WHERE r.issue_id = $1 AND NOT EXISTS (
            SELECT 1 FROM issue_target t
            WHERE t.issue_id = $1 AND t.removed_at IS NULL AND (
                   (t.kind = 'user' AND t.user_id = r.user_id)
                OR (t.kind = 'group' AND EXISTS (
                      SELECT 1 FROM group_member gm WHERE gm.group_id = t.group_id AND gm.user_id = r.user_id))
                OR (t.kind = 'branch' AND EXISTS (
                      SELECT 1 FROM branch_membership m
                      WHERE m.branch_id = t.branch_id AND m.user_id = r.user_id AND m.left_at IS NULL))))
        "#,
        issue_id
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Validates and de-duplicates a reminder list.
pub fn validate_reminders(minutes: &[i32]) -> AppResult<Vec<i32>> {
    if minutes.len() > MAX_REMINDERS {
        return Err(AppError::validation("invalid_reminders", format!("at most {MAX_REMINDERS} reminders")));
    }
    if minutes.iter().any(|m| !(1..=40_320).contains(m)) {
        return Err(AppError::validation("invalid_reminders", "reminders are 1 minute to 4 weeks before the start"));
    }
    let mut out = minutes.to_vec();
    out.sort_unstable_by(|a, b| b.cmp(a));
    out.dedup();
    Ok(out)
}

/// Replaces the event's reminders.
pub(crate) async fn set_reminders(tx: &mut Tx, issue_id: Uuid, minutes: &[i32]) -> AppResult<()> {
    sqlx::query!("DELETE FROM event_reminder WHERE issue_id = $1", issue_id).execute(&mut **tx).await?;
    sqlx::query!(
        "INSERT INTO event_reminder (issue_id, minutes_before) SELECT $1, m FROM unnest($2::int[]) AS m",
        issue_id,
        minutes
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// A time or location change notifies invitees who are going or maybe
/// (`event_updated`). A time change also resets their RSVPs to pending.
pub(crate) async fn on_changed(
    tx: &mut Tx,
    actor: &Actor,
    issue_id: Uuid,
    branch_id: Option<Uuid>,
    time_changed: bool,
    location_changed: bool,
) -> AppResult<()> {
    if !time_changed && !location_changed {
        return Ok(());
    }
    let attending = sqlx::query_scalar!(
        "SELECT user_id FROM event_rsvp WHERE issue_id = $1 AND response IN ('going', 'maybe')",
        issue_id
    )
    .fetch_all(&mut **tx)
    .await?;
    if time_changed {
        sqlx::query!(
            r#"UPDATE event_rsvp SET response = 'pending', responded_at = NULL
               WHERE issue_id = $1 AND response IN ('going', 'maybe')"#,
            issue_id
        )
        .execute(&mut **tx)
        .await?;
    }
    let mut changes = Vec::new();
    if time_changed {
        changes.push("time");
    }
    if location_changed {
        changes.push("location");
    }
    notifications::notify(
        tx,
        &attending,
        Notice {
            kind: Kind::EventUpdated,
            branch_id,
            issue_id: Some(issue_id),
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload: json!({ "changes": changes, "rsvp_reset": time_changed }),
        },
    )
    .await
}

/// Cancelling notifies every invitee who hasn't declined.
pub(crate) async fn on_cancelled(tx: &mut Tx, actor: &Actor, issue_id: Uuid, branch_id: Option<Uuid>) -> AppResult<()> {
    let invitees =
        sqlx::query_scalar!("SELECT user_id FROM event_rsvp WHERE issue_id = $1 AND response <> 'declined'", issue_id)
            .fetch_all(&mut **tx)
            .await?;
    notifications::notify(
        tx,
        &invitees,
        Notice {
            kind: Kind::EventCancelled,
            branch_id,
            issue_id: Some(issue_id),
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload: json!({}),
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// RSVPs
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct RsvpInput {
    pub response: RsvpResponse,
    pub note: Option<String>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Rsvp {
    pub user_id: Uuid,
    pub first_name: String,
    pub last_name: String,
    pub response: RsvpResponse,
    pub note: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub responded_at: Option<OffsetDateTime>,
}

/// PUT /events/{id}/rsvp: invitees answer; no permission needed beyond
/// being invited (and able to read the event).
pub async fn respond(db: &PgPool, actor: &Actor, issue_id: Uuid, input: RsvpInput) -> AppResult<Rsvp> {
    let issue = issues::readable(db, actor, issue_id).await?;
    if issue.issue_type != IssueType::Event {
        return Err(AppError::NotFound);
    }
    if input.response == RsvpResponse::Pending {
        return Err(AppError::validation("invalid_response", "answer going, maybe or declined"));
    }
    let note = input.note.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty());
    if note.as_ref().is_some_and(|n| n.chars().count() > 500) {
        return Err(AppError::validation("invalid_note", "the note is limited to 500 characters"));
    }
    let state = sqlx::query_scalar!(r#"SELECT state AS "state: IssueState" FROM issue WHERE id = $1"#, issue_id)
        .fetch_one(db)
        .await?;
    if state != IssueState::Open {
        return Err(AppError::conflict("event_not_open", "the event is cancelled or over"));
    }

    let mut tx = db.begin().await?;
    let updated = sqlx::query!(
        r#"UPDATE event_rsvp SET response = $3, note = $4, responded_at = now()
           WHERE issue_id = $1 AND user_id = $2"#,
        issue_id,
        actor.user_id,
        input.response as RsvpResponse,
        note,
    )
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if updated == 0 {
        return Err(AppError::forbidden("not_invited", "you are not invited to this event"));
    }
    issues::emit(&mut tx, "rsvp_changed", issue_id).await?;
    tx.commit().await?;

    Ok(sqlx::query_as!(
        Rsvp,
        r#"SELECT r.user_id, u.first_name, u.last_name, r.response AS "response: RsvpResponse", r.note, r.responded_at
           FROM event_rsvp r JOIN app_user u ON u.id = r.user_id WHERE r.issue_id = $1 AND r.user_id = $2"#,
        issue_id,
        actor.user_id
    )
    .fetch_one(db)
    .await?)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct RsvpPage {
    pub counts: RsvpCounts,
    #[serde(flatten)]
    pub page: Page<Rsvp>,
}

/// GET /events/{id}/rsvps: everyone who can read the event.
pub async fn list(db: &PgPool, actor: &Actor, issue_id: Uuid, page: &PageParams) -> AppResult<RsvpPage> {
    let issue = issues::readable(db, actor, issue_id).await?;
    if issue.issue_type != IssueType::Event {
        return Err(AppError::NotFound);
    }
    let limit = page.limit()?;
    let after: Option<(String, String, Uuid)> = page.cursor()?;
    let (after_last, after_first, after_id) = match after {
        Some((l, f, id)) => (Some(l), Some(f), Some(id)),
        None => (None, None, None),
    };
    let rows = sqlx::query_as!(
        Rsvp,
        r#"
        SELECT r.user_id, u.first_name, u.last_name, r.response AS "response: RsvpResponse", r.note, r.responded_at
        FROM event_rsvp r JOIN app_user u ON u.id = r.user_id
        WHERE r.issue_id = $1
          AND ($2::text IS NULL OR (lower(u.last_name), lower(u.first_name), u.id) > ($2, $3, $4))
        ORDER BY lower(u.last_name), lower(u.first_name), u.id
        LIMIT $5
        "#,
        issue_id,
        after_last,
        after_first,
        after_id,
        limit + 1,
    )
    .fetch_all(db)
    .await?;
    let page = Page::from_rows(rows, limit, |r| (r.last_name.to_lowercase(), r.first_name.to_lowercase(), r.user_id));
    Ok(RsvpPage { counts: counts(db, issue_id).await?, page })
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct CalendarQuery {
    #[serde(with = "time::serde::rfc3339")]
    pub from: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub to: OffsetDateTime,
    pub branch_id: Option<Uuid>,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct CalendarEntry {
    pub issue_id: Uuid,
    pub number: i64,
    pub key: String,
    pub branch_id: Option<Uuid>,
    pub title: String,
    pub state: IssueState,
    pub is_private: bool,
    pub organizer_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub ends_at: OffsetDateTime,
    pub all_day: bool,
    pub location: Option<String>,
    pub my_rsvp: Option<RsvpResponse>,
}

#[derive(Debug, Serialize, Deserialize)]
struct CalendarCursor {
    #[serde(with = "time::serde::rfc3339")]
    starts_at: OffsetDateTime,
    id: Uuid,
}

/// GET /calendar?from=&to=&branch_id=: readable events overlapping the
/// window, earliest first, with the actor's own RSVP.
pub async fn calendar(
    db: &PgPool,
    actor: &Actor,
    query: &CalendarQuery,
    page: &PageParams,
) -> AppResult<Page<CalendarEntry>> {
    if query.to <= query.from {
        return Err(AppError::validation("invalid_range", "`to` must be after `from`"));
    }
    if query.to - query.from > Duration::days(MAX_CALENDAR_DAYS) {
        return Err(AppError::validation("invalid_range", format!("the window is at most {MAX_CALENDAR_DAYS} days")));
    }
    let limit = page.limit()?;
    let after: Option<CalendarCursor> = page.cursor()?;
    let filter = IssueFilter::for_actor(actor).into_json();

    let rows = sqlx::query!(
        r#"
        SELECT i.id, i.number, i.branch_id, i.title, i.state AS "state: IssueState", i.is_private, i.created_by,
               e.starts_at, e.ends_at, e.all_day, e.location,
               r.response AS "my_rsvp?: RsvpResponse"
        FROM issue_event e
        JOIN issue i ON i.id = e.issue_id
        LEFT JOIN event_rsvp r ON r.issue_id = i.id AND r.user_id = $2
        WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
          AND e.starts_at < $4 AND e.ends_at >= $3
          AND ($5::uuid IS NULL OR i.branch_id = $5 OR (i.branch_id IS NULL AND EXISTS (
                SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = $5 AND t.removed_at IS NULL)))
          AND ($6::timestamptz IS NULL OR (e.starts_at, i.id) > ($6, $7))
        ORDER BY e.starts_at, i.id
        LIMIT $8
        "#,
        filter,
        actor.user_id,
        query.from,
        query.to,
        query.branch_id,
        after.as_ref().map(|c| c.starts_at),
        after.as_ref().map(|c| c.id),
        limit + 1,
    )
    .fetch_all(db)
    .await?;

    let entries = rows
        .into_iter()
        .map(|r| CalendarEntry {
            key: format!("ISS-{}", r.number),
            issue_id: r.id,
            number: r.number,
            branch_id: r.branch_id,
            title: r.title,
            state: r.state,
            is_private: r.is_private,
            organizer_id: r.created_by,
            starts_at: r.starts_at,
            ends_at: r.ends_at,
            all_day: r.all_day,
            location: r.location,
            my_rsvp: r.my_rsvp,
        })
        .collect();
    Ok(Page::from_rows(entries, limit, |e| CalendarCursor { starts_at: e.starts_at, id: e.issue_id }))
}
