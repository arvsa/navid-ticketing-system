//! Phase 3: the work item state machine (7.3), approvals, claiming,
//! assigning, the Report submit gate, auto-close and optimistic locking.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

struct Ctx {
    app: TestApp,
    org: Org,
    root: String,
    admin: String,
    boss_like: String,
    plain: String,
    multi: String,
}

async fn setup(pool: PgPool) -> Ctx {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    Ctx {
        root: as_root(&app).await,
        admin: as_user(&app, "admin_a@example.com").await,
        boss_like: as_user(&app, "boss_like_a@example.com").await,
        plain: as_user(&app, "plain_a@example.com").await,
        multi: as_user(&app, "multi@example.com").await,
        app,
        org,
    }
}

impl Ctx {
    /// Creates an issue as `cookie` and returns (issue id, work items).
    async fn issue(&self, cookie: &str, body: Value) -> (String, Vec<Value>) {
        let res = call(&self.app, cookie, Method::POST, "/api/issues", Some(body)).await;
        assert_status(&res, StatusCode::CREATED, None);
        (res.body["id"].as_str().unwrap().to_owned(), res.body["work_items"].as_array().unwrap().clone())
    }

    /// An action for plain_a and multi (two items, so finishing one doesn't
    /// close the issue). Returns plain_a's item id.
    async fn action_for_plain(&self) -> String {
        let (_, items) = self
            .issue(
                &self.admin,
                json!({
                    "branch_id": self.org.branch_a, "type": "action", "title": "Job",
                    "targets": [{ "user_id": self.org.plain_a }, { "user_id": self.org.multi }]
                }),
            )
            .await;
        items.iter().find(|w| w["assignee_id"] == self.org.plain_a.to_string()).unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    }

    async fn item(&self, id: &str) -> Value {
        call(&self.app, &self.admin, Method::GET, &format!("/api/work-items/{id}"), None).await.body
    }

    async fn version(&self, id: &str) -> i64 {
        self.item(id).await["version"].as_i64().unwrap()
    }

    /// Applies a transition with the item's current version.
    async fn go(&self, cookie: &str, id: &str, transition: &str, extra: Value) -> TestResponse {
        let mut body = json!({ "version": self.version(id).await });
        if let Value::Object(more) = extra {
            body.as_object_mut().unwrap().extend(more);
        }
        call(&self.app, cookie, Method::POST, &format!("/api/work-items/{id}/{transition}"), Some(body)).await
    }

    async fn ok(&self, cookie: &str, id: &str, transition: &str, extra: Value) -> Value {
        let res = self.go(cookie, id, transition, extra).await;
        assert_status(&res, StatusCode::OK, None);
        res.body
    }

    /// The right actor for each transition in the 7.3 table.
    fn actor_for(&self, transition: &str) -> &str {
        match transition {
            "approve" | "reject" | "cancel" => &self.admin,
            _ => &self.plain,
        }
    }

    async fn drive_to(&self, id: &str, state: &str) {
        let steps: &[&str] = match state {
            "open" => &[],
            "in_progress" => &["start"],
            "blocked" => &["start", "block"],
            "pending_approval" => &["submit"],
            "approved" => &["submit", "approve"],
            "cancelled" => &["cancel"],
            other => panic!("unknown state {other}"),
        };
        for step in steps {
            self.ok(self.actor_for(step), id, step, json!({ "note": "ok" })).await;
        }
        assert_eq!(self.item(id).await["status"], state);
    }
}

