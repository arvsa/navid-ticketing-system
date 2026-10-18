//! Phase 6: the pg_notify -> listener -> SSE pipeline, end to end, with
//! per-connection filtering.

mod common;

use std::time::Duration;

use axum::{
    body::Body,
    http::{header, Method, Request, StatusCode},
};
use backend::{db::MIGRATOR, realtime};
use common::*;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;

/// Reads `event:` / `data:` pairs from an SSE response body.
struct SseReader {
    body: Body,
    buf: String,
}

impl SseReader {
    /// The next event within `wait`, skipping heartbeat comments.
    async fn next(&mut self, wait: Duration) -> Option<(String, Value)> {
        let deadline = tokio::time::Instant::now() + wait;
        loop {
            if let Some(end) = self.buf.find("\n\n") {
                let block: String = self.buf.drain(..end + 2).collect();
                let mut event = None;
                let mut data = None;
                for line in block.lines() {
                    if let Some(v) = line.strip_prefix("event:") {
                        event = Some(v.trim().to_owned());
                    } else if let Some(v) = line.strip_prefix("data:") {
                        data = Some(serde_json::from_str(v.trim()).unwrap_or(Value::Null));
                    }
                }
                if let Some(event) = event {
                    return Some((event, data.unwrap_or(Value::Null)));
                }
                continue;
            }
            let frame = tokio::time::timeout_at(deadline, self.body.frame()).await.ok()??.ok()?;
            if let Ok(bytes) = frame.into_data() {
                self.buf.push_str(&String::from_utf8_lossy(&bytes));
            }
        }
    }

    /// Waits for an event of `kind`, ignoring others.
    async fn expect(&mut self, kind: &str) -> Value {
        loop {
            match self.next(Duration::from_secs(5)).await {
                Some((k, data)) if k == kind => return data,
                Some(_) => continue,
                None => panic!("no `{kind}` event arrived"),
            }
        }
    }

    /// Asserts nothing of `kind` arrives within a short wait.
    async fn expect_none(&mut self, kind: &str) {
        while let Some((k, data)) = self.next(Duration::from_millis(800)).await {
            assert_ne!(k, kind, "unexpected `{kind}` event: {data}");
        }
    }

    async fn closed(&mut self) -> bool {
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                match self.body.frame().await {
                    None => return true,
                    Some(Err(_)) => return true,
                    Some(Ok(frame)) => {
                        if let Ok(bytes) = frame.into_data() {
                            self.buf.push_str(&String::from_utf8_lossy(&bytes));
                        }
                    }
                }
            }
        })
        .await
        .unwrap_or(false)
    }
}

async fn open_stream(app: &TestApp, cookie: &str) -> SseReader {
    let req = Request::builder().uri("/api/stream").header(header::COOKIE, cookie).body(Body::empty()).unwrap();
    let res = app.router.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "text/event-stream");
    let mut reader = SseReader { body: res.into_body(), buf: String::new() };
    reader.expect("ready").await;
    reader
}

