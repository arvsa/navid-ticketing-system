use serde_json::Value;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

use crate::{db::Tx, error::AppResult};

/// One `audit_log` row. `old_value` / `new_value` hold only the changed fields.
pub struct AuditEntry {
    pub entity_type: &'static str,
    pub entity_id: String,
    pub branch_id: Option<Uuid>,
    /// `None` = the system (jobs, CLI).
    pub actor_id: Option<Uuid>,
    pub action: &'static str,
    pub old_value: Option<Value>,
    pub new_value: Option<Value>,
}

/// Writes an audit row inside the caller's transaction, so it commits or
/// rolls back with the change it describes.
pub async fn record(tx: &mut Tx, entry: AuditEntry) -> AppResult<()> {
    sqlx::query!(
        r#"
        INSERT INTO audit_log (entity_type, entity_id, branch_id, actor_id, action, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        entry.entity_type,
        entry.entity_id,
        entry.branch_id,
        entry.actor_id,
        entry.action,
        entry.old_value,
        entry.new_value,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// A time for `old_value` / `new_value`, in RFC 3339 like every other time in
/// the API. `json!` on an `OffsetDateTime` would write serde's default
/// `[year, day_of_year, hour, ...]` list instead.
pub fn time(t: Option<OffsetDateTime>) -> Value {
    t.and_then(|t| t.format(&Rfc3339).ok()).map_or(Value::Null, Value::String)
}
