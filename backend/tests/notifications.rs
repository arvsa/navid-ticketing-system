//! Phase 6: the inbox endpoints, the background jobs (SLA, reminders,
//! cleanup), their deduplication and their advisory-lock leader election.

mod common;

use std::collections::BTreeSet;

use axum::http::{Method, StatusCode};
use backend::{
    db::MIGRATOR,
    domain::notifications::Kind,
    jobs::{self, cleanup, reminders, sla},
};
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use uuid::Uuid;

fn fmt(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap()
}

async fn count(db: &PgPool, kind: &str) -> i64 {
    sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM notification WHERE kind = $1"#, kind)
        .fetch_one(db)
        .await
        .unwrap()
}

async fn recipients(db: &PgPool, kind: &str) -> BTreeSet<Uuid> {
    sqlx::query_scalar!("SELECT recipient_id FROM notification WHERE kind = $1", kind)
        .fetch_all(db)
        .await
        .unwrap()
        .into_iter()
        .collect()
}

async fn create(app: &TestApp, cookie: &str, body: Value) -> Value {
    let res = call(app, cookie, Method::POST, "/api/issues", Some(body)).await;
    assert_status(&res, StatusCode::CREATED, None);
    res.body
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn notification_kinds_match_the_schema(pool: PgPool) {
    let def = sqlx::query_scalar!(
        r#"SELECT pg_get_constraintdef(oid) AS "def!" FROM pg_constraint WHERE conname = 'notification_kind_check'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let in_schema: BTreeSet<String> = def.split('\'').skip(1).step_by(2).map(str::to_owned).collect();
    let in_code: BTreeSet<String> = Kind::ALL.iter().map(|k| k.as_str().to_owned()).collect();
    assert_eq!(in_schema, in_code);
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_inbox_lists_counts_and_marks_read(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let multi = as_user(&app, "multi@example.com").await;

    for title in ["One", "Two", "Three"] {
        create(&app, &admin, json!({ "branch_id": org.branch_a, "type": "action", "title": title, "targets": [{ "user_id": org.plain_a }] })).await;
    }
    let res = call(&app, &plain, Method::GET, "/api/notifications", None).await;
    let items = res.body["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0]["kind"], "assigned");
    assert_eq!(items[0]["issue_title"], "Three", "newest first");
    assert!(items[0]["issue_key"].as_str().unwrap().starts_with("ISS-"));
    assert_eq!(items[0]["actor_id"], org.admin_a.to_string());
    let unread = |cookie: String| {
        let app = &app;
        async move { call(app, &cookie, Method::GET, "/api/notifications/unread-count", None).await.body["count"].clone() }
    };
    assert_eq!(unread(plain.clone()).await, 3);

    // Mark one read; someone else's is 404.
    let first = items[0]["id"].as_i64().unwrap();
    assert_status(
        &call(&app, &multi, Method::POST, &format!("/api/notifications/{first}/read"), None).await,
        StatusCode::NOT_FOUND,
        None,
    );
    assert_status(
        &call(&app, &plain, Method::POST, &format!("/api/notifications/{first}/read"), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    assert_eq!(unread(plain.clone()).await, 2);
    let only_unread = call(&app, &plain, Method::GET, "/api/notifications?unread=true", None).await;
    assert_eq!(only_unread.body["items"].as_array().unwrap().len(), 2);

    // Pages by id.
    let page = call(&app, &plain, Method::GET, "/api/notifications?limit=2", None).await;
    let cursor = page.body["next_cursor"].as_str().unwrap();
    let rest = call(&app, &plain, Method::GET, &format!("/api/notifications?limit=2&after={cursor}"), None).await;
    assert_eq!(rest.body["items"].as_array().unwrap().len(), 1);

    let res = call(&app, &plain, Method::POST, "/api/notifications/read-all", None).await;
    assert_eq!(res.body["marked"], 2);
    assert_eq!(unread(plain).await, 0);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn people_and_groups_a_ticket_is_aimed_at_hear_about_it_once(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;

    let ticket = create(
        &app,
        &root,
        json!({
            "branch_id": org.branch_a, "type": "ticket", "title": "Heating is off",
            "targets": [{ "user_id": org.plain_a }, { "user_id": org.admin_a }, { "group_id": org.managers_group }]
        }),
    )
    .await;
    assert_eq!(notifications_of(&app.db, org.plain_a, "ticket_created").await, 1);
    assert_eq!(notifications_of(&app.db, org.manager_a, "ticket_created").await, 1);
    assert_eq!(notifications_of(&app.db, org.admin_a, "ticket_created").await, 1, "admin and target: told once");
    assert_eq!(notifications_of(&app.db, org.boss_like_a, "ticket_created").await, 0);

    // Added later, too.
    let id = ticket["id"].as_str().unwrap();
    let res = call(
        &app,
        &root,
        Method::POST,
        &format!("/api/issues/{id}/targets"),
        Some(json!({ "user_id": org.boss_like_a })),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(notifications_of(&app.db, org.boss_like_a, "ticket_created").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn notifications_about_issues_you_can_no_longer_read_are_hidden(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let issue = create(
        &app,
        &boss_like,
        json!({
            "branch_id": org.branch_a, "type": "action", "title": "Private job", "is_private": true,
            "targets": [{ "user_id": org.plain_a }]
        }),
    )
    .await;
    assert_eq!(call(&app, &plain, Method::GET, "/api/notifications/unread-count", None).await.body["count"], 1);

    // Removing the target ends plain_a's access, and the notification goes with it.
    let target = issue["targets"][0]["id"].as_str().unwrap();
    call(
        &app,
        &boss_like,
        Method::DELETE,
        &format!("/api/issues/{}/targets/{target}", issue["id"].as_str().unwrap()),
        None,
    )
    .await;
    let res = call(&app, &plain, Method::GET, "/api/notifications", None).await;
    assert!(res.body["items"].as_array().unwrap().is_empty());
    assert_eq!(call(&app, &plain, Method::GET, "/api/notifications/unread-count", None).await.body["count"], 0);
}

// ---------------------------------------------------------------------------
// SLA job
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn sla_job_warns_then_breaches_once_per_day(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let now = OffsetDateTime::now_utc();
    let due = |hours: i64| fmt(now + Duration::hours(hours));

    let soon = create(&app, &admin, json!({ "branch_id": org.branch_a, "type": "action", "title": "Soon", "sla_due_at": due(5), "targets": [{ "user_id": org.plain_a }] })).await;
    create(&app, &admin, json!({ "branch_id": org.branch_a, "type": "action", "title": "Far", "sla_due_at": due(48), "targets": [{ "user_id": org.plain_a }] })).await;
    // Unassigned shared work: only the admins hear.
    let team = create_group(&app.db, org.branch_a, "Team", &[], &[org.multi]).await;
    create(&app, &admin, json!({ "branch_id": org.branch_a, "type": "action", "title": "Shared", "sla_due_at": due(3), "targets": [{ "group_id": team }] })).await;
    // Done work never warns.
    let done = create(&app, &admin, json!({ "branch_id": org.branch_a, "type": "action", "title": "Done", "sla_due_at": due(2), "targets": [{ "user_id": org.multi }] })).await;
    let done_item = done["work_items"][0]["id"].as_str().unwrap();
    call(&app, &admin, Method::POST, &format!("/api/work-items/{done_item}/cancel"), Some(json!({ "version": 1 })))
        .await;

    // Due soon: 2 for "Soon" (assignee + admin), 1 for "Shared" (admin).
    assert_eq!(sla::run(&app.db, now).await.unwrap(), Some(3));
    assert_eq!(recipients(&app.db, "sla_due_soon").await, [org.plain_a, org.admin_a].into());
    // Running again, even repeatedly, adds nothing.
    assert_eq!(sla::run(&app.db, now).await.unwrap(), Some(0));
    assert_eq!(sla::run(&app.db, now + Duration::minutes(1)).await.unwrap(), Some(0));
    assert_eq!(count(&app.db, "sla_due_soon").await, 3);
    let n = sqlx::query!("SELECT actor_id, dedupe_key FROM notification WHERE kind = 'sla_due_soon' LIMIT 1")
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(n.actor_id.is_none(), "jobs act as the system");
    assert!(n.dedupe_key.unwrap().starts_with("sla_due_soon:"));

    // Six hours later "Soon" and "Shared" have breached.
    let later = now + Duration::hours(6);
    assert_eq!(sla::run(&app.db, later).await.unwrap(), Some(3));
    assert_eq!(sla::run(&app.db, later).await.unwrap(), Some(0));
    // The next day they breach again (one reminder per day).
    assert_eq!(sla::run(&app.db, later + Duration::days(1)).await.unwrap(), Some(3 + 2), "plus 'Far' now within 24 h");
    assert_eq!(count(&app.db, "sla_breached").await, 6);

    // Once the work is submitted it is no longer overdue work.
    let item = soon["work_items"][0]["id"].as_str().unwrap();
    let plain = as_user(&app, "plain_a@example.com").await;
    call(&app, &plain, Method::POST, &format!("/api/work-items/{item}/submit"), Some(json!({ "version": 1 }))).await;
    // Left: "Far" breached (assignee + admin) and "Shared" (admin only).
    assert_eq!(sla::run(&app.db, later + Duration::days(2)).await.unwrap(), Some(2 + 1));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn sla_days_follow_the_branch_timezone(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    sqlx::query!("UPDATE branch SET timezone = 'Pacific/Kiritimati' WHERE id = $1", org.branch_a)
        .execute(&app.db)
        .await
        .unwrap();
    // 11:00 UTC is already the next day (01:00) at UTC+14.
    let at = OffsetDateTime::parse("2030-03-10T11:00:00Z", &Rfc3339).unwrap();
    create(&app, &admin, json!({ "branch_id": org.branch_a, "type": "action", "title": "Late", "sla_due_at": fmt(at - Duration::hours(1)), "targets": [{ "user_id": org.plain_a }] })).await;
    sla::run(&app.db, at).await.unwrap();
    let key = sqlx::query_scalar!(
        "SELECT dedupe_key FROM notification WHERE kind = 'sla_breached' AND recipient_id = $1",
        org.plain_a
    )
    .fetch_one(&app.db)
    .await
    .unwrap()
    .unwrap();
    assert!(key.ends_with(":2030-03-11"), "{key}");
}

// ---------------------------------------------------------------------------
// Reminders job
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn reminders_fire_once_each_for_invitees_who_have_not_declined(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let organizer = as_user(&app, "boss_like_a@example.com").await;
    let now = OffsetDateTime::now_utc();
    let start = now + Duration::minutes(30);
    let event = create(
        &app,
        &organizer,
        json!({
            "branch_id": org.branch_a, "type": "event", "title": "Meeting",
            "targets": [{ "user_id": org.plain_a }, { "user_id": org.multi }, { "user_id": org.manager_a }],
            "event": { "starts_at": fmt(start), "ends_at": fmt(start + Duration::hours(1)), "reminders": [60, 10] }
        }),
    )
    .await;
    let id = event["id"].as_str().unwrap().to_owned();
    let decline = as_user(&app, "manager_a@example.com").await;
    call(&app, &decline, Method::PUT, &format!("/api/events/{id}/rsvp"), Some(json!({ "response": "declined" }))).await;

    // The 60-minute reminder is due; the 10-minute one isn't yet.
    assert_eq!(reminders::run(&app.db, now).await.unwrap(), Some(2));
    assert_eq!(recipients(&app.db, "event_reminder").await, [org.plain_a, org.multi].into());
    assert_eq!(reminders::run(&app.db, now).await.unwrap(), Some(0));
    assert_eq!(reminders::run(&app.db, now + Duration::minutes(5)).await.unwrap(), Some(0));
    // 25 minutes later the 10-minute one fires.
    assert_eq!(reminders::run(&app.db, now + Duration::minutes(25)).await.unwrap(), Some(2));
    assert_eq!(count(&app.db, "event_reminder").await, 4);
    // Nothing once it has started.
    assert_eq!(reminders::run(&app.db, now + Duration::minutes(40)).await.unwrap(), Some(0));

    // Rescheduling re-arms the reminders for the new time.
    let new_start = now + Duration::minutes(50);
    call(
        &app,
        &organizer,
        Method::PATCH,
        &format!("/api/issues/{id}"),
        Some(json!({
            "version": 1, "event": { "starts_at": fmt(new_start), "ends_at": fmt(new_start + Duration::hours(1)) }
        })),
    )
    .await;
    assert_eq!(reminders::run(&app.db, now + Duration::minutes(1)).await.unwrap(), Some(2));

    // Cancelled events stay quiet.
    call(&app, &organizer, Method::POST, &format!("/api/issues/{id}/cancel"), Some(json!({ "version": 2 }))).await;
    assert_eq!(reminders::run(&app.db, now + Duration::minutes(45)).await.unwrap(), Some(0));
}

// ---------------------------------------------------------------------------
// Leader election and concurrency
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn a_held_job_lock_skips_the_run_and_concurrent_runs_never_duplicate(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let now = OffsetDateTime::now_utc();
    create(
        &app,
        &admin,
        json!({
            "branch_id": org.branch_a, "type": "action", "title": "Due", "sla_due_at": fmt(now + Duration::hours(1)),
            "targets": [{ "user_id": org.plain_a }]
        }),
    )
    .await;

    // Another "instance" holds the SLA lock: this one skips the tick.
    let mut other = app.db.begin().await.unwrap();
    assert!(jobs::try_lock(&mut other, jobs::SLA_LOCK).await.unwrap());
    assert_eq!(sla::run(&app.db, now).await.unwrap(), None);
    // Other jobs have their own locks.
    assert!(reminders::run(&app.db, now).await.unwrap().is_some());
    other.rollback().await.unwrap();

    // Two instances ticking at once: one runs, the other skips or adds nothing.
    let (a, b) = tokio::join!(sla::run(&app.db, now), sla::run(&app.db, now));
    let total: u64 = [a.unwrap(), b.unwrap()].into_iter().flatten().sum();
    assert_eq!(total, 2);
    assert_eq!(count(&app.db, "sla_due_soon").await, 2);
}

// ---------------------------------------------------------------------------
// Cleanup job
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn cleanup_removes_old_read_notifications_and_dead_sessions(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let insert = |read: bool, days_old: i32| {
        let db = app.db.clone();
        async move {
            sqlx::query!(
                r#"INSERT INTO notification (recipient_id, kind, created_at, read_at)
                   VALUES ($1, 'assigned', now() - make_interval(days => $2),
                           CASE WHEN $3 THEN now() - make_interval(days => $2) END)"#,
                org.plain_a,
                days_old,
                read
            )
            .execute(&db)
            .await
            .unwrap();
        }
    };
    insert(true, 120).await; // deleted
    insert(false, 120).await; // unread: kept
    insert(true, 10).await; // recent: kept

    let live = app.session("plain_a@example.com", PW).await;
    app.session("plain_a@example.com", PW).await;
    app.session("plain_a@example.com", PW).await;
    sqlx::query!(
        r#"UPDATE user_session SET revoked_at = now() - interval '40 days'
           WHERE id = (SELECT id FROM user_session ORDER BY created_at DESC LIMIT 1)"#
    )
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query!(
        r#"UPDATE user_session SET expires_at = now() - interval '31 days'
           WHERE id = (SELECT id FROM user_session WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)"#
    )
    .execute(&app.db)
    .await
    .unwrap();

    let cleaned = cleanup::run(&app.db, OffsetDateTime::now_utc()).await.unwrap().unwrap();
    assert_eq!((cleaned.notifications, cleaned.sessions), (1, 2));
    assert_eq!(
        cleanup::run(&app.db, OffsetDateTime::now_utc()).await.unwrap().unwrap(),
        cleanup::Cleaned { notifications: 0, sessions: 0 }
    );
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&live).send().await.status, StatusCode::OK);
}