// ---------------------------------------------------------------------------
// The full transition table
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn every_state_and_transition_pair(pool: PgPool) {
    let c = setup(pool).await;
    let states = ["open", "in_progress", "blocked", "pending_approval", "approved", "cancelled"];
    let transitions = ["start", "block", "unblock", "submit", "approve", "reject", "cancel"];
    let valid = |state: &str, t: &str| -> Option<&'static str> {
        Some(match (state, t) {
            ("open", "start") => "in_progress",
            ("open" | "in_progress" | "blocked", "submit") => "pending_approval",
            ("in_progress", "block") => "blocked",
            ("blocked", "unblock") => "in_progress",
            ("pending_approval", "approve") => "approved",
            ("pending_approval", "reject") => "in_progress",
            ("open" | "in_progress" | "blocked" | "pending_approval", "cancel") => "cancelled",
            _ => return None,
        })
    };

    for state in states {
        for t in transitions {
            let id = c.action_for_plain().await;
            c.drive_to(&id, state).await;
            let res = c.go(c.actor_for(t), &id, t, json!({ "note": "because" })).await;
            match valid(state, t) {
                Some(next) => {
                    assert_status(&res, StatusCode::OK, None);
                    assert_eq!(res.body["status"], next, "{state} --{t}-->");
                }
                None => {
                    assert_eq!(res.status, StatusCode::CONFLICT, "{state} --{t}--> should be refused: {}", res.body);
                    assert_eq!(res.error_code(), Some("invalid_transition"), "{state} --{t}-->");
                    assert_eq!(c.item(&id).await["status"], state, "a refused transition changes nothing");
                }
            }
        }
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn stale_versions_are_refused(pool: PgPool) {
    let c = setup(pool).await;
    let id = c.action_for_plain().await;
    let uri = format!("/api/work-items/{id}");

    let res = call(&c.app, &c.plain, Method::POST, &format!("{uri}/start"), Some(json!({ "version": 1 }))).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["version"], 2);
    let stale = call(&c.app, &c.plain, Method::POST, &format!("{uri}/submit"), Some(json!({ "version": 1 }))).await;
    assert_status(&stale, StatusCode::CONFLICT, Some("version_conflict"));
    assert_eq!(c.item(&id).await["status"], "in_progress");
    let missing = call(&c.app, &c.plain, Method::POST, &format!("{uri}/submit"), Some(json!({}))).await;
    assert_status(&missing, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_body"));
    let unknown = call(&c.app, &c.plain, Method::POST, &format!("{uri}/explode"), Some(json!({ "version": 2 }))).await;
    assert_status(&unknown, StatusCode::NOT_FOUND, None);
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn approval_rules(pool: PgPool) {
    let c = setup(pool).await;
    let id = c.action_for_plain().await;
    c.ok(&c.plain, &id, "submit", json!({})).await;
    // Everyone who can approve hears about it; the submitter doesn't.
    assert_eq!(notifications_of(&c.app.db, c.org.admin_a, "submitted_for_approval").await, 1);
    assert_eq!(notifications_of(&c.app.db, c.org.boss_like_a, "submitted_for_approval").await, 1);
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "submitted_for_approval").await, 0);
    assert_eq!(notifications_of(&c.app.db, c.org.manager_a, "submitted_for_approval").await, 0);

    // Plain members can't decide; nobody decides on their own work.
    assert_status(&c.go(&c.multi, &id, "approve", json!({})).await, StatusCode::FORBIDDEN, None);
    assert_status(&c.go(&c.plain, &id, "approve", json!({})).await, StatusCode::FORBIDDEN, None);

    // Rejection needs a note.
    let res = c.go(&c.boss_like, &id, "reject", json!({ "note": "   " })).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("note_required"));
    let rejected = c.ok(&c.boss_like, &id, "reject", json!({ "note": "Missing the photos" })).await;
    assert_eq!(rejected["status"], "in_progress");
    assert_eq!(rejected["decision_note"], "Missing the photos");
    assert_eq!(rejected["decided_by"], c.org.boss_like_a.to_string());
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "rejected").await, 1);

    c.ok(&c.plain, &id, "submit", json!({})).await;
    let approved = c.ok(&c.admin, &id, "approve", json!({})).await;
    assert_eq!(approved["status"], "approved");
    assert!(approved["decided_at"].is_string());
    assert!(approved["decision_note"].is_null());
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "approved").await, 1);

    // Self-approval: even an admin can't approve their own work.
    let (_, items) = c
        .issue(&c.root, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "Admin job", "targets": [{ "user_id": c.org.admin_a }] }))
        .await;
    let own = items[0]["id"].as_str().unwrap().to_owned();
    c.ok(&c.admin, &own, "submit", json!({})).await;
    assert_status(&c.go(&c.admin, &own, "approve", json!({})).await, StatusCode::FORBIDDEN, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn super_admin_work_is_approved_by_super_admins_only(pool: PgPool) {
    let c = setup(pool).await;
    let (issue, items) = c
        .issue(&c.root, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "HQ job", "targets": [{ "user_id": c.org.plain_a }] }))
        .await;
    let id = items[0]["id"].as_str().unwrap().to_owned();

    // Branch admins may still assign and update their branch's work...
    c.ok(&c.admin, &id, "assign", json!({ "assignee_id": c.org.multi })).await;
    c.ok(&c.admin, &id, "assign", json!({ "assignee_id": c.org.plain_a })).await;
    c.ok(&c.plain, &id, "submit", json!({})).await;
    // ...but not approve, reject or cancel it.
    for t in ["approve", "reject", "cancel"] {
        assert_status(&c.go(&c.admin, &id, t, json!({ "note": "n" })).await, StatusCode::FORBIDDEN, None);
        assert_status(&c.go(&c.boss_like, &id, t, json!({ "note": "n" })).await, StatusCode::FORBIDDEN, None);
    }
    assert_eq!(notifications_of(&c.app.db, c.org.admin_a, "submitted_for_approval").await, 0);
    assert_eq!(notifications_of(&c.app.db, c.org.root, "submitted_for_approval").await, 1);

    c.ok(&c.root, &id, "approve", json!({})).await;
    // The only item is done: the issue closed itself.
    let issue = call(&c.app, &c.root, Method::GET, &format!("/api/issues/{issue}"), None).await;
    assert_eq!(issue.body["state"], "closed");
    assert!(issue.body["closed_by"].is_null());
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn reports_need_a_submitted_report_before_submission(pool: PgPool) {
    let c = setup(pool).await;
    let (issue, items) = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "report", "title": "Term report", "targets": [{ "user_id": c.org.plain_a }] }))
        .await;
    let id = items[0]["id"].as_str().unwrap().to_owned();
    let (issue_id, item_id): (Uuid, Uuid) = (issue.parse().unwrap(), id.parse().unwrap());

    let res = c.go(&c.plain, &id, "submit", json!({})).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("report_required"));

    // A draft isn't enough.
    sqlx::query!(
        "INSERT INTO issue_report (issue_id, work_item_id, author_id, title, body) VALUES ($1, $2, $3, 'Draft', 'wip')",
        issue_id,
        item_id,
        c.org.plain_a
    )
    .execute(&c.app.db)
    .await
    .unwrap();
    assert_status(
        &c.go(&c.plain, &id, "submit", json!({})).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("report_required"),
    );

    sqlx::query!("UPDATE issue_report SET submitted_at = now() WHERE work_item_id = $1", item_id)
        .execute(&c.app.db)
        .await
        .unwrap();
    let res = c.ok(&c.plain, &id, "submit", json!({})).await;
    assert_eq!(res["status"], "pending_approval");
    assert!(res["submitted_at"].is_string());
}

