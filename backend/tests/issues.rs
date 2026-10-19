//! Phase 3: issues of all four types, targets and the work items they
//! create, editing with optimistic locking, closing, watchers, read
//! tracking and history.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use uuid::Uuid;

fn id_of(res: &TestResponse) -> String {
    res.body["id"].as_str().expect("response has an id").to_owned()
}

fn items(res: &TestResponse) -> &Vec<Value> {
    res.body["work_items"].as_array().unwrap()
}

async fn post_issue(app: &TestApp, cookie: &str, body: Value) -> TestResponse {
    call(app, cookie, Method::POST, "/api/issues", Some(body)).await
}

fn hours_from_now(v: &Value) -> i64 {
    let at = OffsetDateTime::parse(v.as_str().unwrap(), &Rfc3339).unwrap();
    ((at - OffsetDateTime::now_utc()).whole_minutes() as f64 / 60.0).round() as i64
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn members_create_tickets_reports_and_events_but_not_actions(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let a = org.branch_a;

    let ticket = post_issue(&app, &plain, json!({
        "branch_id": a, "type": "ticket", "title": "  Projector broken ", "targets": [{ "user_id": org.boss_like_a }]
    }))
    .await;
    assert_status(&ticket, StatusCode::CREATED, None);
    assert_eq!(ticket.body["title"], "Projector broken");
    assert_eq!(ticket.body["state"], "open");
    assert_eq!(ticket.body["version"], 1);
    assert!(ticket.body["key"].as_str().unwrap().starts_with("ISS-"));
    assert_eq!(ticket.body["targets"].as_array().unwrap().len(), 1);
    assert!(items(&ticket).is_empty(), "tickets have no work items");
    assert_eq!(ticket.body["requires_super_admin_approval"], false);
    // Admins hear about new tickets.
    assert_eq!(notifications_of(&app.db, org.admin_a, "ticket_created").await, 1);

    let report =
        post_issue(&app, &plain, json!({ "branch_id": a, "type": "report", "title": "My weekly report" })).await;
    assert_status(&report, StatusCode::CREATED, None);

    let starts = OffsetDateTime::now_utc() + Duration::days(3);
    let event = post_issue(&app, &plain, json!({
        "branch_id": a, "type": "event", "title": "Parents evening",
        "event": { "starts_at": starts.format(&Rfc3339).unwrap(), "ends_at": (starts + Duration::hours(2)).format(&Rfc3339).unwrap(), "location": "Hall" }
    }))
    .await;
    assert_status(&event, StatusCode::CREATED, None);
    assert_eq!(event.body["event"]["location"], "Hall");
    assert_eq!(event.body["event"]["all_day"], false);

    let action = post_issue(&app, &plain, json!({ "branch_id": a, "type": "action", "title": "Do it" })).await;
    assert_status(&action, StatusCode::FORBIDDEN, Some("forbidden"));
    // issue.target @own covers tickets and events only.
    let targeted_report = post_issue(
        &app,
        &plain,
        json!({
            "branch_id": a, "type": "report", "title": "R", "targets": [{ "user_id": org.admin_a }]
        }),
    )
    .await;
    assert_status(&targeted_report, StatusCode::FORBIDDEN, None);
    // Privacy needs issue.set_private.
    let private =
        post_issue(&app, &plain, json!({ "branch_id": a, "type": "ticket", "title": "Secret", "is_private": true }))
            .await;
    assert_status(&private, StatusCode::FORBIDDEN, None);
    // Not their branch.
    let elsewhere =
        post_issue(&app, &plain, json!({ "branch_id": org.branch_b, "type": "ticket", "title": "X" })).await;
    assert_status(&elsewhere, StatusCode::NOT_FOUND, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn issue_input_is_validated_per_type(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let a = org.branch_a;
    let soon = (OffsetDateTime::now_utc() + Duration::days(1)).format(&Rfc3339).unwrap();
    let earlier = OffsetDateTime::now_utc().format(&Rfc3339).unwrap();

    let cases = [
        (json!({ "branch_id": a, "type": "memo", "title": "T" }), "invalid_issue_type"),
        (json!({ "branch_id": a, "type": "ticket", "title": "  " }), "invalid_title"),
        (json!({ "branch_id": a, "type": "ticket", "title": "x".repeat(201) }), "invalid_title"),
        (json!({ "branch_id": a, "type": "event", "title": "E" }), "event_required"),
        (
            json!({ "branch_id": a, "type": "ticket", "title": "T", "event": { "starts_at": soon, "ends_at": soon } }),
            "invalid_event",
        ),
        (
            json!({ "branch_id": a, "type": "event", "title": "E", "event": { "starts_at": soon, "ends_at": earlier } }),
            "invalid_event_range",
        ),
        (
            json!({ "branch_id": a, "type": "ticket", "title": "T", "completion_mode": "per_member" }),
            "invalid_completion_mode",
        ),
        (json!({ "branch_id": a, "type": "ticket", "title": "T", "sla_due_at": soon }), "invalid_sla"),
        (
            json!({ "branch_id": a, "type": "action", "title": "T", "targets": [{ "user_id": org.admin_b }] }),
            "invalid_target",
        ),
        (
            json!({ "branch_id": a, "type": "action", "title": "T", "targets": [{ "group_id": Uuid::new_v4() }] }),
            "invalid_target",
        ),
        (
            json!({ "branch_id": a, "type": "action", "title": "T", "targets": [{ "user_id": org.plain_a, "group_id": org.managers_group }] }),
            "invalid_target",
        ),
    ];
    for (body, code) in cases {
        let res = post_issue(&app, &admin, body.clone()).await;
        assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some(code));
    }

    // An archived group can't be targeted.
    sqlx::query!("UPDATE user_group SET archived_at = now() WHERE id = $1", org.managers_group)
        .execute(&app.db)
        .await
        .unwrap();
    let res = post_issue(
        &app,
        &admin,
        json!({ "branch_id": a, "type": "action", "title": "T", "targets": [{ "group_id": org.managers_group }] }),
    )
    .await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_target"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn targets_create_work_items_per_the_table(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let root = as_root(&app).await;
    let a = org.branch_a;
    let team = create_group(&app.db, a, "Team", &[], &[org.plain_a, org.multi, org.manager_a]).await;

    // user target: one assigned item, shared or per_member.
    for mode in ["shared", "per_member"] {
        let res = post_issue(&app, &admin, json!({
            "branch_id": a, "type": "action", "title": "U", "completion_mode": mode, "targets": [{ "user_id": org.plain_a }]
        }))
        .await;
        assert_status(&res, StatusCode::CREATED, None);
        assert_eq!(items(&res).len(), 1);
        assert_eq!(items(&res)[0]["assignee_id"], org.plain_a.to_string());
        assert_eq!(items(&res)[0]["status"], "open");
    }
    assert_eq!(notifications_of(&app.db, org.plain_a, "assigned").await, 2);

    // group shared: one unassigned item. per_member: one per current member.
    let shared = post_issue(
        &app,
        &admin,
        json!({ "branch_id": a, "type": "action", "title": "G", "targets": [{ "group_id": team }] }),
    )
    .await;
    assert_eq!(items(&shared).len(), 1);
    assert!(items(&shared)[0]["assignee_id"].is_null());
    let per_member = post_issue(&app, &admin, json!({
        "branch_id": a, "type": "report", "title": "G", "completion_mode": "per_member", "targets": [{ "group_id": team }]
    }))
    .await;
    let mut assignees: Vec<String> =
        items(&per_member).iter().map(|w| w["assignee_id"].as_str().unwrap().to_owned()).collect();
    assignees.sort();
    let mut expected = vec![org.plain_a.to_string(), org.multi.to_string(), org.manager_a.to_string()];
    expected.sort();
    assert_eq!(assignees, expected);
    // The snapshot doesn't follow later group changes.
    let latecomer = create_user(&app.db, NewUser::member("late@example.com", PW)).await;
    add_member(&app.db, a, latecomer).await;
    sqlx::query!("INSERT INTO group_member (group_id, user_id, branch_id) VALUES ($1, $2, $3)", team, latecomer, a)
        .execute(&app.db)
        .await
        .unwrap();
    let again = call(&app, &admin, Method::GET, &format!("/api/issues/{}", id_of(&per_member)), None).await;
    assert_eq!(items(&again).len(), 3);

    // Default SLAs: action 72 h, report 168 h; an explicit one wins.
    assert_eq!(hours_from_now(&items(&shared)[0]["sla_due_at"]), 72);
    assert_eq!(hours_from_now(&items(&per_member)[0]["sla_due_at"]), 168);
    let due = (OffsetDateTime::now_utc() + Duration::hours(5)).format(&Rfc3339).unwrap();
    let explicit = post_issue(
        &app,
        &admin,
        json!({
            "branch_id": a, "type": "action", "title": "S", "sla_due_at": due, "targets": [{ "user_id": org.plain_a }]
        }),
    )
    .await;
    assert_eq!(hours_from_now(&items(&explicit)[0]["sla_due_at"]), 5);

    // Whole-branch targets: super admin only. Shared: one unassigned item;
    // per_member: one per current branch member (the fixture's 5 + the latecomer).
    let branch_target = json!({ "branch_id": a, "type": "action", "title": "B", "targets": [{ "branch_id": a }] });
    assert_status(&post_issue(&app, &admin, branch_target.clone()).await, StatusCode::FORBIDDEN, None);
    let res = post_issue(&app, &root, branch_target).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(items(&res).len(), 1);
    assert!(items(&res)[0]["assignee_id"].is_null());
    assert_eq!(res.body["requires_super_admin_approval"], true);
    let res = post_issue(&app, &root, json!({
        "branch_id": a, "type": "action", "title": "B", "completion_mode": "per_member", "targets": [{ "branch_id": a }]
    }))
    .await;
    assert_eq!(items(&res).len(), 6);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn cross_branch_issues_are_for_super_admins_and_whole_branches(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;

    let body = json!({ "branch_id": null, "type": "action", "title": "All schools", "targets": [{ "branch_id": org.branch_a }, { "branch_id": org.branch_b }] });
    assert_status(&post_issue(&app, &admin, body.clone()).await, StatusCode::FORBIDDEN, None);
    let res = post_issue(&app, &root, body).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert!(res.body["branch_id"].is_null());
    assert_eq!(items(&res).len(), 2, "one unassigned item per branch");

    let no_targets = json!({ "branch_id": null, "type": "ticket", "title": "T" });
    assert_status(&post_issue(&app, &root, no_targets).await, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_target"));
    let user_target =
        json!({ "branch_id": null, "type": "ticket", "title": "T", "targets": [{ "user_id": org.plain_a }] });
    assert_status(
        &post_issue(&app, &root, user_target).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_target"),
    );

    // Members of both branches see it; the branch filter finds it in each.
    let multi = as_user(&app, "multi@example.com").await;
    let id = id_of(&res);
    for branch in [org.branch_a, org.branch_b] {
        let list = call(&app, &multi, Method::GET, &format!("/api/issues?branch_id={branch}"), None).await;
        assert!(list.body["items"].as_array().unwrap().iter().any(|i| i["id"] == id.as_str()));
    }
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn private_issues_are_404_for_outsiders_by_id_and_number(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;

    let res = post_issue(
        &app,
        &boss_like,
        json!({ "branch_id": org.branch_a, "type": "ticket", "title": "HR matter", "is_private": true }),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    let (id, number) = (id_of(&res), res.body["number"].as_i64().unwrap());

    for uri in
        [format!("/api/issues/{id}"), format!("/api/issues/by-number/{number}"), format!("/api/issues/{id}/history")]
    {
        assert_status(&call(&app, &plain, Method::GET, &uri, None).await, StatusCode::NOT_FOUND, Some("not_found"));
    }
    // Acting on it is 404 too, never 403.
    let res =
        call(&app, &plain, Method::PATCH, &format!("/api/issues/{id}"), Some(json!({ "version": 1, "title": "x" })))
            .await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    let res = call(&app, &plain, Method::PUT, &format!("/api/issues/{id}/watch"), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    let list = call(&app, &plain, Method::GET, "/api/issues", None).await;
    assert!(list.body["items"].as_array().unwrap().is_empty());

    // Targeting them reveals it.
    let res = call(
        &app,
        &boss_like,
        Method::POST,
        &format!("/api/issues/{id}/targets"),
        Some(json!({ "user_id": org.plain_a })),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_status(
        &call(&app, &plain, Method::GET, &format!("/api/issues/by-number/{number}"), None).await,
        StatusCode::OK,
        None,
    );

    // ...and removing the target hides it again.
    let target_id = res.body["targets"][0]["id"].as_str().unwrap().to_owned();
    let res = call(&app, &boss_like, Method::DELETE, &format!("/api/issues/{id}/targets/{target_id}"), None).await;
    assert_status(&res, StatusCode::OK, None);
    assert_status(
        &call(&app, &plain, Method::GET, &format!("/api/issues/{id}"), None).await,
        StatusCode::NOT_FOUND,
        None,
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn issue_lists_filter_search_and_page(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let a = org.branch_a;

    for i in 0..5 {
        post_issue(&app, &plain, json!({ "branch_id": a, "type": "ticket", "title": format!("Ticket {i}") })).await;
    }
    post_issue(
        &app,
        &admin,
        json!({ "branch_id": a, "type": "action", "title": "Fix 100%_done", "targets": [{ "user_id": org.plain_a }] }),
    )
    .await;
    let closed = post_issue(&app, &plain, json!({ "branch_id": a, "type": "report", "title": "Old report" })).await;
    call(&app, &plain, Method::POST, &format!("/api/issues/{}/close", id_of(&closed)), Some(json!({ "version": 1 })))
        .await;

    let count = |res: TestResponse| res.body["items"].as_array().unwrap().len();
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues", None).await), 7);
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues?type=ticket", None).await), 5);
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues?state=closed", None).await), 1);
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues?assignee=me", None).await), 1);
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues?q=TICKET%203", None).await), 1);
    // LIKE wildcards in the search are literal.
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues?q=100%25_", None).await), 1);
    assert_eq!(count(call(&app, &plain, Method::GET, "/api/issues?q=%25", None).await), 1);
    assert_status(
        &call(&app, &plain, Method::GET, "/api/issues?type=memo", None).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        None,
    );

    // Keyset pages: newest first, no duplicates, no gaps.
    let mut seen = Vec::new();
    let mut uri = "/api/issues?limit=3".to_owned();
    loop {
        let res = call(&app, &plain, Method::GET, &uri, None).await;
        seen.extend(res.body["items"].as_array().unwrap().iter().map(|i| i["number"].as_i64().unwrap()));
        match res.body["next_cursor"].as_str() {
            Some(c) => uri = format!("/api/issues?limit=3&after={c}"),
            None => break,
        }
    }
    let mut sorted = seen.clone();
    sorted.sort_unstable_by(|x, y| y.cmp(x));
    assert_eq!(seen, sorted);
    assert_eq!(seen.len(), 7);
}

// ---------------------------------------------------------------------------
// Editing and closing
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn edits_use_optimistic_locking(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let res = post_issue(
        &app,
        &plain,
        json!({ "branch_id": org.branch_a, "type": "ticket", "title": "Original", "description": "d" }),
    )
    .await;
    let uri = format!("/api/issues/{}", id_of(&res));

    let res = call(
        &app,
        &plain,
        Method::PATCH,
        &uri,
        Some(json!({ "version": 1, "title": "First", "priority": "high", "description": null })),
    )
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["version"], 2);
    assert_eq!(res.body["priority"], "high");
    assert!(res.body["description"].is_null());

    // A second client still holding version 1 loses.
    let stale = call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 1, "title": "Second" }))).await;
    assert_status(&stale, StatusCode::CONFLICT, Some("version_conflict"));
    let current = call(&app, &plain, Method::GET, &uri, None).await;
    assert_eq!(current.body["title"], "First");

    let bad = call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 2, "title": "" }))).await;
    assert_status(&bad, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_title"));
    let missing_version = call(&app, &plain, Method::PATCH, &uri, Some(json!({ "title": "x" }))).await;
    assert_status(&missing_version, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_body"));
    let event_on_ticket =
        call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 2, "event": { "all_day": true } }))).await;
    assert_status(&event_on_ticket, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_event"));

    let history = call(&app, &plain, Method::GET, &format!("{uri}/history"), None).await;
    let update = history.body["items"].as_array().unwrap().iter().find(|h| h["action"] == "update").unwrap();
    assert_eq!(update["old_value"], json!({ "title": "Original", "priority": "medium", "description": "d" }));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn editing_other_peoples_issues_needs_branch_scope_and_notifies_the_owner(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let manager = as_user(&app, "manager_a@example.com").await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;
    let res = post_issue(&app, &plain, json!({ "branch_id": org.branch_a, "type": "ticket", "title": "Mine" })).await;
    let uri = format!("/api/issues/{}", id_of(&res));

    // issue.edit @own doesn't reach other people's issues.
    let res = call(&app, &manager, Method::PATCH, &uri, Some(json!({ "version": 1, "title": "Theirs" }))).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
    // The owner can't make it private without issue.set_private.
    let res = call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 1, "is_private": true }))).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);

    let res = call(
        &app,
        &boss_like,
        Method::PATCH,
        &uri,
        Some(json!({ "version": 1, "title": "Edited", "is_private": true })),
    )
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(notifications_of(&app.db, org.plain_a, "changed_by_admin").await, 1);
    // Editing your own issue notifies nobody.
    call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 2, "title": "Mine again" }))).await;
    assert_eq!(notifications_of(&app.db, org.plain_a, "changed_by_admin").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn events_can_be_rescheduled(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let start = OffsetDateTime::now_utc() + Duration::days(2);
    let fmt = |t: OffsetDateTime| t.format(&Rfc3339).unwrap();
    let res = post_issue(
        &app,
        &plain,
        json!({
            "branch_id": org.branch_a, "type": "event", "title": "Trip",
            "event": { "starts_at": fmt(start), "ends_at": fmt(start + Duration::hours(3)) }
        }),
    )
    .await;
    let uri = format!("/api/issues/{}", id_of(&res));

    let res = call(&app, &plain, Method::PATCH, &uri, Some(json!({
        "version": 1, "event": { "starts_at": fmt(start + Duration::days(1)), "ends_at": fmt(start + Duration::days(1) + Duration::hours(3)), "location": "Museum" }
    })))
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["event"]["location"], "Museum");
    // Ends before it starts.
    let res =
        call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 2, "event": { "ends_at": fmt(start) } })))
            .await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_event_range"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn closing_cancels_remaining_work_and_freezes_the_issue(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let res = post_issue(
        &app,
        &admin,
        json!({
            "branch_id": org.branch_a, "type": "action", "title": "Two jobs",
            "targets": [{ "user_id": org.plain_a }, { "user_id": org.multi }]
        }),
    )
    .await;
    let id = id_of(&res);
    let uri = format!("/api/issues/{id}");

    // Someone else's action: plain can't close it.
    assert_status(
        &call(&app, &plain, Method::POST, &format!("{uri}/close"), Some(json!({ "version": 1 }))).await,
        StatusCode::FORBIDDEN,
        None,
    );
    assert_status(
        &call(&app, &admin, Method::POST, &format!("{uri}/close"), Some(json!({ "version": 9 }))).await,
        StatusCode::CONFLICT,
        Some("version_conflict"),
    );

    let res = call(&app, &admin, Method::POST, &format!("{uri}/close"), Some(json!({ "version": 1 }))).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["state"], "closed");
    assert_eq!(res.body["closed_by"], org.admin_a.to_string());
    assert!(items(&res).iter().all(|w| w["status"] == "cancelled"));

    // Closed issues can't be edited, retargeted or closed again.
    for (method, path, body) in [
        (Method::PATCH, uri.clone(), json!({ "version": 2, "title": "x" })),
        (Method::POST, format!("{uri}/close"), json!({ "version": 2 })),
        (Method::POST, format!("{uri}/cancel"), json!({ "version": 2 })),
        (Method::POST, format!("{uri}/targets"), json!({ "user_id": org.manager_a })),
    ] {
        assert_status(
            &call(&app, &admin, method, &path, Some(body)).await,
            StatusCode::CONFLICT,
            Some("issue_not_open"),
        );
    }

    // Creators cancel their own tickets.
    let ticket =
        post_issue(&app, &plain, json!({ "branch_id": org.branch_a, "type": "ticket", "title": "Never mind" })).await;
    let res = call(
        &app,
        &plain,
        Method::POST,
        &format!("/api/issues/{}/cancel", id_of(&ticket)),
        Some(json!({ "version": 1 })),
    )
    .await;
    assert_eq!(res.body["state"], "cancelled");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn super_admin_issues_are_closed_by_super_admins_only(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let res = post_issue(&app, &root, json!({ "branch_id": org.branch_a, "type": "action", "title": "From HQ", "targets": [{ "user_id": org.plain_a }] })).await;
    let uri = format!("/api/issues/{}", id_of(&res));

    assert_status(&call(&app, &admin, Method::GET, &uri, None).await, StatusCode::OK, None);
    for (method, path, body) in [
        (Method::PATCH, uri.clone(), json!({ "version": 1, "title": "x" })),
        (Method::POST, format!("{uri}/close"), json!({ "version": 1 })),
        (Method::POST, format!("{uri}/targets"), json!({ "user_id": org.manager_a })),
    ] {
        assert_status(&call(&app, &admin, method, &path, Some(body)).await, StatusCode::FORBIDDEN, None);
    }
    assert_status(
        &call(&app, &root, Method::POST, &format!("{uri}/close"), Some(json!({ "version": 1 }))).await,
        StatusCode::OK,
        None,
    );
}

