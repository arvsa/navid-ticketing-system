//! Operations behind `cargo run --bin admin`. They act as the system
//! (`actor_id = NULL` in the audit log).

use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

use super::{
    password::{self, Password},
    session,
};
use crate::{
    db,
    domain::audit::{self, AuditEntry},
    error::{AppError, AppResult},
};

#[derive(Debug)]
pub struct CreatedUser {
    pub user_id: Uuid,
    pub temporary_password: Password,
}

/// Creates a super admin with a temporary password that must be changed at
/// first login.
pub async fn create_super_admin(db: &PgPool, email: &str, first_name: &str, last_name: &str) -> AppResult<CreatedUser> {
    let email = email.trim();
    if !email.contains('@') {
        return Err(AppError::validation("invalid_email", "a valid email is required"));
    }
    let (first_name, last_name) = (first_name.trim().to_owned(), last_name.trim().to_owned());
    if first_name.is_empty() || last_name.is_empty() {
        return Err(AppError::validation("invalid_name", "first and last name are required"));
    }

    let temporary_password = password::generate_temporary();
    let hash = password::hash_async(temporary_password.clone()).await?;
    let email = email.to_owned();

    let user_id = db::with_tx(db, |tx| {
        Box::pin(async move {
            let user_id = sqlx::query_scalar!(
                r#"
                INSERT INTO app_user (email, first_name, last_name, password_hash, is_super_admin, must_change_password)
                VALUES ($1::text, $2, $3, $4, true, true)
                RETURNING id
                "#,
                email,
                first_name,
                last_name,
                hash,
            )
            .fetch_one(&mut **tx)
            .await?;

            audit::record(
                tx,
                AuditEntry {
                    entity_type: "app_user",
                    entity_id: user_id.to_string(),
                    branch_id: None,
                    actor_id: None,
                    action: "create",
                    old_value: None,
                    new_value: Some(json!({
                        "email": email, "first_name": first_name, "last_name": last_name, "is_super_admin": true,
                    })),
                },
            )
            .await?;
            Ok(user_id)
        })
    })
    .await?;

    Ok(CreatedUser { user_id, temporary_password })
}

/// Sets a temporary password, forces a change at next login, clears any
/// lockout and signs the user out everywhere.
pub async fn reset_password(db: &PgPool, email: &str) -> AppResult<CreatedUser> {
    let temporary_password = password::generate_temporary();
    let hash = password::hash_async(temporary_password.clone()).await?;
    let email = email.trim().to_owned();

    let user_id = db::with_tx(db, |tx| {
        Box::pin(async move {
            let user_id = sqlx::query_scalar!(
                r#"
                UPDATE app_user
                SET password_hash = $2, must_change_password = true, failed_login_count = 0, locked_until = NULL
                WHERE email = ($1::text)::citext
                RETURNING id
                "#,
                email,
                hash,
            )
            .fetch_optional(&mut **tx)
            .await?
            .ok_or(AppError::NotFound)?;
            session::revoke_all_for_user(&mut **tx, user_id, None).await?;
            Ok(user_id)
        })
    })
    .await?;

    Ok(CreatedUser { user_id, temporary_password })
}