// ---------------------------------------------------------------------------
// Claiming and assigning
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn shared_group_work_is_claimed_once(pool: PgPool) {
    let c = setup(pool).await;
    let team = create_group(&c.app.db, c.org.branch_a, "Team", &[], &[c.org.plain_a, c.org.multi]).await;
    let (_, items) = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "Anyone", "targets": [{ "group_id": team }] }))
        .await;
    let id = items[0]["id"].as_str().unwrap().to_owned();

    // Nobody works on unassigned work.
    assert_status(&c.go(&c.plain, &id, "start", json!({})).await, StatusCode::CONFLICT, Some("not_assigned"));
    // Outside the group: can't claim.
    let manager = as_user(&c.app, "manager_a@example.com").await;
    assert_status(&c.go(&manager, &id, "claim", json!({})).await, StatusCode::FORBIDDEN, None);

    let claimed = c.ok(&c.plain, &id, "claim", json!({})).await;
    assert_eq!(claimed["assignee_id"], c.org.plain_a.to_string());
    assert_eq!(claimed["status"], "open");
    // Second claimer is too late; and claiming isn't reassigning.
    assert_status(&c.go(&c.multi, &id, "claim", json!({})).await, StatusCode::FORBIDDEN, None);
    assert_status(&c.go(&c.plain, &id, "claim", json!({})).await, StatusCode::CONFLICT, Some("already_assigned"));
    c.ok(&c.plain, &id, "start", json!({})).await;
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn only_shared_group_work_is_claimable(pool: PgPool) {
    let c = setup(pool).await;
    // Whole-branch work: the admin assigns it.
    let (_, items) = c
        .issue(&c.root, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "Branch job", "targets": [{ "branch_id": c.org.branch_a }] }))
        .await;
    let branch_item = items[0]["id"].as_str().unwrap().to_owned();
    assert_status(&c.go(&c.plain, &branch_item, "claim", json!({})).await, StatusCode::CONFLICT, Some("not_claimable"));

    // An unassigned per_member item (its member left) isn't claimable either.
    let team = create_group(&c.app.db, c.org.branch_a, "Team", &[], &[c.org.plain_a, c.org.manager_a]).await;
    let (_, items) = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "Each", "completion_mode": "per_member", "targets": [{ "group_id": team }] }))
        .await;
    let managers = items.iter().find(|w| w["assignee_id"] == c.org.manager_a.to_string()).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    call(
        &c.app,
        &c.admin,
        Method::DELETE,
        &format!("/api/branches/{}/members/{}", c.org.branch_a, c.org.manager_a),
        None,
    )
    .await;
    assert!(c.item(&managers).await["assignee_id"].is_null());
    assert_status(&c.go(&c.plain, &managers, "claim", json!({})).await, StatusCode::CONFLICT, Some("not_claimable"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn reassigning_needs_branch_scope_and_notifies_both_people(pool: PgPool) {
    let c = setup(pool).await;
    let id = c.action_for_plain().await;

    let res = c.go(&c.plain, &id, "assign", json!({ "assignee_id": c.org.manager_a })).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
    let res = c.go(&c.admin, &id, "assign", json!({})).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("assignee_required"));
    let res = c.go(&c.admin, &id, "assign", json!({ "assignee_id": c.org.admin_b })).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_assignee"));

    let res = c.ok(&c.boss_like, &id, "assign", json!({ "assignee_id": c.org.manager_a })).await;
    assert_eq!(res["assignee_id"], c.org.manager_a.to_string());
    assert_eq!(notifications_of(&c.app.db, c.org.manager_a, "assigned").await, 1);
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "unassigned").await, 1);

    // Multi already has work on this issue, but on another target: fine.
    c.ok(&c.admin, &id, "assign", json!({ "assignee_id": c.org.multi })).await;
    let mine = call(&c.app, &c.multi, Method::GET, "/api/work-items?assignee=me", None).await;
    assert_eq!(mine.body["items"].as_array().unwrap().len(), 2);
}

