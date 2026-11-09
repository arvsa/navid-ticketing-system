//! Issue templates (`issue_template`): named starting points for new issues,
//! school-wide and run by super admins; everyone signed in reads them. A
//! template fixes the issue's type, adds its tag, and for actions can require
//! a written report for each piece of work (the built-in Report template).
//!
//! `fields` is reserved for custom fields and is always `[]` for now.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use super::{
    audit::{self, AuditEntry},
    branches::double_option,
};
use crate::{
    authz::{authorize, Action, Actor, IssueType},
    db::Tx,
    error::{AppError, AppResult},
    realtime,
};

pub const MAX_TAGS: usize = 10;
const MAX_TAG_CHARS: usize = 40;

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Template {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    /// The type of the issues it makes.
    #[serde(rename = "type")]
    pub issue_type: String,
    /// Put on every issue made from it.
    pub tag: Option<String>,
    /// Actions only: each piece of work needs a submitted written report.
    pub requires_report: bool,
    /// Default due time for its work; falls back to the type's.
    pub default_sla_hours: Option<i32>,
    /// Reserved for custom fields.
    #[schema(value_type = Vec<Object>)]
    pub fields: Value,
    pub position: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub archived_at: Option<OffsetDateTime>,
    pub version: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Default, Deserialize, utoipa::IntoParams)]
pub struct TemplateQuery {
    /// Super admins only.
    #[serde(default)]
    pub include_archived: bool,
}

pub async fn list(db: &PgPool, actor: &Actor, query: &TemplateQuery) -> AppResult<Vec<Template>> {
    let archived = query.include_archived && actor.is_super_admin;
    Ok(sqlx::query_as!(
        Template,
        r#"
        SELECT t.id, t.name, t.description, ty.code AS issue_type, t.tag, t.requires_report, t.default_sla_hours,
               t.fields, t.position, t.archived_at, t.version, t.created_at, t.updated_at
        FROM issue_template t JOIN issue_type ty ON ty.id = t.type_id
        WHERE $1 OR t.archived_at IS NULL
        ORDER BY t.archived_at IS NOT NULL, t.position, lower(t.name), t.id
        "#,
        archived,
    )
    .fetch_all(db)
    .await?)
}

async fn fetch(tx: &mut Tx, id: Uuid) -> AppResult<Template> {
    sqlx::query_as!(
        Template,
        r#"
        SELECT t.id, t.name, t.description, ty.code AS issue_type, t.tag, t.requires_report, t.default_sla_hours,
               t.fields, t.position, t.archived_at, t.version, t.created_at, t.updated_at
        FROM issue_template t JOIN issue_type ty ON ty.id = t.type_id
        WHERE t.id = $1
        "#,
        id,
    )
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AppError::NotFound)
}

/// What issue creation takes from a template.
pub(crate) struct Applied {
    pub tag: Option<String>,
    pub requires_report: bool,
    pub default_sla_hours: Option<i32>,
}