/// Starts the listener and waits until it is actually LISTENing.
async fn start_listener(app: &TestApp) {
    realtime::listener::spawn(app.db.clone(), app.state.realtime.clone());
    let mut probe = app.state.realtime.subscribe();
    for _ in 0..50 {
        sqlx::query!("SELECT pg_notify('app_events', '{\"kind\":\"probe\"}')").execute(&app.db).await.unwrap();
        if let Ok(Ok(signal)) = tokio::time::timeout(Duration::from_millis(100), probe.recv()).await {
            if signal.kind == "probe" {
                return;
            }
        }
    }
    panic!("the realtime listener never came up");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn only_the_right_branch_hears_about_a_change(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    start_listener(&app).await;
    let plain_a = as_user(&app, "plain_a@example.com").await;
    let admin_a = as_user(&app, "admin_a@example.com").await;
    let admin_b = as_user(&app, "admin_b@example.com").await;
    let mut stream_a = open_stream(&app, &plain_a).await;
    let mut stream_b = open_stream(&app, &admin_b).await;

    // A change in branch A.
    let res = call(
        &app,
        &admin_a,
        Method::POST,
        "/api/issues",
        Some(json!({
            "branch_id": org.branch_a, "type": "ticket", "title": "A thing in A"
        })),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    let issue_a = res.body["id"].as_str().unwrap().to_owned();

    let data = stream_a.expect("issue_created").await;
    assert_eq!(data["issue_id"], issue_a.as_str());
    assert_eq!(data["branch_ids"], json!([org.branch_a]));
    // IDs only: the title never travels over the stream.
    assert!(!data.to_string().contains("A thing"));
    stream_b.expect_none("issue_created").await;

    // And the other way round.
    let res = call(
        &app,
        &admin_b,
        Method::POST,
        "/api/issues",
        Some(json!({
            "branch_id": org.branch_b, "type": "ticket", "title": "B thing"
        })),
    )
    .await;
    let issue_b = res.body["id"].as_str().unwrap().to_owned();
    let data = stream_b.expect("issue_created").await;
    assert_eq!(data["issue_id"], issue_b.as_str());
    stream_a.expect_none("issue_created").await;
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn recipients_and_super_admins_hear_beyond_their_branches(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    start_listener(&app).await;
    let root = as_root(&app).await;
    let admin_a = as_user(&app, "admin_a@example.com").await;
    let plain_a = as_user(&app, "plain_a@example.com").await;
    let mut root_stream = open_stream(&app, &root).await;
    let mut plain_stream = open_stream(&app, &plain_a).await;

    // Assigning plain_a: their inbox changed, so their stream hears about it.
    call(
        &app,
        &admin_a,
        Method::POST,
        "/api/issues",
        Some(json!({
            "branch_id": org.branch_a, "type": "action", "title": "Do it", "targets": [{ "user_id": org.plain_a }]
        })),
    )
    .await;
    plain_stream.expect("notification").await;
    // The super admin isn't in branch A but sees every branch's activity.
    root_stream.expect("issue_created").await;
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn permission_changes_refresh_the_connection(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    start_listener(&app).await;
    let multi = as_user(&app, "multi@example.com").await;
    let admin_a = as_user(&app, "admin_a@example.com").await;
    let mut stream = open_stream(&app, &multi).await;

    // multi leaves branch A: the `permissions_changed` naming them reloads
    // their Actor, so branch A news stops at once.
    let res =
        call(&app, &admin_a, Method::DELETE, &format!("/api/branches/{}/members/{}", org.branch_a, org.multi), None)
            .await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    stream.expect("permissions_changed").await;
    call(
        &app,
        &admin_a,
        Method::POST,
        "/api/issues",
        Some(json!({ "branch_id": org.branch_a, "type": "ticket", "title": "After" })),
    )
    .await;
    stream.expect_none("issue_created").await;

    // A revoked session ends the stream on the next refresh.
    let admin_b = as_user(&app, "admin_b@example.com").await;
    call(&app, &multi, Method::POST, "/api/auth/logout", None).await;
    let group = create_group(&app.db, org.branch_b, "B team", &[], &[org.multi]).await;
    let res = call(&app, &admin_b, Method::DELETE, &format!("/api/groups/{group}/members/{}", org.multi), None).await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    stream.expect("session_ended").await;
    assert!(stream.closed().await, "the stream closes after session_ended");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_stream_needs_a_session_and_a_changed_password(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let res = app.get("/api/stream").await;
    assert_status(&res, StatusCode::UNAUTHORIZED, Some("unauthenticated"));

    let mut user = NewUser::member("new@example.com", PW);
    user.must_change_password = true;
    create_user(&app.db, user).await;
    let cookie = app.session("new@example.com", PW).await;
    let res = app.req(Method::GET, "/api/stream").cookie(&cookie).send().await;
    assert_status(&res, StatusCode::FORBIDDEN, Some("password_change_required"));
}