// ---------------------------------------------------------------------------
// Cancelling and auto-close
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn cancelling_is_admin_only_and_the_last_final_item_closes_the_issue(pool: PgPool) {
    let c = setup(pool).await;
    let (issue, items) = c
        .issue(
            &c.admin,
            json!({
                "branch_id": c.org.branch_a, "type": "action", "title": "Two",
                "targets": [{ "user_id": c.org.plain_a }, { "user_id": c.org.multi }]
            }),
        )
        .await;
    let ids: Vec<String> = items.iter().map(|w| w["id"].as_str().unwrap().to_owned()).collect();

    assert_status(&c.go(&c.boss_like, &ids[0], "cancel", json!({})).await, StatusCode::FORBIDDEN, None);
    assert_status(&c.go(&c.plain, &ids[0], "cancel", json!({})).await, StatusCode::FORBIDDEN, None);

    c.ok(&c.admin, &ids[0], "cancel", json!({})).await;
    let issue_uri = format!("/api/issues/{issue}");
    assert_eq!(call(&c.app, &c.admin, Method::GET, &issue_uri, None).await.body["state"], "open");

    // The other one is approved: everything is final, so the issue closes.
    let other_cookie = if items[1]["assignee_id"] == c.org.plain_a.to_string() { &c.plain } else { &c.multi };
    c.ok(other_cookie, &ids[1], "submit", json!({})).await;
    c.ok(&c.admin, &ids[1], "approve", json!({})).await;
    let res = call(&c.app, &c.admin, Method::GET, &issue_uri, None).await;
    assert_eq!(res.body["state"], "closed");
    assert!(res.body["closed_by"].is_null());
    assert_eq!(audit_count(&c.app.db, "issue", "auto_close").await, 1);

    // Work on a closed issue is frozen.
    let (_, items) = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "Closing", "targets": [{ "user_id": c.org.plain_a }] }))
        .await;
    let id = items[0]["id"].as_str().unwrap().to_owned();
    let issue_id = items[0]["issue_id"].as_str().unwrap().to_owned();
    call(&c.app, &c.admin, Method::POST, &format!("/api/issues/{issue_id}/close"), Some(json!({ "version": 1 }))).await;
    let res = c.go(&c.plain, &id, "start", json!({})).await;
    assert_status(&res, StatusCode::CONFLICT, Some("issue_not_open"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn work_item_reads_follow_the_issue(pool: PgPool) {
    let c = setup(pool).await;
    let (_, items) = c
        .issue(
            &c.boss_like,
            json!({
                "branch_id": c.org.branch_a, "type": "action", "title": "Private job", "is_private": true,
                "targets": [{ "user_id": c.org.multi }]
            }),
        )
        .await;
    let id = items[0]["id"].as_str().unwrap().to_owned();
    let uri = format!("/api/work-items/{id}");

    assert_status(&call(&c.app, &c.multi, Method::GET, &uri, None).await, StatusCode::OK, None);
    assert_status(&call(&c.app, &c.plain, Method::GET, &uri, None).await, StatusCode::NOT_FOUND, None);
    // Every action on it is 404 for someone who can't read the issue.
    let res = call(&c.app, &c.plain, Method::POST, &format!("{uri}/start"), Some(json!({ "version": 1 }))).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    let list = call(&c.app, &c.plain, Method::GET, "/api/work-items", None).await;
    assert!(list.body["items"].as_array().unwrap().is_empty());
    let res = call(&c.app, &c.plain, Method::GET, &format!("/api/work-items/{}", Uuid::new_v4()), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
}