/// The template an issue is being made from: it must be in use and of the
/// issue's type.
pub(crate) async fn for_new_issue(tx: &mut Tx, id: Uuid, issue_type: IssueType) -> AppResult<Applied> {
    let t = fetch(tx, id).await.map_err(|e| match e {
        AppError::NotFound => AppError::validation("invalid_template", "no such template"),
        e => e,
    })?;
    if t.archived_at.is_some() {
        return Err(AppError::validation("invalid_template", "the template is archived"));
    }
    if t.issue_type != issue_type.code() {
        return Err(AppError::validation("invalid_template", format!("the template makes {}s", t.issue_type)));
    }
    Ok(Applied { tag: t.tag, requires_report: t.requires_report, default_sla_hours: t.default_sla_hours })
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
pub struct NewTemplate {
    pub name: String,
    pub description: Option<String>,
    /// `ticket`, `action` or `event`; can't change later.
    #[serde(rename = "type")]
    pub issue_type: String,
    pub tag: Option<String>,
    #[serde(default)]
    pub requires_report: bool,
    pub default_sla_hours: Option<i32>,
}

pub async fn create(db: &PgPool, actor: &Actor, input: NewTemplate) -> AppResult<Template> {
    authorize(actor, Action::ManageTemplates)?;
    let issue_type = IssueType::from_code(&input.issue_type)
        .ok_or_else(|| AppError::validation("invalid_issue_type", "type must be ticket, action or event"))?;
    let name = validate_name(&input.name)?;
    let description = validate_description(input.description)?;
    let tag = input.tag.as_deref().map(normalize_tag).transpose()?.flatten();
    check_rules(issue_type, input.requires_report, input.default_sla_hours)?;

    let mut tx = db.begin().await?;
    name_free(&mut tx, &name, None).await?;
    let id = sqlx::query_scalar!(
        r#"
        INSERT INTO issue_template (name, description, type_id, tag, requires_report, default_sla_hours, position, created_by)
        VALUES ($1, $2, (SELECT id FROM issue_type WHERE code = $3), $4, $5, $6,
                (SELECT coalesce(max(position), 0) + 1 FROM issue_template), $7)
        RETURNING id
        "#,
        name,
        description,
        issue_type.code(),
        tag,
        input.requires_report,
        input.default_sla_hours,
        actor.user_id,
    )
    .fetch_one(&mut *tx)
    .await?;
    let t = fetch(&mut tx, id).await?;
    record(&mut tx, actor, &t, "create", None).await?;
    tx.commit().await?;
    Ok(t)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct TemplatePatch {
    /// The version the client last saw.
    pub version: i32,
    pub name: Option<String>,
    #[serde(default, with = "double_option")]
    pub description: Option<Option<String>>,
    #[serde(default, with = "double_option")]
    pub tag: Option<Option<String>>,
    pub requires_report: Option<bool>,
    #[serde(default, with = "double_option")]
    pub default_sla_hours: Option<Option<i32>>,
    pub position: Option<i32>,
    /// `true` archives (hidden from new issues), `false` restores.
    pub archived: Option<bool>,
}

/// Changes apply to new issues only: issues already made keep their tags and
/// report rule.
pub async fn update(db: &PgPool, actor: &Actor, id: Uuid, patch: TemplatePatch) -> AppResult<Template> {
    authorize(actor, Action::ManageTemplates)?;
    let mut tx = db.begin().await?;
    sqlx::query!("SELECT id FROM issue_template WHERE id = $1 FOR UPDATE", id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
    let old = fetch(&mut tx, id).await?;
    if old.version != patch.version {
        return Err(AppError::version_conflict());
    }
    let issue_type = IssueType::from_code(&old.issue_type).ok_or_else(|| AppError::internal("unknown issue type"))?;

    let name = match &patch.name {
        Some(n) => validate_name(n)?,
        None => old.name.clone(),
    };
    let description = match patch.description {
        Some(d) => validate_description(d)?,
        None => old.description.clone(),
    };
    let tag = match &patch.tag {
        Some(t) => t.as_deref().map(normalize_tag).transpose()?.flatten(),
        None => old.tag.clone(),
    };
    let requires_report = patch.requires_report.unwrap_or(old.requires_report);
    let default_sla_hours = patch.default_sla_hours.unwrap_or(old.default_sla_hours);
    check_rules(issue_type, requires_report, default_sla_hours)?;
    let position = patch.position.unwrap_or(old.position);
    let archived_at = match patch.archived {
        Some(true) => old.archived_at.or(Some(OffsetDateTime::now_utc())),
        Some(false) => None,
        None => old.archived_at,
    };
    if archived_at.is_none() {
        name_free(&mut tx, &name, Some(id)).await?;
    }

    sqlx::query!(
        r#"
        UPDATE issue_template
        SET name = $2, description = $3, tag = $4, requires_report = $5, default_sla_hours = $6,
            position = $7, archived_at = $8, version = version + 1, updated_at = now()
        WHERE id = $1
        "#,
        id,
        name,
        description,
        tag,
        requires_report,
        default_sla_hours,
        position,
        archived_at,
    )
    .execute(&mut *tx)
    .await?;
    let t = fetch(&mut tx, id).await?;
    record(&mut tx, actor, &t, "update", Some(&old)).await?;
    tx.commit().await?;
    Ok(t)
}

async fn record(tx: &mut Tx, actor: &Actor, t: &Template, action: &'static str, old: Option<&Template>) -> AppResult<()> {
    audit::record(
        tx,
        AuditEntry {
            entity_type: "issue_template",
            entity_id: t.id.to_string(),
            branch_id: None,
            actor_id: Some(actor.user_id),
            action,
            old_value: old.map(snapshot),
            new_value: Some(snapshot(t)),
        },
    )
    .await?;
    // Everyone's new-item form lists them.
    realtime::emit(
        tx,
        realtime::Event { kind: "templates_changed", issue_id: None, branch_ids: vec![], recipient_ids: vec![] },
    )
    .await
}

fn snapshot(t: &Template) -> Value {
    json!({
        "name": t.name, "description": t.description, "type": t.issue_type, "tag": t.tag,
        "requires_report": t.requires_report, "default_sla_hours": t.default_sla_hours,
        "position": t.position, "archived": t.archived_at.is_some(),
    })
}

async fn name_free(tx: &mut Tx, name: &str, except: Option<Uuid>) -> AppResult<()> {
    let taken = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM issue_template
                          WHERE lower(name) = lower($1) AND archived_at IS NULL
                            AND ($2::uuid IS NULL OR id <> $2)) AS "taken!""#,
        name,
        except,
    )
    .fetch_one(&mut **tx)
    .await?;
    if taken {
        return Err(AppError::conflict("template_name_taken", "another template has this name"));
    }
    Ok(())
}

fn check_rules(issue_type: IssueType, requires_report: bool, sla_hours: Option<i32>) -> AppResult<()> {
    if requires_report && issue_type != IssueType::Action {
        return Err(AppError::validation("invalid_template", "only action templates can require a report"));
    }
    if sla_hours.is_some() && issue_type != IssueType::Action {
        return Err(AppError::validation("invalid_template", "only action templates have a due time"));
    }
    if sla_hours.is_some_and(|h| !(1..=24 * 365).contains(&h)) {
        return Err(AppError::validation("invalid_template", "the due time must be 1 hour to a year"));
    }
    Ok(())
}

fn validate_name(name: &str) -> AppResult<String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::validation("invalid_name", "a template's name must be 1 to 80 characters"));
    }
    Ok(name)
}

