//! Phase 5: RSVPs generated from targets, the RSVP endpoint, reminders,
//! the calendar, and update / cancel notifications.

mod common;

use std::collections::BTreeSet;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};
use uuid::Uuid;

fn fmt(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap()
}

fn in_days(d: i64) -> OffsetDateTime {
    OffsetDateTime::now_utc() + Duration::days(d)
}

/// Event JSON starting `days` from now, two hours long.
fn event_body(branch: Uuid, title: &str, days: i64, targets: Value) -> Value {
    json!({
        "branch_id": branch, "type": "event", "title": title, "targets": targets,
        "event": { "starts_at": fmt(in_days(days)), "ends_at": fmt(in_days(days) + Duration::hours(2)), "location": "Hall" }
    })
}

async fn create(app: &TestApp, cookie: &str, body: Value) -> Value {
    let res = call(app, cookie, Method::POST, "/api/issues", Some(body)).await;
    assert_status(&res, StatusCode::CREATED, None);
    res.body
}

async fn invitees(db: &PgPool, issue: &str) -> BTreeSet<Uuid> {
    let id: Uuid = issue.parse().unwrap();
    sqlx::query_scalar!("SELECT user_id FROM event_rsvp WHERE issue_id = $1", id)
        .fetch_all(db)
        .await
        .unwrap()
        .into_iter()
        .collect()
}

async fn rsvp(app: &TestApp, cookie: &str, issue: &str, response: &str) -> TestResponse {
    call(app, cookie, Method::PUT, &format!("/api/events/{issue}/rsvp"), Some(json!({ "response": response }))).await
}

fn set(ids: &[Uuid]) -> BTreeSet<Uuid> {
    ids.iter().copied().collect()
}

