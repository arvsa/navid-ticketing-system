use std::{fmt, net::IpAddr};

use sha2::{Digest, Sha256};
use sqlx::{PgExecutor, PgPool};
use uuid::Uuid;

use crate::error::AppResult;

pub const COOKIE_NAME: &str = "sid";
pub const SESSION_DAYS: i64 = 7;

/// The raw session token sent in the cookie: 32 random bytes, hex-encoded.
/// Only its sha256 is stored. `Debug` is redacted.
pub struct SessionToken(String);

impl SessionToken {
    pub fn generate() -> Self {
        let mut bytes = [0u8; 32];
        rand::fill(&mut bytes);
        Self(bytes.iter().map(|b| format!("{b:02x}")).collect())
    }

    /// Parses a cookie value; anything that isn't 64 hex chars is rejected
    /// without touching the database.
    pub fn parse(value: &str) -> Option<Self> {
        (value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())).then(|| Self(value.to_ascii_lowercase()))
    }

    pub fn hash(&self) -> Vec<u8> {
        Sha256::digest(self.0.as_bytes()).to_vec()
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SessionToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SessionToken([redacted])")
    }
}

/// Request metadata stored with a new session.
#[derive(Debug, Clone, Default)]
pub struct ClientMeta {
    pub user_agent: Option<String>,
    pub ip: Option<IpAddr>,
}

pub async fn create(db: impl PgExecutor<'_>, user_id: Uuid, meta: &ClientMeta) -> AppResult<SessionToken> {
    let token = SessionToken::generate();
    sqlx::query!(
        r#"
        INSERT INTO user_session (user_id, token_hash, expires_at, user_agent, ip)
        VALUES ($1, $2, now() + make_interval(days => $3), $4, $5)
        "#,
        user_id,
        token.hash(),
        SESSION_DAYS as i32,
        meta.user_agent.as_deref(),
        meta.ip as Option<IpAddr>,
    )
    .execute(db)
    .await?;
    Ok(token)
}

#[derive(Debug, Clone)]
pub struct ValidSession {
    pub session_id: Uuid,
    pub user_id: Uuid,
    pub is_super_admin: bool,
    pub must_change_password: bool,
}

/// Returns the session if it is not revoked, not expired, not idle for more
/// than 12 hours, and its user is active. Slides `last_seen_at` at most once
/// a minute.
pub async fn lookup(db: &PgPool, token: &SessionToken) -> AppResult<Option<ValidSession>> {
    let row = sqlx::query!(
        r#"
        SELECT s.id, s.user_id, u.is_super_admin, u.must_change_password,
               s.last_seen_at < now() - interval '1 minute' AS "stale!"
        FROM user_session s
        JOIN app_user u ON u.id = s.user_id
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND s.last_seen_at > now() - interval '12 hours'
          AND u.is_active
        "#,
        token.hash(),
    )
    .fetch_optional(db)
    .await?;

    let Some(row) = row else { return Ok(None) };
    if row.stale {
        sqlx::query!("UPDATE user_session SET last_seen_at = now() WHERE id = $1", row.id).execute(db).await?;
    }
    Ok(Some(ValidSession {
        session_id: row.id,
        user_id: row.user_id,
        is_super_admin: row.is_super_admin,
        must_change_password: row.must_change_password,
    }))
}

pub async fn revoke(db: impl PgExecutor<'_>, session_id: Uuid) -> AppResult<()> {
    sqlx::query!("UPDATE user_session SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", session_id)
        .execute(db)
        .await?;
    Ok(())
}

/// Revokes every session of the user, except `keep` if given.
pub async fn revoke_all_for_user(db: impl PgExecutor<'_>, user_id: Uuid, keep: Option<Uuid>) -> AppResult<()> {
    sqlx::query!(
        r#"
        UPDATE user_session SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND id IS DISTINCT FROM $2
        "#,
        user_id,
        keep,
    )
    .execute(db)
    .await?;
    Ok(())
}

/// `Set-Cookie` value for a new session.
pub fn cookie(token: &SessionToken, secure: bool) -> String {
    let max_age = SESSION_DAYS * 24 * 60 * 60;
    let secure = if secure { "; Secure" } else { "" };
    format!("{COOKIE_NAME}={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}", token.expose())
}

/// `Set-Cookie` value that deletes the session cookie.
pub fn clear_cookie(secure: bool) -> String {
    let secure = if secure { "; Secure" } else { "" };
    format!("{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")
}