// ---------------------------------------------------------------------------
// Targets after creation
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn adding_and_removing_targets_manages_work(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let due = (OffsetDateTime::now_utc() + Duration::hours(10)).format(&Rfc3339).unwrap();
    let res = post_issue(&app, &admin, json!({
        "branch_id": org.branch_a, "type": "action", "title": "Job", "sla_due_at": due, "targets": [{ "user_id": org.plain_a }]
    }))
    .await;
    let id = id_of(&res);
    let targets_uri = format!("/api/issues/{id}/targets");

    // A new target gets the issue's SLA.
    let res = call(&app, &admin, Method::POST, &targets_uri, Some(json!({ "user_id": org.multi }))).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(items(&res).len(), 2);
    assert!(items(&res).iter().all(|w| hours_from_now(&w["sla_due_at"]) == 10));
    let dup = call(&app, &admin, Method::POST, &targets_uri, Some(json!({ "user_id": org.multi }))).await;
    assert_status(&dup, StatusCode::CONFLICT, Some("target_exists"));

    // Removing one cancels its work (never deletes it).
    let multi_target =
        res.body["targets"].as_array().unwrap().iter().find(|t| t["user_id"] == org.multi.to_string()).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
    let res = call(&app, &admin, Method::DELETE, &format!("{targets_uri}/{multi_target}"), None).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["targets"].as_array().unwrap().len(), 1);
    let statuses: Vec<&str> = items(&res).iter().map(|w| w["status"].as_str().unwrap()).collect();
    assert_eq!(statuses.len(), 2);
    assert!(statuses.contains(&"cancelled") && statuses.contains(&"open"));
    assert_eq!(res.body["state"], "open");

    // It can be added again: a fresh item.
    let res = call(&app, &admin, Method::POST, &targets_uri, Some(json!({ "user_id": org.multi }))).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(items(&res).len(), 3);

    // Removing the last active work closes the issue automatically.
    let target_ids: Vec<String> =
        res.body["targets"].as_array().unwrap().iter().map(|t| t["id"].as_str().unwrap().to_owned()).collect();
    let mut last = res;
    for t in target_ids {
        last = call(&app, &admin, Method::DELETE, &format!("{targets_uri}/{t}"), None).await;
    }
    assert_eq!(last.body["state"], "closed");
    assert!(last.body["closed_by"].is_null(), "closed by the system");
    assert_eq!(audit_count(&app.db, "issue", "auto_close").await, 1);
    assert_eq!(audit_count(&app.db, "issue_target", "remove").await, 3);

    // Removing a target nobody can see is 404.
    let res = call(&app, &admin, Method::DELETE, &format!("{targets_uri}/{}", Uuid::new_v4()), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
}

