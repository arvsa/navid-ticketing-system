//! Phase 7: the dashboard and the Excel export, both checked against the
//! filtered lists each actor gets from the normal API.

mod common;

use std::{collections::HashMap, io::Cursor};

use axum::http::{header, Method, StatusCode};
use backend::{
    authz::{authorize, relations, Action, Actor},
    db::MIGRATOR,
};
use calamine::{open_workbook_from_rs, Data, Reader, Xlsx};
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime, Time};
use uuid::Uuid;

fn fmt(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap()
}

fn enc(t: OffsetDateTime) -> String {
    fmt(t).replace('+', "%2B")
}

struct Ctx {
    app: TestApp,
    org: Org,
    cookies: HashMap<&'static str, String>,
    exporter: Uuid,
}

const ACTORS: [&str; 8] = ["root", "admin_a", "admin_b", "manager_a", "boss_like_a", "plain_a", "multi", "exporter"];

impl Ctx {
    fn c(&self, who: &str) -> &str {
        &self.cookies[who]
    }

    async fn post(&self, who: &str, uri: &str, body: Value) -> Value {
        let res = call(&self.app, self.c(who), Method::POST, uri, Some(body)).await;
        assert!(res.status.is_success(), "{uri}: {} {}", res.status, res.body);
        res.body
    }

    async fn issue(&self, who: &str, body: Value) -> Value {
        self.post(who, "/api/issues", body).await
    }

    async fn transition(&self, who: &str, item: &Value, t: &str, extra: Value) -> Value {
        let id = item["id"].as_str().unwrap();
        let version = call(&self.app, self.c("root"), Method::GET, &format!("/api/work-items/{id}"), None).await.body
            ["version"]
            .clone();
        let mut body = json!({ "version": version });
        body.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        self.post(who, &format!("/api/work-items/{id}/{t}"), body).await
    }

    /// Every item of a paged list.
    async fn all(&self, who: &str, uri: &str) -> Vec<Value> {
        let sep = if uri.contains('?') { '&' } else { '?' };
        let mut out = Vec::new();
        let mut next = format!("{uri}{sep}limit=200");
        loop {
            let res = call(&self.app, self.c(who), Method::GET, &next, None).await;
            assert_status(&res, StatusCode::OK, None);
            out.extend(res.body["items"].as_array().unwrap().iter().cloned());
            match res.body["next_cursor"].as_str() {
                Some(cur) => next = format!("{uri}{sep}limit=200&after={cur}"),
                None => return out,
            }
        }
    }

    async fn actor(&self, who: &str) -> Actor {
        let id = self.user(who);
        let is_super = sqlx::query_scalar!("SELECT is_super_admin FROM app_user WHERE id = $1", id)
            .fetch_one(&self.app.db)
            .await
            .unwrap();
        Actor::load(&self.app.db, id, is_super).await.unwrap()
    }

    fn user(&self, who: &str) -> Uuid {
        match who {
            "root" => self.org.root,
            "admin_a" => self.org.admin_a,
            "admin_b" => self.org.admin_b,
            "manager_a" => self.org.manager_a,
            "boss_like_a" => self.org.boss_like_a,
            "plain_a" => self.org.plain_a,
            "multi" => self.org.multi,
            "exporter" => self.exporter,
            other => panic!("unknown actor {other}"),
        }
    }
}

