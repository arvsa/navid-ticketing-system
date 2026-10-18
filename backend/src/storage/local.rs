use std::{io, path::PathBuf};

use axum::body::Bytes;
use tokio::fs;

use super::{is_valid_key, BoxFuture, ObjectReader, ObjectStore};

/// Files under a root directory, one per key.
pub struct LocalStore {
    root: PathBuf,
}

impl LocalStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn path(&self, key: &str) -> io::Result<PathBuf> {
        if !is_valid_key(key) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid storage key"));
        }
        Ok(self.root.join(key))
    }
}

impl ObjectStore for LocalStore {
    fn put<'a>(&'a self, key: &'a str, data: Bytes) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            let path = self.path(key)?;
            if let Some(dir) = path.parent() {
                fs::create_dir_all(dir).await?;
            }
            // Write then rename, so a crash never leaves a half-written file
            // under the real key.
            let tmp = path.with_extension("partial");
            fs::write(&tmp, &data).await?;
            fs::rename(&tmp, &path).await
        })
    }

    fn get<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<ObjectReader>> {
        Box::pin(async move {
            let file = fs::File::open(self.path(key)?).await?;
            Ok(Box::pin(file) as ObjectReader)
        })
    }

    fn delete<'a>(&'a self, key: &'a str) -> BoxFuture<'a, io::Result<()>> {
        Box::pin(async move {
            match fs::remove_file(self.path(key)?).await {
                Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
                other => other,
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use tokio::io::AsyncReadExt;

    use super::*;

    #[tokio::test]
    async fn round_trip_and_key_safety() {
        let dir = tempfile::tempdir().unwrap();
        let store = LocalStore::new(dir.path());
        let key = "issues/0b1c-2d/abc-123";
        store.put(key, Bytes::from_static(b"hello")).await.unwrap();
        let mut out = String::new();
        store.get(key).await.unwrap().read_to_string(&mut out).await.unwrap();
        assert_eq!(out, "hello");
        store.delete(key).await.unwrap();
        assert!(store.get(key).await.is_err());

        for bad in ["../etc/passwd", "issues/../x", "/abs", "a//b", "a/b.txt", ""] {
            assert!(store.put(bad, Bytes::new()).await.is_err(), "{bad} must be rejected");
        }
    }
}