// ---------------------------------------------------------------------------
// Invitees
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn rsvp_rows_exist_for_exactly_the_resolved_invitees(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let organizer = as_user(&app, "boss_like_a@example.com").await;
    let a = org.branch_a;

    // A group containing the organizer and an inactive member, plus a user target.
    let inactive = create_user(&app.db, NewUser::member("gone@example.com", PW)).await;
    add_member(&app.db, a, inactive).await;
    let team = create_group(&app.db, a, "Team", &[], &[org.multi, org.manager_a, org.boss_like_a, inactive]).await;
    sqlx::query!("UPDATE app_user SET is_active = false WHERE id = $1", inactive).execute(&app.db).await.unwrap();

    let event = create(
        &app,
        &organizer,
        event_body(a, "Staff party", 7, json!([{ "group_id": team }, { "user_id": org.plain_a }])),
    )
    .await;
    let id = event["id"].as_str().unwrap().to_owned();
    // Group members and the user target; not the organizer, not the inactive member.
    let expected = set(&[org.multi, org.manager_a, org.plain_a]);
    assert_eq!(invitees(&app.db, &id).await, expected);
    for user in &expected {
        assert_eq!(notifications_of(&app.db, *user, "event_invited").await, 1);
    }
    assert_eq!(notifications_of(&app.db, org.boss_like_a, "event_invited").await, 0);
    assert_eq!(event["event"]["rsvp_counts"], json!({ "going": 0, "maybe": 0, "declined": 0, "pending": 3 }));
    assert!(event["event"]["my_rsvp"].is_null(), "the organizer isn't invited");

    // A new target invites only new people, who alone are notified.
    let targets_uri = format!("/api/issues/{id}/targets");
    let res = call(&app, &organizer, Method::POST, &targets_uri, Some(json!({ "user_id": org.admin_a }))).await;
    assert_status(&res, StatusCode::CREATED, None);
    let mut with_admin = expected.clone();
    with_admin.insert(org.admin_a);
    assert_eq!(invitees(&app.db, &id).await, with_admin);
    assert_eq!(notifications_of(&app.db, org.multi, "event_invited").await, 1);
    assert_eq!(notifications_of(&app.db, org.admin_a, "event_invited").await, 1);
    // Overlapping targets don't duplicate anyone.
    call(&app, &organizer, Method::POST, &targets_uri, Some(json!({ "user_id": org.multi }))).await;
    assert_eq!(invitees(&app.db, &id).await.len(), 4);

    // Removing the group drops the people only it covered.
    let group_target =
        res.body["targets"].as_array().unwrap().iter().find(|t| t["group_id"] == team.to_string()).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
    call(&app, &organizer, Method::DELETE, &format!("{targets_uri}/{group_target}"), None).await;
    assert_eq!(invitees(&app.db, &id).await, set(&[org.plain_a, org.admin_a, org.multi]));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn whole_branch_events_invite_every_current_member(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let leaver = create_user(&app.db, NewUser::member("leaver@example.com", PW)).await;
    add_member(&app.db, org.branch_b, leaver).await;
    sqlx::query!("UPDATE branch_membership SET left_at = now() WHERE user_id = $1", leaver)
        .execute(&app.db)
        .await
        .unwrap();

    let event = create(
        &app,
        &root,
        json!({
            "branch_id": null, "type": "event", "title": "All-school assembly",
            "targets": [{ "branch_id": org.branch_a }, { "branch_id": org.branch_b }],
            "event": { "starts_at": fmt(in_days(3)), "ends_at": fmt(in_days(3) + Duration::hours(1)), "all_day": false }
        }),
    )
    .await;
    let everyone = set(&[org.admin_a, org.manager_a, org.boss_like_a, org.plain_a, org.multi, org.admin_b]);
    assert_eq!(invitees(&app.db, event["id"].as_str().unwrap()).await, everyone);
}

// ---------------------------------------------------------------------------
// RSVPs
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn invitees_answer_and_others_cannot(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let organizer = as_user(&app, "boss_like_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let multi = as_user(&app, "multi@example.com").await;
    let event =
        create(&app, &organizer, event_body(org.branch_a, "Trip", 5, json!([{ "user_id": org.plain_a }]))).await;
    let id = event["id"].as_str().unwrap().to_owned();

    let res = call(
        &app,
        &plain,
        Method::PUT,
        &format!("/api/events/{id}/rsvp"),
        Some(json!({ "response": "maybe", "note": " Depends on the bus " })),
    )
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["response"], "maybe");
    assert_eq!(res.body["note"], "Depends on the bus");
    assert!(res.body["responded_at"].is_string());

    // A reader who isn't invited: 403. Pending isn't an answer.
    assert_status(&rsvp(&app, &multi, &id, "going").await, StatusCode::FORBIDDEN, Some("not_invited"));
    assert_status(
        &rsvp(&app, &plain, &id, "pending").await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_response"),
    );
    assert_status(&rsvp(&app, &plain, &id, "sure").await, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_body"));

    // Everyone who can read it sees the answers.
    let list = call(&app, &multi, Method::GET, &format!("/api/events/{id}/rsvps"), None).await;
    assert_status(&list, StatusCode::OK, None);
    assert_eq!(list.body["counts"]["maybe"], 1);
    assert_eq!(list.body["items"][0]["user_id"], org.plain_a.to_string());
    let detail = call(&app, &plain, Method::GET, &format!("/api/issues/{id}"), None).await;
    assert_eq!(detail.body["event"]["my_rsvp"], "maybe");

    // Not an event, or not readable: 404.
    let ticket = create(&app, &plain, json!({ "branch_id": org.branch_a, "type": "ticket", "title": "T" })).await;
    assert_status(&rsvp(&app, &plain, ticket["id"].as_str().unwrap(), "going").await, StatusCode::NOT_FOUND, None);
    let private = create(
        &app,
        &organizer,
        json!({
            "branch_id": org.branch_a, "type": "event", "title": "Secret", "is_private": true,
            "event": { "starts_at": fmt(in_days(2)), "ends_at": fmt(in_days(2)) }
        }),
    )
    .await;
    assert_status(&rsvp(&app, &multi, private["id"].as_str().unwrap(), "going").await, StatusCode::NOT_FOUND, None);

    // Cancelled events take no more answers.
    call(&app, &organizer, Method::POST, &format!("/api/issues/{id}/cancel"), Some(json!({ "version": 1 }))).await;
    assert_status(&rsvp(&app, &plain, &id, "going").await, StatusCode::CONFLICT, Some("event_not_open"));
}

// ---------------------------------------------------------------------------
// Updates and cancellation
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn a_time_change_resets_rsvps_and_notifies_the_right_people(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let organizer = as_user(&app, "boss_like_a@example.com").await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let event = create(&app, &organizer, event_body(org.branch_a, "Concert", 10, json!([
        { "user_id": org.plain_a }, { "user_id": org.multi }, { "user_id": org.manager_a }, { "user_id": org.admin_a }
    ])))
    .await;
    let id = event["id"].as_str().unwrap().to_owned();
    let uri = format!("/api/issues/{id}");

    // plain going, multi maybe, manager declined, admin hasn't answered.
    for (email, answer) in
        [("plain_a@example.com", "going"), ("multi@example.com", "maybe"), ("manager_a@example.com", "declined")]
    {
        let cookie = as_user(&app, email).await;
        assert_status(&rsvp(&app, &cookie, &id, answer).await, StatusCode::OK, None);
    }
    let updated = |user: Uuid| notifications_of(&app.db, user, "event_updated");

    // A title change notifies nobody.
    call(&app, &organizer, Method::PATCH, &uri, Some(json!({ "version": 1, "title": "Spring concert" }))).await;
    assert_eq!(updated(org.plain_a).await, 0);

    // A location change notifies going and maybe; nobody's answer changes.
    let res =
        call(&app, &organizer, Method::PATCH, &uri, Some(json!({ "version": 2, "event": { "location": "Gym" } })))
            .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!((updated(org.plain_a).await, updated(org.multi).await), (1, 1));
    assert_eq!((updated(org.manager_a).await, updated(org.admin_a).await), (0, 0));
    assert_eq!(res.body["event"]["rsvp_counts"], json!({ "going": 1, "maybe": 1, "declined": 1, "pending": 1 }));

    // A time change (by an admin) notifies the same people and resets their answers.
    let later = in_days(11);
    let res = call(
        &app,
        &admin,
        Method::PATCH,
        &uri,
        Some(json!({
            "version": 3, "event": { "starts_at": fmt(later), "ends_at": fmt(later + Duration::hours(2)) }
        })),
    )
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!((updated(org.plain_a).await, updated(org.multi).await), (2, 2));
    assert_eq!(
        (updated(org.manager_a).await, updated(org.admin_a).await),
        (0, 0),
        "declined and pending aren't told; the editor never is"
    );
    assert_eq!(res.body["event"]["rsvp_counts"], json!({ "going": 0, "maybe": 0, "declined": 1, "pending": 3 }));
    let reset = sqlx::query!(
        r#"SELECT count(*) AS "n!" FROM event_rsvp WHERE response = 'pending' AND responded_at IS NOT NULL"#
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(reset.n, 0, "reset answers clear responded_at");
    // The organizer hears that an admin changed their event.
    assert_eq!(notifications_of(&app.db, org.boss_like_a, "changed_by_admin").await, 1);
    let payload = sqlx::query_scalar!(
        "SELECT payload FROM notification WHERE recipient_id = $1 AND kind = 'event_updated' ORDER BY id DESC LIMIT 1",
        org.plain_a
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(payload, json!({ "changes": ["time"], "rsvp_reset": true }));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn cancelling_notifies_everyone_who_has_not_declined(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let organizer = as_user(&app, "boss_like_a@example.com").await;
    let event = create(
        &app,
        &organizer,
        event_body(
            org.branch_a,
            "Fair",
            4,
            json!([
                { "user_id": org.plain_a }, { "user_id": org.multi }, { "user_id": org.manager_a }
            ]),
        ),
    )
    .await;
    let id = event["id"].as_str().unwrap().to_owned();
    rsvp(&app, &as_user(&app, "plain_a@example.com").await, &id, "going").await;
    rsvp(&app, &as_user(&app, "manager_a@example.com").await, &id, "declined").await;

    let res =
        call(&app, &organizer, Method::POST, &format!("/api/issues/{id}/cancel"), Some(json!({ "version": 1 }))).await;
    assert_eq!(res.body["state"], "cancelled");
    assert_eq!(notifications_of(&app.db, org.plain_a, "event_cancelled").await, 1);
    assert_eq!(notifications_of(&app.db, org.multi, "event_cancelled").await, 1, "pending invitees are told");
    assert_eq!(notifications_of(&app.db, org.manager_a, "event_cancelled").await, 0);
    assert_eq!(notifications_of(&app.db, org.boss_like_a, "event_cancelled").await, 0);

    // Closing (rather than cancelling) an event notifies nobody.
    let other = create(&app, &organizer, event_body(org.branch_a, "Other", 4, json!([{ "user_id": org.multi }]))).await;
    call(
        &app,
        &organizer,
        Method::POST,
        &format!("/api/issues/{}/close", other["id"].as_str().unwrap()),
        Some(json!({ "version": 1 })),
    )
    .await;
    assert_eq!(notifications_of(&app.db, org.multi, "event_cancelled").await, 1);
}

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn reminders_default_validate_and_replace(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let event = create(&app, &plain, event_body(org.branch_a, "Default", 2, json!([]))).await;
    assert_eq!(event["event"]["reminders"], json!([1440, 60]));

    let mut body = event_body(org.branch_a, "Custom", 2, json!([]));
    body["event"]["reminders"] = json!([15, 10080, 15]);
    let custom = create(&app, &plain, body).await;
    assert_eq!(custom["event"]["reminders"], json!([10080, 15]));

    for bad in [json!([0]), json!([40321]), json!((1..=11).collect::<Vec<i32>>())] {
        let mut body = event_body(org.branch_a, "Bad", 2, json!([]));
        body["event"]["reminders"] = bad;
        let res = call(&app, &plain, Method::POST, "/api/issues", Some(body)).await;
        assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_reminders"));
    }

    let uri = format!("/api/issues/{}", custom["id"].as_str().unwrap());
    let res =
        call(&app, &plain, Method::PATCH, &uri, Some(json!({ "version": 1, "event": { "reminders": [] } }))).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["event"]["reminders"], json!([]));
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn calendar_shows_readable_events_in_the_window_with_my_rsvp(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let organizer = as_user(&app, "boss_like_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let admin_b = as_user(&app, "admin_b@example.com").await;

    let soon = create(&app, &organizer, event_body(org.branch_a, "Soon", 2, json!([{ "user_id": org.plain_a }]))).await;
    create(&app, &organizer, event_body(org.branch_a, "Later", 20, json!([]))).await;
    create(
        &app,
        &organizer,
        json!({
            "branch_id": org.branch_a, "type": "event", "title": "Board meeting", "is_private": true,
            "event": { "starts_at": fmt(in_days(3)), "ends_at": fmt(in_days(3) + Duration::hours(1)) }
        }),
    )
    .await;
    // Spans into the window from before it.
    create(
        &app,
        &organizer,
        json!({
            "branch_id": org.branch_a, "type": "event", "title": "Exhibition",
            "event": { "starts_at": fmt(in_days(-2)), "ends_at": fmt(in_days(5)), "all_day": true }
        }),
    )
    .await;
    rsvp(&app, &plain, soon["id"].as_str().unwrap(), "going").await;

    let window = |from: OffsetDateTime, to: OffsetDateTime| {
        format!("/api/calendar?from={}&to={}", fmt(from).replace('+', "%2B"), fmt(to).replace('+', "%2B"))
    };
    let titles = |res: &TestResponse| -> Vec<String> {
        res.body["items"].as_array().unwrap().iter().map(|e| e["title"].as_str().unwrap().to_owned()).collect()
    };
    let next_week = window(OffsetDateTime::now_utc(), in_days(7));

    let res = call(&app, &plain, Method::GET, &next_week, None).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(titles(&res), ["Exhibition", "Soon"], "earliest first; the private one is hidden; Later is outside");
    assert_eq!(res.body["items"][1]["my_rsvp"], "going");
    assert!(res.body["items"][0]["my_rsvp"].is_null());
    assert_eq!(res.body["items"][0]["all_day"], true);

    let admin = as_user(&app, "admin_a@example.com").await;
    let res = call(&app, &admin, Method::GET, &next_week, None).await;
    assert_eq!(titles(&res), ["Exhibition", "Soon", "Board meeting"]);

    // Other branches' events aren't there; the branch filter narrows further.
    assert!(titles(&call(&app, &admin_b, Method::GET, &next_week, None).await).is_empty());
    let res = call(&app, &admin, Method::GET, &format!("{next_week}&branch_id={}", org.branch_b), None).await;
    assert!(titles(&res).is_empty());
    let month = window(OffsetDateTime::now_utc(), in_days(30));
    assert_eq!(titles(&call(&app, &plain, Method::GET, &month, None).await).len(), 3);

    // Bad windows.
    let backwards = window(in_days(7), OffsetDateTime::now_utc());
    assert_status(
        &call(&app, &plain, Method::GET, &backwards, None).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_range"),
    );
    let huge = window(OffsetDateTime::now_utc(), in_days(400));
    assert_status(
        &call(&app, &plain, Method::GET, &huge, None).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_range"),
    );
    assert_status(
        &call(&app, &plain, Method::GET, "/api/calendar?from=yesterday&to=today", None).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_query"),
    );
}
