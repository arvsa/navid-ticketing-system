//! `GET /api/exports` (BACKEND_PLAN.md section 10): an Excel workbook of a
//! branch (admins, `export.run`) or several or all branches (super admins).
//!
//! Sheets: Tickets, Actions (one row per work item), Reports (one row per
//! submitted report), Events. Bold, frozen header row with an auto-filter;
//! dates in the row's branch timezone. Contents go through the same
//! visibility filter as every list, and comment counts include internal
//! comments only for actors who may see them.
//!
//! The optional date range applies to each sheet's main date: created for
//! tickets and actions, submitted for reports, start for events.

use rust_xlsxwriter::{ExcelDateTime, Format, Workbook, Worksheet, XlsxError};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;
use time_tz::OffsetDateTimeExt;
use uuid::Uuid;

use super::audit::{self, AuditEntry};
use crate::{
    authz::{authorize, Action, Actor, IssueFilter, IssueType},
    error::{AppError, AppResult},
};

pub const MAX_ROWS: usize = 50_000;
/// Excel's cell limit is 32,767 characters.
pub const MAX_BODY_CHARS: usize = 32_000;

#[derive(Debug, Clone)]
pub struct ExportQuery {
    /// `None` = every branch (super admins only).
    pub branch_ids: Option<Vec<Uuid>>,
    pub types: Vec<IssueType>,
    pub from: Option<OffsetDateTime>,
    pub to: Option<OffsetDateTime>,
}

pub struct ExportFile {
    pub file_name: String,
    pub bytes: Vec<u8>,
}