/// An organisation with a realistic mix of activity.
async fn seed(pool: PgPool) -> Ctx {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    // A member who may export and read public issues, but not private ones
    // or internal comments.
    let exporter = create_user(&app.db, NewUser::member("exporter@example.com", PW)).await;
    add_member(&app.db, org.branch_a, exporter).await;
    create_group(
        &app.db,
        org.branch_a,
        "Exporters",
        &[("export.run", None, "branch"), ("dashboard.branch", None, "branch")],
        &[exporter],
    )
    .await;

    let mut cookies = HashMap::new();
    cookies.insert("root", as_root(&app).await);
    for who in &ACTORS[1..] {
        cookies.insert(*who, as_user(&app, &format!("{who}@example.com")).await);
    }
    let c = Ctx { app, org, cookies, exporter };
    let (a, b) = (c.org.branch_a, c.org.branch_b);
    let now = OffsetDateTime::now_utc();

    // Tickets: public and private, one closed, with public and internal comments.
    let t1 = c.issue("plain_a", json!({ "branch_id": a, "type": "ticket", "title": "Printer" })).await;
    c.issue("boss_like_a", json!({ "branch_id": a, "type": "ticket", "title": "HR", "is_private": true })).await;
    let t3 = c.issue("manager_a", json!({ "branch_id": a, "type": "ticket", "title": "Old" })).await;
    c.post("manager_a", &format!("/api/issues/{}/close", t3["id"].as_str().unwrap()), json!({ "version": 1 })).await;
    c.issue("admin_b", json!({ "branch_id": b, "type": "ticket", "title": "In B" })).await;
    let t1_id = t1["id"].as_str().unwrap();
    c.post("plain_a", &format!("/api/issues/{t1_id}/comments"), json!({ "body": "still broken" })).await;
    c.post(
        "admin_a",
        &format!("/api/issues/{t1_id}/comments"),
        json!({ "body": "staff note", "is_internal_only": true }),
    )
    .await;

    // Actions: overdue, due within the week, far out, pending approval, approved, private.
    let due = |h: i64| fmt(now + Duration::hours(h));
    let mk = |title: &str, sla: String, targets: Value, private: bool| json!({ "branch_id": a, "type": "action", "title": title, "sla_due_at": sla, "targets": targets, "is_private": private });
    let overdue = c.issue("admin_a", mk("Overdue", due(-5), json!([{ "user_id": c.org.plain_a }]), false)).await;
    c.issue(
        "admin_a",
        mk("This week", due(50), json!([{ "user_id": c.org.multi }, { "user_id": c.org.manager_a }]), false),
    )
    .await;
    c.issue("admin_a", mk("Later", due(24 * 30), json!([{ "user_id": c.org.plain_a }]), false)).await;
    let pending = c
        .issue(
            "admin_a",
            mk("To approve", due(10), json!([{ "user_id": c.org.plain_a }, { "user_id": c.org.boss_like_a }]), false),
        )
        .await;
    let approved = c.issue("admin_a", mk("Approved", due(10), json!([{ "user_id": c.org.multi }]), false)).await;
    c.issue("boss_like_a", mk("Secret job", due(30), json!([{ "user_id": c.org.manager_a }]), true)).await;
    c.transition("plain_a", &overdue["work_items"][0], "start", json!({})).await;
    for item in pending["work_items"].as_array().unwrap() {
        let who = if item["assignee_id"] == c.org.plain_a.to_string() { "plain_a" } else { "boss_like_a" };
        c.transition(who, item, "submit", json!({})).await;
    }
    c.transition("multi", &approved["work_items"][0], "submit", json!({})).await;
    c.transition("admin_a", &approved["work_items"][0], "approve", json!({})).await;

    // A super admin action sent to both branches, pending in B.
    let cross = c
        .issue(
            "root",
            json!({
                "branch_id": null, "type": "action", "title": "HQ survey",
                "targets": [{ "branch_id": a }, { "branch_id": b }]
            }),
        )
        .await;
    let in_b =
        cross["work_items"].as_array().unwrap().iter().find(|w| w["branch_id"] == b.to_string()).unwrap().clone();
    c.transition("admin_b", &in_b, "assign", json!({ "assignee_id": c.org.multi })).await;
    c.transition("multi", &in_b, "submit", json!({})).await;

    // Reports: one submitted for approval, one draft, one self-filed.
    let report = c.issue("admin_a", json!({ "branch_id": a, "type": "report", "title": "Term", "targets": [{ "user_id": c.org.plain_a }, { "user_id": c.org.multi }] })).await;
    for item in report["work_items"].as_array().unwrap() {
        let who = if item["assignee_id"] == c.org.plain_a.to_string() { "plain_a" } else { "multi" };
        let rid = report["id"].as_str().unwrap();
        let r = c
            .post(
                who,
                &format!("/api/issues/{rid}/reports"),
                json!({ "title": "R", "body": "Body text", "work_item_id": item["id"] }),
            )
            .await;
        if who == "plain_a" {
            c.post(who, &format!("/api/reports/{}/submit", r["id"].as_str().unwrap()), json!({ "version": 1 })).await;
        }
    }
    let own = c.issue("manager_a", json!({ "branch_id": a, "type": "report", "title": "Incident" })).await;
    let own_id = own["id"].as_str().unwrap();
    let r = c
        .post(
            "manager_a",
            &format!("/api/issues/{own_id}/reports"),
            json!({ "title": "What happened", "body": "Details" }),
        )
        .await;
    c.post("manager_a", &format!("/api/reports/{}/submit", r["id"].as_str().unwrap()), json!({ "version": 1 })).await;

    // Events: soon (with RSVPs), next month, private, cancelled.
    let ev = |title: &str, days: i64, private: bool, targets: Value| {
        let start = now + Duration::days(days);
        json!({ "branch_id": a, "type": "event", "title": title, "is_private": private, "targets": targets,
                "event": { "starts_at": fmt(start), "ends_at": fmt(start + Duration::hours(2)), "location": "Hall" } })
    };
    let soon = c
        .issue(
            "boss_like_a",
            ev("Assembly", 3, false, json!([{ "user_id": c.org.plain_a }, { "user_id": c.org.multi }])),
        )
        .await;
    let soon_id = soon["id"].as_str().unwrap();
    call(
        &c.app,
        c.c("plain_a"),
        Method::PUT,
        &format!("/api/events/{soon_id}/rsvp"),
        Some(json!({ "response": "going" })),
    )
    .await;
    c.issue("boss_like_a", ev("Next month", 40, false, json!([]))).await;
    c.issue("boss_like_a", ev("Board", 5, true, json!([]))).await;
    let cancelled = c.issue("plain_a", ev("Cancelled", 6, false, json!([]))).await;
    c.post("plain_a", &format!("/api/issues/{}/cancel", cancelled["id"].as_str().unwrap()), json!({ "version": 1 }))
        .await;
    c
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn dashboard_numbers_match_the_filtered_lists_for_every_actor(pool: PgPool) {
    let c = seed(pool).await;
    let now = OffsetDateTime::now_utc();
    // Branches are UTC: the 7-day window ends at midnight after the 7th day.
    let window_end = (now.date() + Duration::days(8)).with_time(Time::MIDNIGHT).assume_utc();

    for who in ACTORS {
        let res = call(&c.app, c.c(who), Method::GET, "/api/dashboard", None).await;
        assert_status(&res, StatusCode::OK, None);
        let dash = &res.body;
        let actor = c.actor(who).await;

        for b in dash["branches"].as_array().unwrap() {
            let branch: Uuid = b["branch_id"].as_str().unwrap().parse().unwrap();
            let open = c.all(who, &format!("/api/issues?branch_id={branch}&state=open")).await;
            let tickets = open.iter().filter(|i| i["type"] == "ticket" && i["is_private"] == false).count();
            assert_eq!(b["open_public_tickets"], tickets, "{who}: public tickets in {}", b["code"]);

            let wide = authorize(&actor, Action::ViewBranchDashboard { branch_id: branch }).is_ok();
            assert_eq!(b["scope"], if wide { "branch" } else { "personal" }, "{who}");
            if !wide {
                assert!(b.get("open_issues_by_type").is_none() && b.get("work_items_by_status").is_none());
                continue;
            }
            for ty in ["ticket", "report", "event", "action"] {
                let n = open.iter().filter(|i| i["type"] == ty).count();
                assert_eq!(b["open_issues_by_type"][ty], n, "{who}: open {ty} in {}", b["code"]);
            }
            let items = c.all(who, &format!("/api/work-items?branch_id={branch}")).await;
            for status in ["open", "in_progress", "blocked", "pending_approval", "approved", "cancelled"] {
                let n = items.iter().filter(|w| w["status"] == status).count();
                assert_eq!(b["work_items_by_status"][status], n, "{who}: {status} in {}", b["code"]);
            }
            assert_eq!(b["overdue_work_items"], items.iter().filter(|w| w["is_overdue"] == true).count(), "{who}");
            let due_soon = items
                .iter()
                .filter(|w| ["open", "in_progress", "blocked"].contains(&w["status"].as_str().unwrap()))
                .filter_map(|w| w["sla_due_at"].as_str())
                .map(|s| OffsetDateTime::parse(s, &Rfc3339).unwrap())
                .filter(|at| *at >= now && *at < window_end)
                .count();
            assert_eq!(b["due_next_7_days"], due_soon, "{who}: due next 7 days in {}", b["code"]);
        }

        // The actor's own numbers.
        let mine = c.all(who, "/api/work-items?assignee=me").await;
        let open_mine =
            mine.iter().filter(|w| !["approved", "cancelled"].contains(&w["status"].as_str().unwrap())).count();
        assert_eq!(dash["mine"]["open_work_items"], open_mine, "{who}: my open work");

        let pending = c.all(who, "/api/work-items?status=pending_approval").await;
        let mut approvable = 0;
        for w in &pending {
            let item = relations::load_work_item(&c.app.db, &actor, w["id"].as_str().unwrap().parse().unwrap())
                .await
                .unwrap()
                .unwrap();
            if authorize(&actor, Action::ApproveWorkItem { item: &item }).is_ok() {
                approvable += 1;
            }
        }
        assert_eq!(dash["mine"]["awaiting_my_approval"], approvable, "{who}: awaiting my approval");

        let calendar =
            c.all(who, &format!("/api/calendar?from={}&to={}", enc(now), enc(now + Duration::days(14)))).await;
        let upcoming: Vec<&Value> = calendar
            .iter()
            .filter(|e| {
                e["state"] == "open"
                    && OffsetDateTime::parse(e["starts_at"].as_str().unwrap(), &Rfc3339).unwrap() >= now
            })
            .collect();
        let dash_events = dash["mine"]["upcoming_events"].as_array().unwrap();
        assert_eq!(dash_events.len(), upcoming.len(), "{who}: upcoming events");
        for (d, e) in dash_events.iter().zip(&upcoming) {
            assert_eq!(d["issue_id"], e["issue_id"]);
            assert_eq!(d["my_rsvp"], e["my_rsvp"]);
        }

        let unread = call(&c.app, c.c(who), Method::GET, "/api/notifications/unread-count", None).await;
        assert_eq!(dash["mine"]["unread_notifications"], unread.body["count"], "{who}: unread");
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn dashboard_scopes(pool: PgPool) {
    let c = seed(pool).await;
    let (a, b) = (c.org.branch_a, c.org.branch_b);
    let codes = |res: &TestResponse| -> Vec<(String, String)> {
        res.body["branches"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| (b["code"].as_str().unwrap().to_owned(), b["scope"].as_str().unwrap().to_owned()))
            .collect()
    };

    // Plain members: personal numbers only. Admins and dashboard.branch: branch-wide.
    let plain = call(&c.app, c.c("plain_a"), Method::GET, "/api/dashboard", None).await;
    assert_eq!(codes(&plain), [("AAA".to_owned(), "personal".to_owned())]);
    let boss = call(&c.app, c.c("boss_like_a"), Method::GET, "/api/dashboard", None).await;
    assert_eq!(codes(&boss), [("AAA".to_owned(), "branch".to_owned())]);
    // multi: plain member of both branches.
    let multi = call(&c.app, c.c("multi"), Method::GET, "/api/dashboard", None).await;
    assert_eq!(codes(&multi).len(), 2);
    // Super admins see every branch.
    let root = call(&c.app, c.c("root"), Method::GET, "/api/dashboard", None).await;
    assert_eq!(codes(&root), [("AAA".to_owned(), "branch".to_owned()), ("BBB".to_owned(), "branch".to_owned())]);

    // One branch: its numbers, and "mine" narrowed to it.
    let only_b = call(&c.app, c.c("multi"), Method::GET, &format!("/api/dashboard?branch_id={b}"), None).await;
    assert_eq!(codes(&only_b), [("BBB".to_owned(), "personal".to_owned())]);
    let only_a = call(&c.app, c.c("multi"), Method::GET, &format!("/api/dashboard?branch_id={a}"), None).await;
    assert_ne!(only_a.body["mine"]["open_work_items"], only_b.body["mine"]["open_work_items"]);
    // Someone else's branch: not found.
    let res = call(&c.app, c.c("plain_a"), Method::GET, &format!("/api/dashboard?branch_id={b}"), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

struct Book(Xlsx<Cursor<Vec<u8>>>);

impl Book {
    fn sheets(&self) -> Vec<String> {
        self.0.sheet_names()
    }

    /// Data rows (without the header).
    fn rows(&mut self, sheet: &str) -> Vec<Vec<Data>> {
        let range = self.0.worksheet_range(sheet).unwrap();
        range.rows().skip(1).map(|r| r.to_vec()).collect()
    }
}

async fn export(c: &Ctx, who: &str, query: &str) -> TestResponse {
    call(&c.app, c.c(who), Method::GET, &format!("/api/exports?{query}"), None).await
}

async fn open_book(res: TestResponse) -> Book {
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.headers[header::CONTENT_TYPE], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    Book(open_workbook_from_rs(Cursor::new(res.bytes)).expect("the workbook opens"))
}

fn text(cell: &Data) -> String {
    match cell {
        Data::String(s) => s.clone(),
        other => other.to_string(),
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn exported_sheets_match_the_filtered_data(pool: PgPool) {
    let c = seed(pool).await;
    let a = c.org.branch_a;

    for who in ["admin_a", "boss_like_a", "exporter"] {
        let mut book = open_book(export(&c, who, &format!("branch_ids={a}")).await).await;
        assert_eq!(book.sheets(), ["Tickets", "Actions", "Reports", "Events"]);

        let issues = c.all(who, &format!("/api/issues?branch_id={a}")).await;
        let of = |ty: &str| issues.iter().filter(|i| i["type"] == ty).collect::<Vec<_>>();
        assert_eq!(book.rows("Tickets").len(), of("ticket").len(), "{who}: tickets");
        assert_eq!(book.rows("Events").len(), of("event").len(), "{who}: events");

        // Actions: one row per work item in branch A on a visible action.
        let mut action_items = 0;
        for i in of("action") {
            let detail =
                call(&c.app, c.c(who), Method::GET, &format!("/api/issues/{}", i["id"].as_str().unwrap()), None).await;
            action_items += detail.body["work_items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|w| w["branch_id"] == a.to_string())
                .count();
        }
        assert_eq!(book.rows("Actions").len(), action_items, "{who}: action rows");

        // Reports: submitted reports only.
        let mut submitted = 0;
        for i in of("report") {
            let reports = c.all(who, &format!("/api/issues/{}/reports", i["id"].as_str().unwrap())).await;
            submitted += reports.iter().filter(|r| r["submitted_at"].is_string()).count();
        }
        assert_eq!(book.rows("Reports").len(), submitted, "{who}: report rows");

        // Comment counts include internal comments only for those who see them.
        let printer = book.rows("Tickets").into_iter().find(|r| text(&r[1]) == "Printer").unwrap();
        let expected_comments = if who == "exporter" { 1.0 } else { 2.0 };
        assert_eq!(printer[7], Data::Float(expected_comments), "{who}: comment count");
        // Private issues only for those who can read them.
        let titles: Vec<String> = book.rows("Tickets").iter().map(|r| text(&r[1])).collect();
        assert_eq!(titles.contains(&"HR".to_owned()), who != "exporter", "{who}");
    }
    assert_eq!(audit_count(&c.app.db, "export", "export").await, 3);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn multi_branch_exports_are_for_super_admins_only(pool: PgPool) {
    let c = seed(pool).await;
    let (a, b) = (c.org.branch_a, c.org.branch_b);
    let both = format!("branch_ids={a},{b}");

    for who in ["admin_a", "boss_like_a", "multi", "exporter"] {
        assert_status(&export(&c, who, &both).await, StatusCode::FORBIDDEN, Some("forbidden"));
        assert_status(&export(&c, who, "").await, StatusCode::FORBIDDEN, Some("forbidden"));
    }
    // Plain members can't export their branch; nobody exports a branch they aren't in.
    assert_status(&export(&c, "plain_a", &format!("branch_ids={a}")).await, StatusCode::FORBIDDEN, None);
    assert_status(&export(&c, "admin_a", &format!("branch_ids={b}")).await, StatusCode::NOT_FOUND, None);
    assert_status(&export(&c, "admin_a", &format!("branch_ids={}", Uuid::new_v4())).await, StatusCode::NOT_FOUND, None);

    // Super admins: several or all.
    let mut book = open_book(export(&c, "root", &both).await).await;
    let branches: Vec<String> = book.rows("Tickets").iter().map(|r| text(&r[2])).collect();
    assert!(branches.contains(&"AAA".to_owned()) && branches.contains(&"BBB".to_owned()));
    let all = export(&c, "root", "").await;
    assert!(all.headers[header::CONTENT_DISPOSITION].to_str().unwrap().contains("export-all-"));
    let audit = sqlx::query!("SELECT branch_id, new_value FROM audit_log WHERE entity_type = 'export' ORDER BY id")
        .fetch_all(&c.app.db)
        .await
        .unwrap();
    assert_eq!(audit.len(), 2, "refused exports aren't audited");
    assert!(audit.iter().all(|a| a.branch_id.is_none()));
    assert_eq!(audit[1].new_value.as_ref().unwrap()["all_branches"], true);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn export_filters_types_dates_and_formats_times_in_the_branch_timezone(pool: PgPool) {
    let c = seed(pool).await;
    let a = c.org.branch_a;

    let book = open_book(export(&c, "admin_a", &format!("branch_ids={a}&types=ticket,event")).await).await;
    assert_eq!(book.sheets(), ["Tickets", "Events"]);

    // Nothing was created in the future.
    let tomorrow = OffsetDateTime::now_utc() + Duration::days(1);
    let mut book =
        open_book(export(&c, "admin_a", &format!("branch_ids={a}&types=ticket&from={}", enc(tomorrow))).await).await;
    assert!(book.rows("Tickets").is_empty());

    // Times are written in the branch's timezone.
    sqlx::query!("UPDATE branch SET timezone = 'Asia/Tokyo' WHERE id = $1", a).execute(&c.app.db).await.unwrap();
    let created =
        sqlx::query_scalar!("SELECT created_at FROM issue WHERE title = 'Printer'").fetch_one(&c.app.db).await.unwrap();
    let mut book = open_book(export(&c, "admin_a", &format!("branch_ids={a}&types=ticket")).await).await;
    let row = book.rows("Tickets").into_iter().find(|r| text(&r[1]) == "Printer").unwrap();
    let Data::DateTime(cell) = &row[4] else { panic!("created at should be a date: {:?}", row[4]) };
    let tokyo = created.to_offset(time::UtcOffset::from_hms(9, 0, 0).unwrap());
    let excel_epoch = time::macros::datetime!(1899-12-30 0:00);
    let expected = (time::PrimitiveDateTime::new(tokyo.date(), tokyo.time()) - excel_epoch).as_seconds_f64() / 86_400.0;
    assert!((cell.as_f64() - expected).abs() < 1.0 / 86_400.0, "{} vs {expected}", cell.as_f64());

    for bad in ["types=memo", "branch_ids=nope", "from=yesterday"] {
        assert_status(&export(&c, "admin_a", bad).await, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_query"));
    }
}
