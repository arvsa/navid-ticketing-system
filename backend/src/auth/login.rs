use sqlx::PgPool;
use uuid::Uuid;

use super::{
    password::{self, Password},
    session::{self, ClientMeta, SessionToken},
};
use crate::{
    db,
    error::{AppError, AppResult},
};

pub const MAX_FAILED_ATTEMPTS: i32 = 5;
pub const LOCKOUT_MINUTES: i32 = 15;

fn invalid_credentials() -> AppError {
    AppError::unauthorized("invalid_credentials", "invalid email or password")
}

pub struct LoginOutcome {
    pub user_id: Uuid,
    pub is_super_admin: bool,
    pub token: SessionToken,
}

/// Checks credentials and opens a session.
///
/// Every failure (unknown email, wrong password, locked, inactive) returns
/// the same `401 invalid_credentials`, after the same argon2 work.
pub async fn login(db: &PgPool, email: &str, password: Password, meta: &ClientMeta) -> AppResult<LoginOutcome> {
    if password.expose().len() > password::MAX_LENGTH {
        return Err(invalid_credentials());
    }

    let user = sqlx::query!(
        r#"
        SELECT id, password_hash, is_active, is_super_admin,
               coalesce(locked_until > now(), false) AS "locked!"
        FROM app_user
        WHERE email = ($1::text)::citext
        "#,
        email.trim(),
    )
    .fetch_optional(db)
    .await?;

    let stored_hash = user.as_ref().map_or_else(|| password::DUMMY_HASH.clone(), |u| u.password_hash.clone());
    let password_ok = password::verify_async(password, stored_hash).await?;

    let user = match user {
        None => return Err(invalid_credentials()),
        // While locked (or inactive), attempts are refused without counting,
        // so the lock isn't extended by further guesses.
        Some(u) if u.locked || !u.is_active => return Err(invalid_credentials()),
        Some(u) => u,
    };

    if !password_ok {
        record_failure(db, user.id).await?;
        return Err(invalid_credentials());
    }

    let token = db::with_tx(db, |tx| {
        let meta = meta.clone();
        Box::pin(async move {
            sqlx::query!(
                "UPDATE app_user SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
                user.id
            )
            .execute(&mut **tx)
            .await?;
            session::create(&mut **tx, user.id, &meta).await
        })
    })
    .await?;

    tracing::info!(user_id = %user.id, "login succeeded");
    Ok(LoginOutcome { user_id: user.id, is_super_admin: user.is_super_admin, token })
}

/// Counts a failure. The fifth consecutive one locks the account for 15
/// minutes and resets the counter, so the next lock needs five more.
async fn record_failure(db: &PgPool, user_id: Uuid) -> AppResult<()> {
    let locked = sqlx::query_scalar!(
        r#"
        UPDATE app_user SET
            failed_login_count = CASE WHEN failed_login_count + 1 >= $2 THEN 0 ELSE failed_login_count + 1 END,
            locked_until = CASE WHEN failed_login_count + 1 >= $2
                                THEN now() + make_interval(mins => $3) ELSE locked_until END
        WHERE id = $1
        RETURNING locked_until IS NOT NULL AND locked_until > now() AS "locked!"
        "#,
        user_id,
        MAX_FAILED_ATTEMPTS,
        LOCKOUT_MINUTES,
    )
    .fetch_one(db)
    .await?;

    if locked {
        tracing::warn!(%user_id, "account locked after repeated failed logins");
    } else {
        tracing::info!(%user_id, "login failed");
    }
    Ok(())
}

/// `POST /api/me/password`: the user picks a new password. Clears
/// `must_change_password` and signs out every other session.
pub async fn change_password(
    db: &PgPool,
    user_id: Uuid,
    current_session: Uuid,
    current: Password,
    new: Password,
) -> AppResult<()> {
    password::validate_new(&new)?;
    if current.expose() == new.expose() {
        return Err(AppError::validation("password_unchanged", "the new password must differ from the current one"));
    }

    let stored = sqlx::query_scalar!("SELECT password_hash FROM app_user WHERE id = $1", user_id).fetch_one(db).await?;
    if !password::verify_async(current, stored).await? {
        return Err(AppError::validation("invalid_current_password", "the current password is incorrect"));
    }
    let new_hash = password::hash_async(new).await?;

    db::with_tx(db, |tx| {
        Box::pin(async move {
            sqlx::query!(
                "UPDATE app_user SET password_hash = $2, must_change_password = false WHERE id = $1",
                user_id,
                new_hash
            )
            .execute(&mut **tx)
            .await?;
            session::revoke_all_for_user(&mut **tx, user_id, Some(current_session)).await
        })
    })
    .await?;

    tracing::info!(%user_id, "password changed");
    Ok(())
}