pub async fn run(db: &PgPool, actor: &Actor, q: ExportQuery) -> AppResult<ExportFile> {
    if let (Some(from), Some(to)) = (q.from, q.to) {
        if to <= from {
            return Err(AppError::validation("invalid_range", "`to` must be after `from`"));
        }
    }
    let all = sqlx::query!("SELECT id, code FROM branch ORDER BY code").fetch_all(db).await?;
    let branch_ids: Vec<Uuid> = match &q.branch_ids {
        Some(ids) => {
            // An unknown branch looks the same as one you can't see.
            if ids.iter().any(|id| !all.iter().any(|b| b.id == *id)) {
                return Err(AppError::NotFound);
            }
            ids.clone()
        }
        None => all.iter().map(|b| b.id).collect(),
    };
    if branch_ids.is_empty() {
        return Err(AppError::validation("invalid_query", "no branches to export"));
    }
    authorize(actor, Action::Export { branch_ids: &branch_ids })?;
    let types: Vec<IssueType> = if q.types.is_empty() {
        vec![IssueType::Ticket, IssueType::Action, IssueType::Report, IssueType::Event]
    } else {
        q.types.clone()
    };
    let want = |t: IssueType| types.contains(&t);
    let filter = IssueFilter::for_actor(actor).into_json();
    let fetch_limit = (MAX_ROWS + 1) as i64;

    let tickets = if want(IssueType::Ticket) {
        sqlx::query!(
            r#"
            SELECT i.number, i.title, i.state::text AS "state!", i.created_at, i.closed_at,
                   coalesce(b.code, (SELECT string_agg(DISTINCT bb.code, ', ') FROM issue_target t
                                     JOIN branch bb ON bb.id = t.branch_id
                                     WHERE t.issue_id = i.id AND t.removed_at IS NULL)) AS branch,
                   coalesce(b.timezone, 'UTC') AS "timezone!",
                   u.first_name || ' ' || u.last_name AS "created_by!",
                   (SELECT count(*) FROM issue_comment c
                    WHERE c.issue_id = i.id AND c.deleted_at IS NULL
                      AND (NOT c.is_internal_only
                           OR coalesce(($1::jsonb->>'super')::boolean, false)
                           OR $1::jsonb->'internal' ? i.branch_id::text
                           OR (i.branch_id IS NULL AND EXISTS (
                                 SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.removed_at IS NULL
                                   AND $1::jsonb->'internal' ? t.branch_id::text)))) AS "comments!"
            FROM issue i
            JOIN issue_type ty ON ty.id = i.type_id AND ty.code = 'ticket'
            LEFT JOIN branch b ON b.id = i.branch_id
            JOIN app_user u ON u.id = i.created_by
            WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
              AND (i.branch_id = ANY($2) OR (i.branch_id IS NULL AND EXISTS (
                    SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = ANY($2) AND t.removed_at IS NULL)))
              AND ($3::timestamptz IS NULL OR i.created_at >= $3)
              AND ($4::timestamptz IS NULL OR i.created_at < $4)
            ORDER BY i.number
            LIMIT $5
            "#,
            filter,
            &branch_ids,
            q.from,
            q.to,
            fetch_limit,
        )
        .fetch_all(db)
        .await?
    } else {
        vec![]
    };

    let actions = if want(IssueType::Action) {
        sqlx::query!(
            r#"
            SELECT i.number, i.title, b.code AS branch, b.timezone, w.status AS "status!: String",
                   w.sla_due_at, w.is_overdue AS "is_overdue!", w.submitted_at, w.decided_at,
                   a.first_name || ' ' || a.last_name AS assignee,
                   d.first_name || ' ' || d.last_name AS decided_by
            FROM work_item_overview w
            JOIN issue i ON i.id = w.issue_id
            JOIN issue_type ty ON ty.id = i.type_id AND ty.code = 'action'
            JOIN branch b ON b.id = w.branch_id
            LEFT JOIN app_user a ON a.id = w.assignee_id
            LEFT JOIN app_user d ON d.id = w.decided_by
            WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
              AND w.branch_id = ANY($2)
              AND ($3::timestamptz IS NULL OR i.created_at >= $3)
              AND ($4::timestamptz IS NULL OR i.created_at < $4)
            ORDER BY i.number, w.created_at, w.id
            LIMIT $5
            "#,
            filter,
            &branch_ids,
            q.from,
            q.to,
            fetch_limit,
        )
        .fetch_all(db)
        .await?
    } else {
        vec![]
    };

    let reports = if want(IssueType::Report) {
        sqlx::query!(
            r#"
            SELECT i.number, i.title, b.code AS "branch?", coalesce(b.timezone, 'UTC') AS "timezone!",
                   u.first_name || ' ' || u.last_name AS "author!", r.submitted_at AS "submitted_at!",
                   coalesce(w.status::text, 'self_filed') AS "approval!", left(r.body, $6) AS "body!"
            FROM issue_report r
            JOIN issue i ON i.id = r.issue_id
            LEFT JOIN work_item w ON w.id = r.work_item_id
            LEFT JOIN branch b ON b.id = coalesce(w.branch_id, i.branch_id)
            JOIN app_user u ON u.id = r.author_id
            WHERE r.submitted_at IS NOT NULL
              AND issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
              AND coalesce(w.branch_id, i.branch_id) = ANY($2)
              AND ($3::timestamptz IS NULL OR r.submitted_at >= $3)
              AND ($4::timestamptz IS NULL OR r.submitted_at < $4)
            ORDER BY i.number, r.submitted_at, r.id
            LIMIT $5
            "#,
            filter,
            &branch_ids,
            q.from,
            q.to,
            fetch_limit,
            MAX_BODY_CHARS as i32,
        )
        .fetch_all(db)
        .await?
    } else {
        vec![]
    };

    let events = if want(IssueType::Event) {
        sqlx::query!(
            r#"
            SELECT i.number, i.title, e.starts_at, e.ends_at, e.location,
                   coalesce(b.code, (SELECT string_agg(DISTINCT bb.code, ', ') FROM issue_target t
                                     JOIN branch bb ON bb.id = t.branch_id
                                     WHERE t.issue_id = i.id AND t.removed_at IS NULL)) AS branch,
                   coalesce(b.timezone, 'UTC') AS "timezone!",
                   count(r.user_id) FILTER (WHERE r.response = 'going') AS "going!",
                   count(r.user_id) FILTER (WHERE r.response = 'maybe') AS "maybe!",
                   count(r.user_id) FILTER (WHERE r.response = 'declined') AS "declined!",
                   count(r.user_id) FILTER (WHERE r.response = 'pending') AS "pending!"
            FROM issue_event e
            JOIN issue i ON i.id = e.issue_id
            LEFT JOIN branch b ON b.id = i.branch_id
            LEFT JOIN event_rsvp r ON r.issue_id = i.id
            WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)
              AND (i.branch_id = ANY($2) OR (i.branch_id IS NULL AND EXISTS (
                    SELECT 1 FROM issue_target t WHERE t.issue_id = i.id AND t.branch_id = ANY($2) AND t.removed_at IS NULL)))
              AND ($3::timestamptz IS NULL OR e.starts_at >= $3)
              AND ($4::timestamptz IS NULL OR e.starts_at < $4)
            GROUP BY i.id, e.issue_id, b.id
            ORDER BY e.starts_at, i.number
            LIMIT $5
            "#,
            filter,
            &branch_ids,
            q.from,
            q.to,
            fetch_limit,
        )
        .fetch_all(db)
        .await?
    } else {
        vec![]
    };

    let total = tickets.len() + actions.len() + reports.len() + events.len();
    if total > MAX_ROWS {
        return Err(AppError::validation(
            "export_too_large",
            format!("the export would exceed {MAX_ROWS} rows; choose a narrower date range"),
        ));
    }

    // Build the workbook.
    let x = |e: XlsxError| AppError::internal(format!("building the workbook: {e}"));
    let mut wb = Workbook::new();
    let header = Format::new().set_bold();
    let date = Format::new().set_num_format("yyyy-mm-dd hh:mm");

    if want(IssueType::Ticket) {
        let ws = sheet(
            &mut wb,
            "Tickets",
            &header,
            &[
                ("Number", 10.0),
                ("Title", 40.0),
                ("Branch", 10.0),
                ("Created by", 22.0),
                ("Created at", 17.0),
                ("State", 11.0),
                ("Closed at", 17.0),
                ("Comments", 10.0),
            ],
        )
        .map_err(x)?;
        for (i, t) in tickets.iter().enumerate() {
            let r = (i + 1) as u32;
            ws.write_string(r, 0, format!("ISS-{}", t.number)).map_err(x)?;
            ws.write_string(r, 1, &t.title).map_err(x)?;
            ws.write_string(r, 2, t.branch.as_deref().unwrap_or("")).map_err(x)?;
            ws.write_string(r, 3, &t.created_by).map_err(x)?;
            write_time(ws, r, 4, Some(t.created_at), &t.timezone, &date).map_err(x)?;
            ws.write_string(r, 5, &t.state).map_err(x)?;
            write_time(ws, r, 6, t.closed_at, &t.timezone, &date).map_err(x)?;
            ws.write_number(r, 7, t.comments as f64).map_err(x)?;
        }
        finish(ws, tickets.len(), 7).map_err(x)?;
    }
    if want(IssueType::Action) {
        let ws = sheet(
            &mut wb,
            "Actions",
            &header,
            &[
                ("Number", 10.0),
                ("Title", 40.0),
                ("Branch", 10.0),
                ("Assignee", 22.0),
                ("Status", 16.0),
                ("SLA due", 17.0),
                ("Overdue", 9.0),
                ("Submitted at", 17.0),
                ("Decided by", 22.0),
                ("Decided at", 17.0),
            ],
        )
        .map_err(x)?;
        for (i, a) in actions.iter().enumerate() {
            let r = (i + 1) as u32;
            ws.write_string(r, 0, format!("ISS-{}", a.number)).map_err(x)?;
            ws.write_string(r, 1, &a.title).map_err(x)?;
            ws.write_string(r, 2, &a.branch).map_err(x)?;
            ws.write_string(r, 3, a.assignee.as_deref().unwrap_or("")).map_err(x)?;
            ws.write_string(r, 4, &a.status).map_err(x)?;
            write_time(ws, r, 5, a.sla_due_at, &a.timezone, &date).map_err(x)?;
            ws.write_string(r, 6, if a.is_overdue { "yes" } else { "no" }).map_err(x)?;
            write_time(ws, r, 7, a.submitted_at, &a.timezone, &date).map_err(x)?;
            ws.write_string(r, 8, a.decided_by.as_deref().unwrap_or("")).map_err(x)?;
            write_time(ws, r, 9, a.decided_at, &a.timezone, &date).map_err(x)?;
        }
        finish(ws, actions.len(), 9).map_err(x)?;
    }
    if want(IssueType::Report) {
        let ws = sheet(
            &mut wb,
            "Reports",
            &header,
            &[
                ("Number", 10.0),
                ("Issue title", 36.0),
                ("Branch", 10.0),
                ("Author", 22.0),
                ("Submitted at", 17.0),
                ("Approval", 16.0),
                ("Body", 80.0),
            ],
        )
        .map_err(x)?;
        for (i, rep) in reports.iter().enumerate() {
            let r = (i + 1) as u32;
            ws.write_string(r, 0, format!("ISS-{}", rep.number)).map_err(x)?;
            ws.write_string(r, 1, &rep.title).map_err(x)?;
            ws.write_string(r, 2, rep.branch.as_deref().unwrap_or("")).map_err(x)?;
            ws.write_string(r, 3, &rep.author).map_err(x)?;
            write_time(ws, r, 4, Some(rep.submitted_at), &rep.timezone, &date).map_err(x)?;
            ws.write_string(r, 5, &rep.approval).map_err(x)?;
            ws.write_string(r, 6, &rep.body).map_err(x)?;
        }
        finish(ws, reports.len(), 6).map_err(x)?;
    }
    if want(IssueType::Event) {
        let ws = sheet(
            &mut wb,
            "Events",
            &header,
            &[
                ("Number", 10.0),
                ("Title", 36.0),
                ("Branch", 10.0),
                ("Starts", 17.0),
                ("Ends", 17.0),
                ("Location", 20.0),
                ("Going", 8.0),
                ("Maybe", 8.0),
                ("Declined", 9.0),
                ("Pending", 9.0),
            ],
        )
        .map_err(x)?;
        for (i, e) in events.iter().enumerate() {
            let r = (i + 1) as u32;
            ws.write_string(r, 0, format!("ISS-{}", e.number)).map_err(x)?;
            ws.write_string(r, 1, &e.title).map_err(x)?;
            ws.write_string(r, 2, e.branch.as_deref().unwrap_or("")).map_err(x)?;
            write_time(ws, r, 3, Some(e.starts_at), &e.timezone, &date).map_err(x)?;
            write_time(ws, r, 4, Some(e.ends_at), &e.timezone, &date).map_err(x)?;
            ws.write_string(r, 5, e.location.as_deref().unwrap_or("")).map_err(x)?;
            for (col, n) in [(6, e.going), (7, e.maybe), (8, e.declined), (9, e.pending)] {
                ws.write_number(r, col, n as f64).map_err(x)?;
            }
        }
        finish(ws, events.len(), 9).map_err(x)?;
    }
    let bytes = wb.save_to_buffer().map_err(x)?;

    // Audit the export with its parameters.
    let codes: Vec<String> = all.iter().filter(|b| branch_ids.contains(&b.id)).map(|b| b.code.clone()).collect();
    let mut tx = db.begin().await?;
    audit::record(
        &mut tx,
        AuditEntry {
            entity_type: "export",
            entity_id: Uuid::new_v4().to_string(),
            branch_id: (branch_ids.len() == 1).then(|| branch_ids[0]),
            actor_id: Some(actor.user_id),
            action: "export",
            old_value: None,
            new_value: Some(json!({
                "branch_ids": branch_ids, "all_branches": q.branch_ids.is_none(),
                "types": types.iter().map(|t| t.code()).collect::<Vec<_>>(),
                "from": q.from.map(|t| t.unix_timestamp()), "to": q.to.map(|t| t.unix_timestamp()),
                "rows": { "tickets": tickets.len(), "actions": actions.len(), "reports": reports.len(), "events": events.len() },
            })),
        },
    )
    .await?;
    tx.commit().await?;

    let label = if q.branch_ids.is_none() { "all".to_owned() } else { codes.join("-") };
    let today = OffsetDateTime::now_utc().date();
    Ok(ExportFile { file_name: format!("export-{label}-{today}.xlsx"), bytes })
}

