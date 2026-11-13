use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderValue},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use super::json::ApiQuery;
use crate::{
    authz::Actor,
    domain::{
        dashboard::{self, Dashboard},
        exports::{self, ExportQuery, ItemFilters},
        issues,
        types::IssueState,
    },
    error::{AppError, AppResult},
    AppState,
};

const XLSX: &str = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/dashboard", get(show))
        .route("/exports", get(export))
        .route("/exports/people", get(export_people))
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct DashboardParams {
    branch_id: Option<Uuid>,
}

#[utoipa::path(get, path = "/api/dashboard", operation_id = "getDashboard", tag = "dashboard", params(DashboardParams), responses((status = 200, body = Dashboard), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn show(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<DashboardParams>,
) -> AppResult<Json<Dashboard>> {
    Ok(Json(dashboard::get(&s.db, &actor, q.branch_id).await?))
}

/// Comma-separated lists, RFC 3339 times.
#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct ExportParams {
    branch_ids: Option<String>,
    types: Option<String>,
    from: Option<String>,
    to: Option<String>,
    /// The items list's filters: only issues in this state.
    state: Option<IssueState>,
    /// Comma-separated: any of these priorities.
    priority: Option<String>,
    /// Comma-separated: issues with at least one of these tags.
    tags: Option<String>,
    /// Title contains this text.
    q: Option<String>,
    /// `created`: `from`/`to` are on when each issue was created, on every
    /// sheet (as on the items list), not each sheet's main date.
    dates: Option<String>,
}

fn invalid(msg: &'static str) -> AppError {
    AppError::validation("invalid_query", msg)
}

fn parse_list<T>(raw: Option<&str>, parse: impl Fn(&str) -> Option<T>, msg: &'static str) -> AppResult<Option<Vec<T>>> {
    let Some(raw) = raw.map(str::trim).filter(|r| !r.is_empty()) else { return Ok(None) };
    raw.split(',').map(|part| parse(part.trim()).ok_or_else(|| invalid(msg))).collect::<AppResult<Vec<T>>>().map(Some)
}

fn parse_time(raw: Option<&str>) -> AppResult<Option<OffsetDateTime>> {
    raw.map(|t| OffsetDateTime::parse(t, &Rfc3339).map_err(|_| invalid("`from` and `to` are RFC 3339 times")))
        .transpose()
}

/// GET /api/exports?branch_ids=&types=ticket,report,event,action&from=&to=&state=&priority=&tags=&q=&dates=created
#[utoipa::path(get, path = "/api/exports", operation_id = "exportIssues", tag = "dashboard", params(ExportParams), responses((status = 200, description = "An Excel workbook", content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn export(State(s): State<AppState>, actor: Actor, ApiQuery(q): ApiQuery<ExportParams>) -> AppResult<Response> {
    let query = ExportQuery {
        branch_ids: parse_list(q.branch_ids.as_deref(), |p| p.parse().ok(), "branch_ids are UUIDs")?,
        types: parse_list(q.types.as_deref(), exports::Sheet::from_code, "types are ticket, report, event, action")?
            .unwrap_or_default(),
        from: parse_time(q.from.as_deref())?,
        to: parse_time(q.to.as_deref())?,
        items: ItemFilters {
            state: q.state,
            priorities: issues::parse_priorities(q.priority.as_deref())?,
            tags: issues::parse_tags(q.tags.as_deref())?,
            q: q.q,
            by_created: match q.dates.as_deref() {
                None => false,
                Some("created") => true,
                Some(_) => return Err(invalid("`dates` is only `created`")),
            },
        },
    };
    xlsx(exports::run(&s.db, &actor, query).await?)
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
struct PeopleExportParams {
    /// Comma-separated; leave out for every branch.
    branch_ids: Option<String>,
}

/// GET /api/exports/people?branch_ids= (super admins)
#[utoipa::path(get, path = "/api/exports/people", operation_id = "exportPeople", tag = "dashboard", params(PeopleExportParams), responses((status = 200, description = "An Excel workbook", content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), (status = "4XX", description = "Error; see the codes in the README", body = crate::http::openapi::ErrorResponse)))]
async fn export_people(
    State(s): State<AppState>,
    actor: Actor,
    ApiQuery(q): ApiQuery<PeopleExportParams>,
) -> AppResult<Response> {
    let branch_ids = parse_list(q.branch_ids.as_deref(), |p| p.parse().ok(), "branch_ids are UUIDs")?;
    xlsx(exports::people(&s.db, &actor, branch_ids).await?)
}

fn xlsx(file: exports::ExportFile) -> AppResult<Response> {
    let disposition = format!("attachment; filename=\"{}\"", file.file_name);
    Ok((
        [
            (header::CONTENT_TYPE, HeaderValue::from_static(XLSX)),
            (header::CONTENT_DISPOSITION, HeaderValue::from_str(&disposition).map_err(AppError::internal)?),
            (header::CACHE_CONTROL, HeaderValue::from_static("private, no-store")),
        ],
        Body::from(file.bytes),
    )
        .into_response())
}