// ---------------------------------------------------------------------------
// Watchers, read tracking, history
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn watching_and_unread_flags(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let res = post_issue(
        &app,
        &admin,
        json!({ "branch_id": org.branch_a, "type": "action", "title": "Job", "targets": [{ "user_id": org.plain_a }] }),
    )
    .await;
    let id = id_of(&res);
    let item = items(&res)[0]["id"].as_str().unwrap().to_owned();
    let uri = format!("/api/issues/{id}");

    let unread = |res: &TestResponse| {
        res.body["items"].as_array().unwrap().iter().find(|i| i["id"] == id.as_str()).unwrap()["unread"].clone()
    };
    assert_eq!(unread(&call(&app, &plain, Method::GET, "/api/issues", None).await), true);
    assert_status(&call(&app, &plain, Method::POST, &format!("{uri}/read"), None).await, StatusCode::NO_CONTENT, None);
    assert_eq!(unread(&call(&app, &plain, Method::GET, "/api/issues", None).await), false);
    // New activity on the work makes it unread again.
    call(&app, &plain, Method::POST, &format!("/api/work-items/{item}/start"), Some(json!({ "version": 1 }))).await;
    assert_eq!(unread(&call(&app, &plain, Method::GET, "/api/issues", None).await), true);

    assert_status(&call(&app, &plain, Method::PUT, &format!("{uri}/watch"), None).await, StatusCode::NO_CONTENT, None);
    assert_status(&call(&app, &plain, Method::PUT, &format!("{uri}/watch"), None).await, StatusCode::NO_CONTENT, None);
    assert_eq!(call(&app, &plain, Method::GET, &uri, None).await.body["watching"], true);
    assert_status(
        &call(&app, &plain, Method::DELETE, &format!("{uri}/watch"), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    assert_eq!(call(&app, &plain, Method::GET, &uri, None).await.body["watching"], false);

    let history = call(&app, &plain, Method::GET, &format!("{uri}/history"), None).await;
    let actions: Vec<(&str, &str)> = history.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| (h["entity_type"].as_str().unwrap(), h["action"].as_str().unwrap()))
        .collect();
    assert_eq!(
        actions,
        [("issue", "create"), ("issue_target", "add"), ("work_item", "create"), ("work_item", "start")]
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn history_names_the_branch_assignee_and_batch_with_rfc3339_times(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let due = (OffsetDateTime::now_utc() + Duration::days(2)).replace_nanosecond(123_456_000).unwrap();
    let res = post_issue(
        &app,
        &admin,
        json!({
            "branch_id": org.branch_a, "type": "action", "title": "Job", "targets": [{ "user_id": org.plain_a }],
            "sla_due_at": due.format(&Rfc3339).unwrap(),
        }),
    )
    .await;
    let id = id_of(&res);
    let item = items(&res)[0]["id"].as_str().unwrap().to_owned();
    call(&app, &plain, Method::POST, &format!("/api/work-items/{item}/start"), Some(json!({ "version": 1 }))).await;

    let history = call(&app, &plain, Method::GET, &format!("/api/issues/{id}/history"), None).await;
    let rows = history.body["items"].as_array().unwrap();
    assert_eq!(rows.len(), 4);
    // Creating writes the issue, its target and its work item in one batch; starting is another.
    let first = &rows[0]["id"];
    assert!(rows[..3].iter().all(|r| &r["batch_id"] == first));
    assert_eq!(rows[3]["batch_id"], rows[3]["id"]);

    let created = &rows[2];
    let at = OffsetDateTime::parse(created["new_value"]["sla_due_at"].as_str().unwrap(), &Rfc3339).unwrap();
    assert_eq!(at, due);
    for work in &rows[2..] {
        assert_eq!(work["branch_id"], json!(org.branch_a));
        assert_eq!(work["assignee_id"], json!(org.plain_a));
    }
    assert_eq!(rows[0]["branch_id"], json!(org.branch_a));
    assert_eq!(rows[0]["assignee_id"], Value::Null);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn migration_0006_rewrites_list_dates_as_rfc3339(pool: PgPool) {
    // 21 October 2026 (day 294), 13:43:00.066599174 at +02:00, as serde's default form wrote it.
    sqlx::raw_sql(
        r#"INSERT INTO audit_log (entity_type, entity_id, action, new_value) VALUES
           ('work_item', 'a', 'create', '{"sla_due_at": [2026, 294, 13, 43, 0, 66599174, 2, 0, 0], "x": 1}'),
           ('work_item', 'b', 'create', '{"sla_due_at": [2026, 294, 13, 43, 0, 0, 0, 0, 0]}'),
           ('work_item', 'c', 'create', '{"sla_due_at": "2026-10-21T13:43:00Z"}')"#,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!("../migrations/0006_audit_sla_rfc3339.sql")).execute(&pool).await.unwrap();

    let rows: Vec<(String, Value)> =
        sqlx::query_as("SELECT entity_id, new_value FROM audit_log WHERE entity_type = 'work_item' ORDER BY entity_id")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(rows[0].1, json!({ "sla_due_at": "2026-10-21T11:43:00.066599174Z", "x": 1 }));
    assert_eq!(rows[1].1, json!({ "sla_due_at": "2026-10-21T13:43:00Z" }));
    assert_eq!(rows[2].1, json!({ "sla_due_at": "2026-10-21T13:43:00Z" }));
    // The log is append-only again.
    assert!(sqlx::query("UPDATE audit_log SET action = 'x'").execute(&pool).await.is_err());
}