fn sheet<'a>(
    wb: &'a mut Workbook,
    name: &str,
    header: &Format,
    columns: &[(&str, f64)],
) -> Result<&'a mut Worksheet, XlsxError> {
    let ws = wb.add_worksheet();
    ws.set_name(name)?;
    for (col, (title, width)) in columns.iter().enumerate() {
        ws.write_string_with_format(0, col as u16, *title, header)?;
        ws.set_column_width(col as u16, *width)?;
    }
    ws.set_freeze_panes(1, 0)?;
    Ok(ws)
}

fn finish(ws: &mut Worksheet, rows: usize, last_col: u16) -> Result<(), XlsxError> {
    ws.autofilter(0, 0, rows as u32, last_col)?;
    Ok(())
}

/// Writes a timestamp as an Excel date in the branch's timezone.
fn write_time(
    ws: &mut Worksheet,
    row: u32,
    col: u16,
    at: Option<OffsetDateTime>,
    tz: &str,
    format: &Format,
) -> Result<(), XlsxError> {
    let Some(at) = at else { return Ok(()) };
    let local = match time_tz::timezones::get_by_name(tz) {
        Some(zone) => at.to_timezone(zone),
        None => at,
    };
    let dt = ExcelDateTime::from_ymd(local.year() as u16, local.month() as u8, local.day())?.and_hms(
        local.hour() as u16,
        local.minute(),
        local.second(),
    )?;
    ws.write_datetime_with_format(row, col, dt, format)?;
    Ok(())
}
