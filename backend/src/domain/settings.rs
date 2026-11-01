//! App settings (`app_settings`, one row): run by super admins, read by anyone,
//! signed in or not (the sign-in page shows the school's name).

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgPool;
use time::OffsetDateTime;

use super::audit::{self, AuditEntry};
use crate::{
    authz::{authorize, Action, Actor},
    error::{AppError, AppResult},
    realtime,
};

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct Settings {
    pub school_name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

pub async fn get(db: &PgPool) -> AppResult<Settings> {
    Ok(sqlx::query_as!(Settings, "SELECT school_name, updated_at FROM app_settings").fetch_one(db).await?)
}

#[derive(Debug, Default, Deserialize, utoipa::ToSchema)]
pub struct SettingsPatch {
    pub school_name: Option<String>,
}

pub async fn update(db: &PgPool, actor: &Actor, patch: SettingsPatch) -> AppResult<Settings> {
    authorize(actor, Action::EditSettings)?;
    let mut tx = db.begin().await?;
    let old = sqlx::query_scalar!("SELECT school_name FROM app_settings FOR UPDATE").fetch_one(&mut *tx).await?;
    if let Some(name) = patch.school_name.as_deref().map(str::trim) {
        if name.is_empty() || name.chars().count() > 120 {
            return Err(AppError::validation("invalid_name", "the school's name must be 1 to 120 characters"));
        }
        if name != old {
            sqlx::query!(
                "UPDATE app_settings SET school_name = $1, updated_by = $2, updated_at = now()",
                name,
                actor.user_id
            )
            .execute(&mut *tx)
            .await?;
            audit::record(
                &mut tx,
                AuditEntry {
                    entity_type: "app_settings",
                    entity_id: "app".into(),
                    branch_id: None,
                    actor_id: Some(actor.user_id),
                    action: "update",
                    old_value: Some(json!({ "school_name": old })),
                    new_value: Some(json!({ "school_name": name })),
                },
            )
            .await?;
            // Everyone's header shows the name: let open pages refetch.
            realtime::emit(
                &mut tx,
                realtime::Event { kind: "settings_changed", issue_id: None, branch_ids: vec![], recipient_ids: vec![] },
            )
            .await?;
        }
    }
    tx.commit().await?;
    get(db).await
}