fn validate_description(d: Option<String>) -> AppResult<Option<String>> {
    let d = d.map(|d| d.trim().to_owned()).filter(|d| !d.is_empty());
    if d.as_ref().is_some_and(|d| d.chars().count() > 500) {
        return Err(AppError::validation("invalid_description", "a template's description is at most 500 characters"));
    }
    Ok(d)
}

/// A tag as stored: lower case, single spaces, no leading `#`. Blank is `None`.
pub fn normalize_tag(tag: &str) -> AppResult<Option<String>> {
    let t = tag.trim().trim_start_matches('#').split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
    if t.is_empty() {
        return Ok(None);
    }
    if t.chars().count() > MAX_TAG_CHARS {
        return Err(AppError::validation("invalid_tag", format!("a tag is at most {MAX_TAG_CHARS} characters")));
    }
    Ok(Some(t))
}

/// Normalized, de-duplicated tags in their given order.
pub fn normalize_tags<'a>(tags: impl IntoIterator<Item = &'a str>) -> AppResult<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        if let Some(t) = normalize_tag(t)? {
            if !out.contains(&t) {
                out.push(t);
            }
        }
    }
    if out.len() > MAX_TAGS {
        return Err(AppError::validation("invalid_tag", format!("at most {MAX_TAGS} tags")));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_are_normalized_and_deduplicated() {
        assert_eq!(normalize_tag("  #Field  Trip ").unwrap().as_deref(), Some("field trip"));
        assert_eq!(normalize_tag("  ").unwrap(), None);
        assert_eq!(normalize_tags(["Report", "report", " ", "گزارش"]).unwrap(), vec!["report", "گزارش"]);
        assert!(normalize_tag(&"x".repeat(41)).is_err());
        assert!(normalize_tags((0..11).map(|i| ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"][i])).is_err());
    }
}
