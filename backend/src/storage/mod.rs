//! Attachment storage. v1 keeps files on local disk; the trait leaves room
//! for S3 or similar later.

mod local;

use std::{future::Future, io, pin::Pin};

use axum::body::Bytes;
use tokio::io::AsyncRead;

pub use local::LocalStore;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type ObjectReader = Pin<Box<dyn AsyncRead + Send>>;

pub trait ObjectStore: Send + Sync {
    /// Stores `data` under `key`, replacing nothing: keys are unique.
    fn put<'a>(&'a self, key: &'a str, data: Bytes) -> BoxFuture<'a, io::Result<()>>;
    /// Opens the object for streaming.
    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<ObjectReader>>;
    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<()>>;
}

/// Keys look like `issues/<uuid>/<uuid>`: path segments of letters, digits
/// and dashes only, so a key can never escape the store's root.
pub fn is_valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 200
        && key.split('/').all(|seg| !seg.is_empty() && seg.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
}
