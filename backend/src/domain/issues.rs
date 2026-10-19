use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

use super::{
    attachments::{self, AttachmentMeta},
    audit::{self, AuditEntry},
    branches::double_option,
    comments,
    events::{self, EventView},
    notifications::{self, Kind, Notice},
    targets::{self, IssueCtx, Target, TargetInput},
    types::{CompletionMode, IssueState, Priority, TargetKind},
    work_items::{self, WorkItem},
};
use crate::{
    authz::{authorize, relations, relations::IssueFacts, Action, Actor, IssueFilter, IssueType},
    db::Tx,
    error::{AppError, AppResult},
    pagination::{Page, PageParams},
    realtime,
};

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct IssueSummary {
    pub id: Uuid,
    pub number: i64,
    /// Display form, `ISS-<number>`.
    pub key: String,
    pub branch_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub issue_type: String,
    pub title: String,
    pub priority: Priority,
    pub state: IssueState,
    pub is_private: bool,
    pub created_by: Uuid,
    pub work_item_count: i64,
    pub done_count: i64,
    pub is_overdue: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_activity_at: OffsetDateTime,
    /// Activity since the actor last opened the issue.
    pub unread: bool,
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct IssueDetail {
    pub id: Uuid,
    pub number: i64,
    pub key: String,
    pub branch_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub issue_type: String,
    pub title: String,
    pub description: Option<String>,
    pub priority: Priority,
    pub is_private: bool,
    pub completion_mode: CompletionMode,
    pub state: IssueState,
    #[serde(with = "time::serde::rfc3339::option")]
    pub closed_at: Option<OffsetDateTime>,
    pub closed_by: Option<Uuid>,
    /// A super admin created the issue (always true for school-wide issues),
    /// so only super admins may edit, close, cancel, retarget, change privacy,
    /// or approve and cancel its work. Applies to every type: on tickets and
    /// events it still controls the editing rules. Fixed at creation.
    pub requires_super_admin_approval: bool,
    pub created_by: Uuid,
    pub version: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub event: Option<EventView>,
    pub targets: Vec<Target>,
    pub work_items: Vec<WorkItem>,
    /// Files on the issue itself; comment and report files come with those.
    pub attachments: Vec<AttachmentMeta>,
    pub watching: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_read_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EventDetails {
    #[serde(with = "time::serde::rfc3339")]
    pub starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub ends_at: OffsetDateTime,
    #[serde(default)]
    pub all_day: bool,
    pub location: Option<String>,
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/// Loads the facts and checks read access: unreadable issues are 404.
pub(crate) async fn readable(db: &PgPool, actor: &Actor, issue_id: Uuid) -> AppResult<IssueFacts> {
    let facts = relations::load_issue(db, actor, issue_id).await?.ok_or(AppError::NotFound)?;
    authorize(actor, Action::ReadIssue { issue: &facts })?;
    Ok(facts)
}

pub async fn get(db: &PgPool, actor: &Actor, issue_id: Uuid) -> AppResult<IssueDetail> {
    readable(db, actor, issue_id).await?;
    detail(db, actor, issue_id).await
}

pub async fn get_by_number(db: &PgPool, actor: &Actor, number: i64) -> AppResult<IssueDetail> {
    let id = sqlx::query_scalar!("SELECT id FROM issue WHERE number = $1", number)
        .fetch_optional(db)
        .await?
        .ok_or(AppError::NotFound)?;
    get(db, actor, id).await
}

async fn detail(db: &PgPool, actor: &Actor, issue_id: Uuid) -> AppResult<IssueDetail> {
    let r = sqlx::query!(
        r#"
        SELECT i.id, i.number, i.branch_id, ty.code AS issue_type, i.title, i.description,
               i.priority AS "priority: Priority", i.is_private, i.completion_mode AS "completion_mode: CompletionMode",
               i.state AS "state: IssueState", i.closed_at, i.closed_by, i.requires_super_admin_approval,
               i.created_by, i.version, i.created_at, i.updated_at,
               EXISTS (SELECT 1 FROM issue_watcher w WHERE w.issue_id = i.id AND w.user_id = $2) AS "watching!",
               (SELECT r.last_read_at FROM issue_read r WHERE r.issue_id = i.id AND r.user_id = $2) AS last_read_at
        FROM issue i JOIN issue_type ty ON ty.id = i.type_id
        WHERE i.id = $1
        "#,
        issue_id,
        actor.user_id,
    )
    .fetch_one(db)
    .await?;

    let event = events::view(db, actor, issue_id).await?;
    let targets = sqlx::query_as!(
        Target,
        r#"SELECT id, kind AS "kind: TargetKind", branch_id, user_id, group_id, created_at
           FROM issue_target WHERE issue_id = $1 AND removed_at IS NULL ORDER BY created_at, id"#,
        issue_id
    )
    .fetch_all(db)
    .await?;
    let work_items = work_items::for_issue(db, issue_id).await?;
    let attachments = attachments::for_issue(db, issue_id).await?;

    Ok(IssueDetail {
        id: r.id,
        number: r.number,
        key: format!("ISS-{}", r.number),
        branch_id: r.branch_id,
        issue_type: r.issue_type,
        title: r.title,
        description: r.description,
        priority: r.priority,
        is_private: r.is_private,
        completion_mode: r.completion_mode,
        state: r.state,
        closed_at: r.closed_at,
        closed_by: r.closed_by,
        requires_super_admin_approval: r.requires_super_admin_approval,
        created_by: r.created_by,
        version: r.version,
        created_at: r.created_at,
        updated_at: r.updated_at,
        event,
        targets,
        work_items,
        attachments,
        watching: r.watching,
        last_read_at: r.last_read_at,
    })
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct IssueQuery {
    pub branch_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub issue_type: Option<String>,
    pub state: Option<IssueState>,
    /// `me`: only issues with a work item assigned to the actor.
    pub assignee: Option<String>,
    /// Case-insensitive substring of the title.
    pub q: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct IssueCursor {
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    id: Uuid,
}

pub async fn list(db: &PgPool, actor: &Actor, query: &IssueQuery, page: &PageParams) -> AppResult<Page<IssueSummary>> {
    let limit = page.limit()?;
    let after: Option<IssueCursor> = page.cursor()?;
    let assignee_me = match query.assignee.as_deref() {
        None => false,
        Some("me") => true,
        Some(_) => return Err(AppError::validation("invalid_query", "assignee only supports `me`")),
    };
    if let Some(t) = &query.issue_type {
        IssueType::from_code(t).ok_or_else(|| AppError::validation("invalid_query", "unknown issue type"))?;
    }
    let pattern = query.q.as_deref().map(str::trim).filter(|q| !q.is_empty()).map(like_pattern);
    let filter = IssueFilter::for_actor(actor).into_json();

    let rows = sqlx::query!(
        r#"
        SELECT i.id, i.number, i.branch_id, ty.code AS issue_type, i.title, i.priority AS "priority: Priority",
               i.state AS "state: IssueState", i.is_private, i.created_by, i.created_at,
               (SELECT count(*) FROM work_item w WHERE w.issue_id = i.id) AS "work_item_count!",
               (SELECT count(*) FROM work_item w WHERE w.issue_id = i.id
                  AND w.status IN ('approved', 'cancelled')) AS "done_count!",
               EXISTS (SELECT 1 FROM work_item_overview w WHERE w.issue_id = i.id AND w.is_overdue) AS "is_overdue!",
               -- Activity the actor can see: comments count, internal ones only
               -- where the actor sees internal comments.
               greatest(i.updated_at,
                        (SELECT max(w.updated_at) FROM work_item w WHERE w.issue_id = i.id),
                        (SELECT max(c.updated_at) FROM issue_comment c
                         WHERE c.issue_id = i.id AND c.deleted_at IS NULL
                           AND (NOT c.is_internal_only
                                OR coalesce(($1::jsonb->>'super')::boolean, false)
                                OR $1::jsonb->'internal' ? i.branch_id::text
                                OR (i.branch_id IS NULL AND EXISTS (
                                      SELECT 1 FROM issue_target t
                                      WHERE t.issue_id = i.id AND t.removed_at IS NULL
                                        AND $1::jsonb->'internal' ? t.branch_id::text)))))
                   AS "last_activity_at!",
               r.last_read_at AS "last_read_at?"
        FROM issue i
        JOIN issue_type ty ON ty.id = i.type_id
        LEFT JOIN issue_read r ON r.issue_id = i.id AND r.user_id = $2
        WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
          AND ($3::uuid IS NULL OR i.branch_id = $3 OR (i.branch_id IS NULL AND EXISTS (
                SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = $3 AND t.removed_at IS NULL)))
          AND ($4::text IS NULL OR ty.code = $4)
          AND ($5::issue_state IS NULL OR i.state = $5)
          AND (NOT $6 OR EXISTS (SELECT 1 FROM work_item w WHERE w.issue_id = i.id AND w.assignee_id = $2))
          AND ($7::text IS NULL OR i.title ILIKE $7)
          AND ($8::timestamptz IS NULL OR (i.created_at, i.id) < ($8, $9))
        ORDER BY i.created_at DESC, i.id DESC
        LIMIT $10
        "#,
        filter,
        actor.user_id,
        query.branch_id,
        query.issue_type,
        query.state as Option<IssueState>,
        assignee_me,
        pattern,
        after.as_ref().map(|c| c.created_at),
        after.as_ref().map(|c| c.id),
        limit + 1,
    )
    .fetch_all(db)
    .await?;

    let items = rows
        .into_iter()
        .map(|r| IssueSummary {
            key: format!("ISS-{}", r.number),
            id: r.id,
            number: r.number,
            branch_id: r.branch_id,
            issue_type: r.issue_type,
            title: r.title,
            priority: r.priority,
            state: r.state,
            is_private: r.is_private,
            created_by: r.created_by,
            work_item_count: r.work_item_count,
            done_count: r.done_count,
            is_overdue: r.is_overdue,
            created_at: r.created_at,
            unread: r.last_read_at.is_none_or(|read| r.last_activity_at > read),
            last_activity_at: r.last_activity_at,
        })
        .collect();
    Ok(Page::from_rows(items, limit, |i| IssueCursor { created_at: i.created_at, id: i.id }))
}

/// `%term%` with LIKE wildcards in the term escaped.
fn like_pattern(term: &str) -> String {
    let escaped = term.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    format!("%{escaped}%")
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewIssue {
    /// `null` = cross-branch (super admins, whole-branch targets only).
    pub branch_id: Option<Uuid>,
    #[serde(rename = "type")]
    pub issue_type: String,
    pub title: String,
    pub description: Option<String>,
    #[serde(default = "default_priority")]
    pub priority: Priority,
    #[serde(default)]
    pub is_private: bool,
    #[serde(default)]
    pub completion_mode: CompletionMode,
    #[serde(default)]
    pub targets: Vec<TargetInput>,
    /// Actions and Reports only; defaults to now + the type's default SLA.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub sla_due_at: Option<OffsetDateTime>,
    /// Required for Events, rejected otherwise.
    pub event: Option<EventInput>,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct EventInput {
    #[serde(flatten)]
    pub details: EventDetails,
    /// Minutes before the start; defaults to a day and an hour before.
    pub reminders: Option<Vec<i32>>,
}

fn default_priority() -> Priority {
    Priority::Medium
}

pub async fn create(db: &PgPool, actor: &Actor, input: NewIssue) -> AppResult<IssueDetail> {
    let issue_type = IssueType::from_code(&input.issue_type)
        .ok_or_else(|| AppError::validation("invalid_issue_type", "type must be ticket, report, event or action"))?;
    let title = validate_title(&input.title)?;
    let description = clean_text(input.description);
    let has_work = matches!(issue_type, IssueType::Action | IssueType::Report);
    if !has_work && input.completion_mode == CompletionMode::PerMember {
        return Err(AppError::validation("invalid_completion_mode", "only actions and reports have per-member work"));
    }
    if !has_work && input.sla_due_at.is_some() {
        return Err(AppError::validation("invalid_sla", "only actions and reports have an SLA"));
    }
    match (issue_type, &input.event) {
        (IssueType::Event, None) => return Err(AppError::validation("event_required", "events need event details")),
        (IssueType::Event, Some(e)) => validate_event(&e.details)?,
        (_, Some(_)) => return Err(AppError::validation("invalid_event", "only events have event details")),
        _ => {}
    }

    let mut resolved = Vec::new();
    for t in &input.targets {
        let r = targets::resolve(t, input.branch_id)?;
        if !resolved.contains(&r) {
            resolved.push(r);
        }
    }
    if input.branch_id.is_none() && resolved.is_empty() {
        return Err(AppError::validation("invalid_target", "a cross-branch issue needs at least one branch target"));
    }
    let whole_branch = resolved.iter().any(|t| t.kind == TargetKind::Branch);
    let reminders = match &input.event {
        Some(e) => events::validate_reminders(e.reminders.as_deref().unwrap_or(&events::DEFAULT_REMINDERS))?,
        None => vec![],
    };

    authorize(
        actor,
        Action::CreateIssue { branch_id: input.branch_id, issue_type, targets_whole_branches: whole_branch },
    )?;
    // Targeting and privacy at creation are checked as on an issue the actor owns.
    let draft = IssueFacts {
        id: Uuid::nil(),
        branch_id: input.branch_id,
        issue_type,
        is_private: input.is_private,
        created_by: actor.user_id,
        requires_super_admin_approval: actor.is_super_admin,
        target_branch_ids: resolved.iter().map(|t| t.branch_id).collect(),
        actor_targeted: false,
    };
    if !resolved.is_empty() {
        authorize(actor, Action::TargetIssue { issue: &draft, whole_branch })?;
    }
    if input.is_private {
        authorize(actor, Action::SetIssuePrivate { issue: &draft })?;
    }

    let mut tx = db.begin().await?;
    let sla_due_at = if has_work { Some(sla_or_default(&mut tx, issue_type, input.sla_due_at).await?) } else { None };

    let issue_id = sqlx::query_scalar!(
        r#"
        INSERT INTO issue (branch_id, type_id, title, description, priority, is_private, completion_mode,
                           requires_super_admin_approval, created_by)
        VALUES ($1, (SELECT id FROM issue_type WHERE code = $2), $3, $4, $5, $6, $7, $8, $9)
        RETURNING id
        "#,
        input.branch_id,
        issue_type.code(),
        title,
        description,
        input.priority as Priority,
        input.is_private,
        input.completion_mode as CompletionMode,
        actor.is_super_admin,
        actor.user_id,
    )
    .fetch_one(&mut *tx)
    .await?;

    if let Some(EventInput { details: e, .. }) = &input.event {
        sqlx::query!(
            "INSERT INTO issue_event (issue_id, starts_at, ends_at, all_day, location) VALUES ($1, $2, $3, $4, $5)",
            issue_id,
            e.starts_at,
            e.ends_at,
            e.all_day,
            clean_text(e.location.clone()),
        )
        .execute(&mut *tx)
        .await?;
    }

    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "issue",
            entity_id: issue_id.to_string(),
            branch_id: input.branch_id,
            actor_id: Some(actor.user_id),
            action: "create",
            old_value: None,
            new_value: Some(json!({
                "type": issue_type.code(), "title": title, "description": description, "priority": input.priority,
                "is_private": input.is_private, "completion_mode": input.completion_mode, "event": input.event,
                "requires_super_admin_approval": actor.is_super_admin,
            })),
        },
    )
    .await?;

    let ctx = IssueCtx { id: issue_id, branch_id: input.branch_id, issue_type, completion_mode: input.completion_mode };
    for target in &resolved {
        targets::add(&mut tx, actor, ctx, *target, sla_due_at).await?;
    }
    if issue_type == IssueType::Event {
        events::set_reminders(&mut tx, issue_id, &reminders).await?;
        events::sync_invitees(&mut tx, actor, issue_id).await?;
    }

    if issue_type == IssueType::Ticket {
        let branches: Vec<Uuid> = match input.branch_id {
            Some(b) => vec![b],
            None => resolved.iter().map(|t| t.branch_id).collect(),
        };
        for b in branches {
            let admins = notifications::branch_admins(&mut tx, b).await?;
            notifications::notify(
                &mut tx,
                &admins,
                Notice {
                    kind: Kind::TicketCreated,
                    branch_id: Some(b),
                    issue_id: Some(issue_id),
                    work_item_id: None,
                    actor_id: Some(actor.user_id),
                    payload: json!({ "title": title }),
                },
            )
            .await?;
        }
    }

    emit(&mut tx, "issue_created", issue_id).await?;
    tx.commit().await?;
    detail(db, actor, issue_id).await
}

async fn sla_or_default(
    tx: &mut Tx,
    issue_type: IssueType,
    given: Option<OffsetDateTime>,
) -> AppResult<OffsetDateTime> {
    if let Some(at) = given {
        return Ok(at);
    }
    let hours = sqlx::query_scalar!("SELECT default_sla_hours FROM issue_type WHERE code = $1", issue_type.code())
        .fetch_one(&mut **tx)
        .await?
        .unwrap_or(72);
    Ok(OffsetDateTime::now_utc() + Duration::hours(hours.into()))
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct IssuePatch {
    /// The version the client last saw.
    pub version: i32,
    pub title: Option<String>,
    #[serde(default, with = "double_option")]
    pub description: Option<Option<String>>,
    pub priority: Option<Priority>,
    pub is_private: Option<bool>,
    pub event: Option<EventPatch>,
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct EventPatch {
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub starts_at: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub ends_at: Option<OffsetDateTime>,
    pub all_day: Option<bool>,
    #[serde(default, with = "double_option")]
    pub location: Option<Option<String>>,
    /// Replaces the reminder list.
    pub reminders: Option<Vec<i32>>,
}

pub async fn update(db: &PgPool, actor: &Actor, issue_id: Uuid, patch: IssuePatch) -> AppResult<IssueDetail> {
    let facts = readable(db, actor, issue_id).await?;
    let edits_content =
        patch.title.is_some() || patch.description.is_some() || patch.priority.is_some() || patch.event.is_some();
    if edits_content {
        authorize(actor, Action::EditIssue { issue: &facts })?;
    }
    if patch.is_private.is_some_and(|p| p != facts.is_private) {
        authorize(actor, Action::SetIssuePrivate { issue: &facts })?;
    }
    if patch.event.is_some() && facts.issue_type != IssueType::Event {
        return Err(AppError::validation("invalid_event", "only events have event details"));
    }
    let title = patch.title.as_deref().map(validate_title).transpose()?;
    let reminders =
        patch.event.as_ref().and_then(|e| e.reminders.as_deref()).map(events::validate_reminders).transpose()?;

    let mut tx = db.begin().await?;
    let old = lock_open(&mut tx, issue_id, patch.version).await?;

    let new_title = title.unwrap_or_else(|| old.title.clone());
    let new_description = match patch.description {
        Some(d) => clean_text(d),
        None => old.description.clone(),
    };
    let new_priority = patch.priority.unwrap_or(old.priority);
    let new_private = patch.is_private.unwrap_or(old.is_private);

    sqlx::query!(
        r#"UPDATE issue SET title = $3, description = $4, priority = $5, is_private = $6, version = version + 1
           WHERE id = $1 AND version = $2"#,
        issue_id,
        patch.version,
        new_title,
        new_description,
        new_priority as Priority,
        new_private,
    )
    .execute(&mut *tx)
    .await?;

    let mut old_v = Map::new();
    let mut new_v = Map::new();
    let mut diff = |field: &str, before: Value, after: Value| {
        if before != after {
            old_v.insert(field.into(), before);
            new_v.insert(field.into(), after);
        }
    };
    diff("title", json!(old.title), json!(new_title));
    diff("description", json!(old.description), json!(new_description));
    diff("priority", json!(old.priority), json!(new_priority));
    diff("is_private", json!(old.is_private), json!(new_private));

    if let Some(ev) = patch.event {
        let cur = sqlx::query_as!(
            EventDetails,
            "SELECT starts_at, ends_at, all_day, location FROM issue_event WHERE issue_id = $1 FOR UPDATE",
            issue_id
        )
        .fetch_one(&mut *tx)
        .await?;
        let next = EventDetails {
            starts_at: ev.starts_at.unwrap_or(cur.starts_at),
            ends_at: ev.ends_at.unwrap_or(cur.ends_at),
            all_day: ev.all_day.unwrap_or(cur.all_day),
            location: match ev.location {
                Some(l) => clean_text(l),
                None => cur.location.clone(),
            },
        };
        validate_event(&next)?;
        sqlx::query!(
            "UPDATE issue_event SET starts_at = $2, ends_at = $3, all_day = $4, location = $5 WHERE issue_id = $1",
            issue_id,
            next.starts_at,
            next.ends_at,
            next.all_day,
            next.location,
        )
        .execute(&mut *tx)
        .await?;
        let (before, after) = (json!(cur), json!(next));
        if before != after {
            old_v.insert("event".into(), before);
            new_v.insert("event".into(), after);
        }
        if let Some(minutes) = &reminders {
            let current = sqlx::query_scalar!(
                "SELECT minutes_before FROM event_reminder WHERE issue_id = $1 ORDER BY minutes_before DESC",
                issue_id
            )
            .fetch_all(&mut *tx)
            .await?;
            if current != *minutes {
                events::set_reminders(&mut tx, issue_id, minutes).await?;
                old_v.insert("reminders".into(), json!(current));
                new_v.insert("reminders".into(), json!(minutes));
            }
        }
        let time_changed =
            cur.starts_at != next.starts_at || cur.ends_at != next.ends_at || cur.all_day != next.all_day;
        let location_changed = cur.location != next.location;
        events::on_changed(&mut tx, actor, issue_id, facts.branch_id, time_changed, location_changed).await?;
    }

    if !new_v.is_empty() {
        audit::record(
            &mut tx,
            AuditEntry {
                entity_type: "issue",
                entity_id: issue_id.to_string(),
                branch_id: facts.branch_id,
                actor_id: Some(actor.user_id),
                action: "update",
                old_value: Some(old_v.into()),
                new_value: Some(new_v.clone().into()),
            },
        )
        .await?;
        notify_owner(&mut tx, actor, &facts, json!({ "change": "edited", "fields": new_v.keys().collect::<Vec<_>>() }))
            .await?;
        emit(&mut tx, "issue_updated", issue_id).await?;
    }
    tx.commit().await?;
    detail(db, actor, issue_id).await
}

/// POST /issues/{id}/close and /cancel.
pub async fn close(
    db: &PgPool,
    actor: &Actor,
    issue_id: Uuid,
    version: i32,
    state: IssueState,
) -> AppResult<IssueDetail> {
    debug_assert!(state != IssueState::Open);
    let facts = readable(db, actor, issue_id).await?;
    authorize(actor, Action::CloseIssue { issue: &facts })?;

    let mut tx = db.begin().await?;
    lock_open(&mut tx, issue_id, version).await?;
    sqlx::query!(
        r#"UPDATE issue SET state = $3, closed_at = now(), closed_by = $4, version = version + 1
           WHERE id = $1 AND version = $2"#,
        issue_id,
        version,
        state as IssueState,
        actor.user_id,
    )
    .execute(&mut *tx)
    .await?;
    let action = if state == IssueState::Closed { "close" } else { "cancel" };
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "issue",
            entity_id: issue_id.to_string(),
            branch_id: facts.branch_id,
            actor_id: Some(actor.user_id),
            action,
            old_value: Some(json!({ "state": "open" })),
            new_value: Some(json!({ "state": state })),
        },
    )
    .await?;
    targets::cancel_items(&mut tx, Some(actor.user_id), issue_id, None, "issue_closed").await?;
    if facts.issue_type == IssueType::Event && state == IssueState::Cancelled {
        events::on_cancelled(&mut tx, actor, issue_id, facts.branch_id).await?;
    }
    notify_owner(&mut tx, actor, &facts, json!({ "change": action })).await?;
    emit(&mut tx, "issue_updated", issue_id).await?;
    tx.commit().await?;
    detail(db, actor, issue_id).await
}

struct OpenIssue {
    title: String,
    description: Option<String>,
    priority: Priority,
    is_private: bool,
}

/// Locks the issue, checks the client's version and that it is still open.
async fn lock_open(tx: &mut Tx, issue_id: Uuid, version: i32) -> AppResult<OpenIssue> {
    let row = sqlx::query!(
        r#"SELECT title, description, priority AS "priority: Priority", is_private, state AS "state: IssueState", version
           FROM issue WHERE id = $1 FOR UPDATE"#,
        issue_id
    )
    .fetch_one(&mut **tx)
    .await?;
    if row.version != version {
        return Err(AppError::version_conflict());
    }
    if row.state != IssueState::Open {
        return Err(AppError::conflict("issue_not_open", "the issue is closed or cancelled"));
    }
    Ok(OpenIssue { title: row.title, description: row.description, priority: row.priority, is_private: row.is_private })
}

/// Edits and closes by someone other than the creator notify the creator.
async fn notify_owner(tx: &mut Tx, actor: &Actor, facts: &IssueFacts, payload: Value) -> AppResult<()> {
    if facts.created_by == actor.user_id {
        return Ok(());
    }
    notifications::notify(
        tx,
        &[facts.created_by],
        Notice {
            kind: Kind::ChangedByAdmin,
            branch_id: facts.branch_id,
            issue_id: Some(facts.id),
            work_item_id: None,
            actor_id: Some(actor.user_id),
            payload,
        },
    )
    .await
}

// ---------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewTarget {
    #[serde(flatten)]
    pub target: TargetInput,
    /// For new work items; defaults to the issue's existing SLA, else the type default.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub sla_due_at: Option<OffsetDateTime>,
}

pub async fn add_target(db: &PgPool, actor: &Actor, issue_id: Uuid, input: NewTarget) -> AppResult<IssueDetail> {
    let facts = readable(db, actor, issue_id).await?;
    let target = targets::resolve(&input.target, facts.branch_id)?;
    authorize(actor, Action::TargetIssue { issue: &facts, whole_branch: target.kind == TargetKind::Branch })?;

    let mut tx = db.begin().await?;
    let issue = lock_ctx(&mut tx, issue_id).await?;
    let sla = if matches!(issue.issue_type, IssueType::Action | IssueType::Report) {
        let existing = match input.sla_due_at {
            Some(at) => Some(at),
            None => sqlx::query_scalar!(
                "SELECT sla_due_at FROM work_item WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 1",
                issue_id
            )
            .fetch_optional(&mut *tx)
            .await?
            .flatten(),
        };
        Some(sla_or_default(&mut tx, issue.issue_type, existing).await?)
    } else {
        None
    };
    targets::add(&mut tx, actor, issue, target, sla).await?;
    if issue.issue_type == IssueType::Event {
        events::sync_invitees(&mut tx, actor, issue_id).await?;
    }
    touch(&mut tx, issue_id).await?;
    emit(&mut tx, "issue_updated", issue_id).await?;
    tx.commit().await?;
    detail(db, actor, issue_id).await
}

pub async fn remove_target(db: &PgPool, actor: &Actor, issue_id: Uuid, target_id: Uuid) -> AppResult<IssueDetail> {
    let facts = readable(db, actor, issue_id).await?;
    let kind = sqlx::query_scalar!(
        r#"SELECT kind AS "kind: TargetKind" FROM issue_target WHERE id = $1 AND issue_id = $2 AND removed_at IS NULL"#,
        target_id,
        issue_id
    )
    .fetch_optional(db)
    .await?
    .ok_or(AppError::NotFound)?;
    authorize(actor, Action::TargetIssue { issue: &facts, whole_branch: kind == TargetKind::Branch })?;

    let mut tx = db.begin().await?;
    let issue = lock_ctx(&mut tx, issue_id).await?;
    let cancelled = targets::remove(&mut tx, actor, issue_id, target_id).await?;
    if issue.issue_type == IssueType::Event {
        events::prune_invitees(&mut tx, issue_id).await?;
    }
    if !cancelled.is_empty() {
        auto_close_if_done(&mut tx, issue_id).await?;
    }
    touch(&mut tx, issue_id).await?;
    emit(&mut tx, "issue_updated", issue_id).await?;
    tx.commit().await?;
    detail(db, actor, issue_id).await
}

/// Locks an open issue for target changes.
async fn lock_ctx(tx: &mut Tx, issue_id: Uuid) -> AppResult<IssueCtx> {
    let r = sqlx::query!(
        r#"SELECT i.branch_id, ty.code AS issue_type, i.completion_mode AS "completion_mode: CompletionMode",
                  i.state AS "state: IssueState"
           FROM issue i JOIN issue_type ty ON ty.id = i.type_id WHERE i.id = $1 FOR UPDATE OF i"#,
        issue_id
    )
    .fetch_one(&mut **tx)
    .await?;
    if r.state != IssueState::Open {
        return Err(AppError::conflict("issue_not_open", "the issue is closed or cancelled"));
    }
    Ok(IssueCtx {
        id: issue_id,
        branch_id: r.branch_id,
        issue_type: IssueType::from_code(&r.issue_type).ok_or_else(|| AppError::internal("unknown issue type"))?,
        completion_mode: r.completion_mode,
    })
}

/// Marks activity on the issue without changing its editable fields (the
/// version only tracks those).
async fn touch(tx: &mut Tx, issue_id: Uuid) -> AppResult<()> {
    sqlx::query!("UPDATE issue SET updated_at = now() WHERE id = $1", issue_id).execute(&mut **tx).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Auto-close, watchers, read tracking, history
// ---------------------------------------------------------------------------

/// When every work item of an open issue is approved or cancelled, the
/// system closes it (`closed_by = NULL`). Returns whether it closed.
pub(crate) async fn auto_close_if_done(tx: &mut Tx, issue_id: Uuid) -> AppResult<bool> {
    let closed = sqlx::query!(
        r#"
        UPDATE issue SET state = 'closed', closed_at = now(), closed_by = NULL, version = version + 1
        WHERE id = $1 AND state = 'open'
          AND EXISTS (SELECT 1 FROM work_item WHERE issue_id = $1)
          AND NOT EXISTS (SELECT 1 FROM work_item WHERE issue_id = $1 AND status NOT IN ('approved', 'cancelled'))
        RETURNING branch_id
        "#,
        issue_id
    )
    .fetch_optional(&mut **tx)
    .await?;
    let Some(row) = closed else { return Ok(false) };
    audit::record(
        tx,
        AuditEntry {
            entity_type: "issue",
            entity_id: issue_id.to_string(),
            branch_id: row.branch_id,
            actor_id: None,
            action: "auto_close",
            old_value: Some(json!({ "state": "open" })),
            new_value: Some(json!({ "state": "closed", "reason": "all_work_done" })),
        },
    )
    .await?;
    Ok(true)
}

pub async fn set_watching(db: &PgPool, actor: &Actor, issue_id: Uuid, watching: bool) -> AppResult<()> {
    readable(db, actor, issue_id).await?;
    if watching {
        sqlx::query!(
            "INSERT INTO issue_watcher (issue_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            issue_id,
            actor.user_id
        )
        .execute(db)
        .await?;
    } else {
        sqlx::query!("DELETE FROM issue_watcher WHERE issue_id = $1 AND user_id = $2", issue_id, actor.user_id)
            .execute(db)
            .await?;
    }
    Ok(())
}

pub async fn mark_read(db: &PgPool, actor: &Actor, issue_id: Uuid) -> AppResult<()> {
    readable(db, actor, issue_id).await?;
    sqlx::query!(
        r#"INSERT INTO issue_read (user_id, issue_id, last_read_at) VALUES ($1, $2, now())
           ON CONFLICT (user_id, issue_id) DO UPDATE SET last_read_at = now()"#,
        actor.user_id,
        issue_id
    )
    .execute(db)
    .await?;
    Ok(())
}

/// One audit row about the issue.
///
/// | `entity_type`   | `action`                                                        |
/// |-----------------|-----------------------------------------------------------------|
/// | `issue`         | `create`, `update`, `close`, `cancel`, `auto_close`             |
/// | `issue_target`  | `add`, `remove`                                                 |
/// | `work_item`     | `create`, `start`, `block`, `unblock`, `submit`, `approve`, `reject`, `claim`, `assign`, `cancel`, `unassign` |
/// | `issue_comment` | `delete`                                                        |
///
/// `old_value` / `new_value` hold only the changed fields; times in them are
/// RFC 3339.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct HistoryEntry {
    pub id: i64,
    pub entity_type: String,
    pub entity_id: String,
    /// The branch the row is about: the work item's or target's branch, or the
    /// issue's (`null` for a school-wide issue).
    pub branch_id: Option<Uuid>,
    /// `work_item` entries: the item's current assignee (`null` = unassigned).
    pub assignee_id: Option<Uuid>,
    /// `null` = the system (jobs, auto-close).
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
    /// Rows written by one request share a `batch_id` (the `id` of the first
    /// of them), e.g. an issue with its targets and work items, or an approval
    /// and the auto-close it caused.
    pub batch_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

/// Audit rows about the issue, its targets, its work items and its
/// comments (internal ones only for actors who see internal comments).
pub async fn history(db: &PgPool, actor: &Actor, issue_id: Uuid, page: &PageParams) -> AppResult<Page<HistoryEntry>> {
    let facts = readable(db, actor, issue_id).await?;
    let internal = comments::sees_internal(actor, &facts);
    let limit = page.limit()?;
    let after: Option<i64> = page.cursor()?;
    let rows = sqlx::query_as!(
        HistoryEntry,
        r#"
        WITH rows AS (
            SELECT a.id, a.entity_type, a.entity_id, a.branch_id, w.assignee_id, a.actor_id, a.action,
                   a.old_value, a.new_value, a.created_at,
                   -- One transaction's rows share created_at (now() is the transaction start).
                   min(a.id) OVER (PARTITION BY a.created_at) AS batch_id
            FROM audit_log a
            LEFT JOIN work_item w ON a.entity_type = 'work_item' AND w.id::text = a.entity_id
            WHERE (a.entity_type = 'issue' AND a.entity_id = $1::uuid::text)
               OR (a.entity_type = 'issue_target'
                   AND a.entity_id IN (SELECT id::text FROM issue_target WHERE issue_id = $1))
               OR (a.entity_type = 'work_item'
                   AND a.entity_id IN (SELECT id::text FROM work_item WHERE issue_id = $1))
               OR (a.entity_type = 'issue_comment'
                   AND a.entity_id IN (SELECT id::text FROM issue_comment
                                       WHERE issue_id = $1 AND ($4 OR NOT is_internal_only)))
        )
        SELECT id AS "id!", entity_type AS "entity_type!", entity_id AS "entity_id!", branch_id, assignee_id,
               actor_id, action AS "action!", old_value, new_value, batch_id AS "batch_id!",
               created_at AS "created_at!"
        FROM rows
        WHERE $2::bigint IS NULL OR id > $2
        ORDER BY id
        LIMIT $3
        "#,
        issue_id,
        after,
        limit + 1,
        internal,
    )
    .fetch_all(db)
    .await?;
    Ok(Page::from_rows(rows, limit, |h| h.id))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Signals a change to the branches the issue lives in.
pub(crate) async fn emit(tx: &mut Tx, kind: &'static str, issue_id: Uuid) -> AppResult<()> {
    let branch_ids = sqlx::query_scalar!(
        r#"SELECT branch_id AS "branch_id!" FROM issue WHERE id = $1 AND branch_id IS NOT NULL
           UNION SELECT branch_id FROM issue_target WHERE issue_id = $1 AND removed_at IS NULL"#,
        issue_id
    )
    .fetch_all(&mut **tx)
    .await?;
    realtime::emit(tx, realtime::Event { kind, issue_id: Some(issue_id), branch_ids, recipient_ids: vec![] }).await
}

fn validate_title(title: &str) -> AppResult<String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err(AppError::validation("invalid_title", "title must be between 1 and 200 characters"));
    }
    Ok(title.to_owned())
}

fn validate_event(e: &EventDetails) -> AppResult<()> {
    if e.ends_at < e.starts_at {
        return Err(AppError::validation("invalid_event_range", "an event must end after it starts"));
    }
    Ok(())
}

fn clean_text(text: Option<String>) -> Option<String> {
    text.map(|t| t.trim().to_owned()).filter(|t| !t.is_empty())
}
