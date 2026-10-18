//! Lives in its own test binary: it installs a global tracing subscriber.

mod common;

use std::{
    io,
    sync::{Arc, Mutex},
};

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::json;
use sqlx::PgPool;

const PW: &str = "correct-horse-1";

// ---------------------------------------------------------------------------
// Secrets stay out of logs
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct Capture(Arc<Mutex<Vec<u8>>>);

impl io::Write for Capture {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn passwords_and_tokens_never_reach_the_logs(pool: PgPool) {
    let capture = Capture::default();
    let writer = capture.clone();
    // Global subscriber: this file holds a single test so nothing else races
    // with tracing's callsite-interest cache.
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .with_ansi(false)
        .init();

    let app = TestApp::new(pool);
    create_root(&app.db).await;
    create_user(&app.db, NewUser::member("ann@example.com", PW)).await;

    let bad = app.login("ann@example.com", "secret-wrong-guess").await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);
    let cookie = app.session("ann@example.com", PW).await;
    let new_password = "my-new-secret-pass";
    app.req(Method::POST, "/api/me/password")
        .cookie(&cookie)
        .json(json!({ "current_password": PW, "new_password": new_password }))
        .send()
        .await;
    app.req(Method::POST, "/api/auth/logout").cookie(&cookie).send().await;

    let logs = String::from_utf8(capture.0.lock().unwrap().clone()).unwrap();
    assert!(
        logs.contains("login succeeded"),
        "the capture should have seen the request logs, got {} bytes:\n{logs}",
        logs.len()
    );
    let token = cookie.trim_start_matches("sid=");
    for secret in [PW, "secret-wrong-guess", new_password, token] {
        assert!(!logs.contains(secret), "{secret:?} leaked into logs");
    }
}
