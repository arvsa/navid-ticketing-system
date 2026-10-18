use std::{fmt, sync::LazyLock};

use argon2::{
    password_hash::{phc::PasswordHash, PasswordHasher, PasswordVerifier},
    Argon2,
};
use rand::RngExt;
use serde::Deserialize;

use crate::error::{AppError, AppResult};

pub const MIN_LENGTH: usize = 8;
/// Longer inputs are rejected before hashing.
pub const MAX_LENGTH: usize = 128;

/// A plaintext password. `Debug` is redacted so it can't end up in logs by
/// accident (e.g. through `#[derive(Debug)]` on a request struct).
#[derive(Clone, Deserialize)]
#[serde(transparent)]
pub struct Password(String);

impl Password {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Password {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Password([redacted])")
    }
}

/// Argon2id with default parameters. CPU-heavy: call from `spawn_blocking`
/// (or use [`hash_async`]).
pub fn hash(password: &Password) -> AppResult<String> {
    Argon2::default()
        .hash_password(password.expose().as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| AppError::internal(format!("hashing password: {e}")))
}

pub fn verify(password: &Password, stored_hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(stored_hash) else { return false };
    Argon2::default().verify_password(password.expose().as_bytes(), &parsed).is_ok()
}

pub async fn hash_async(password: Password) -> AppResult<String> {
    tokio::task::spawn_blocking(move || hash(&password)).await.map_err(AppError::internal)?
}

pub async fn verify_async(password: Password, stored_hash: String) -> AppResult<bool> {
    tokio::task::spawn_blocking(move || verify(&password, &stored_hash)).await.map_err(AppError::internal)
}

/// Verified against when a login names no account, so the response takes as
/// long as a wrong password and doesn't reveal which emails exist.
pub static DUMMY_HASH: LazyLock<String> =
    LazyLock::new(|| hash(&Password::new("dummy-password-for-timing")).expect("hashing the dummy password"));

/// A random temporary password for new accounts and admin resets. Avoids
/// look-alike characters because people type it in by hand.
pub fn generate_temporary() -> Password {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut rng = rand::rng();
    let value = (0..16).map(|_| ALPHABET[rng.random_range(0..ALPHABET.len())] as char).collect::<String>();
    Password(value)
}

/// Rules for a password a user chooses.
pub fn validate_new(password: &Password) -> AppResult<()> {
    let len = password.expose().chars().count();
    if len < MIN_LENGTH {
        return Err(AppError::validation(
            "weak_password",
            format!("password must be at least {MIN_LENGTH} characters"),
        ));
    }
    if len > MAX_LENGTH {
        return Err(AppError::validation("weak_password", format!("password must be at most {MAX_LENGTH} characters")));
    }
    Ok(())
}

/// In the OpenAPI document: a string in `password` format.
impl utoipa::PartialSchema for Password {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, SchemaFormat, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Password)))
            .into()
    }
}

impl utoipa::ToSchema for Password {}
