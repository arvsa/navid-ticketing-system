//! Phase 4: comments (internal filtering, mentions, moderation), reports
//! (draft and submit, the Report submit gate) and attachments (storage,
//! limits, authorized download).

mod common;

use axum::http::{header, Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

struct Ctx {
    app: TestApp,
    org: Org,
    admin: String,
    boss_like: String,
    manager: String,
    plain: String,
    multi: String,
}

async fn setup(pool: PgPool) -> Ctx {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    Ctx {
        admin: as_user(&app, "admin_a@example.com").await,
        boss_like: as_user(&app, "boss_like_a@example.com").await,
        manager: as_user(&app, "manager_a@example.com").await,
        plain: as_user(&app, "plain_a@example.com").await,
        multi: as_user(&app, "multi@example.com").await,
        app,
        org,
    }
}

impl Ctx {
    async fn issue(&self, cookie: &str, body: Value) -> Value {
        let res = call(&self.app, cookie, Method::POST, "/api/issues", Some(body)).await;
        assert_status(&res, StatusCode::CREATED, None);
        res.body
    }

    async fn comment(&self, cookie: &str, issue: &str, body: Value) -> TestResponse {
        call(&self.app, cookie, Method::POST, &format!("/api/issues/{issue}/comments"), Some(body)).await
    }

    async fn comment_ids(&self, cookie: &str, issue: &str) -> Vec<String> {
        let res = call(&self.app, cookie, Method::GET, &format!("/api/issues/{issue}/comments"), None).await;
        assert_status(&res, StatusCode::OK, None);
        res.body["items"].as_array().unwrap().iter().map(|c| c["id"].as_str().unwrap().to_owned()).collect()
    }

    async fn unread(&self, cookie: &str, issue: &str) -> bool {
        let res = call(&self.app, cookie, Method::GET, "/api/issues", None).await;
        res.body["items"].as_array().unwrap().iter().find(|i| i["id"] == issue).unwrap()["unread"].as_bool().unwrap()
    }
}

fn id(v: &Value) -> String {
    v["id"].as_str().unwrap().to_owned()
}

// ---------------------------------------------------------------------------
// Internal comments: the phase 4 "done when"
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn internal_comments_never_reach_non_permitted_actors(pool: PgPool) {
    let c = setup(pool).await;
    let issue =
        id(&c.issue(&c.plain, json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "Laptop" })).await);
    call(&c.app, &c.multi, Method::PUT, &format!("/api/issues/{issue}/watch"), None).await;

    // Plain members can't write internal comments.
    let res = c.comment(&c.plain, &issue, json!({ "body": "psst", "is_internal_only": true })).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);

    let public = c.comment(&c.plain, &issue, json!({ "body": "It won't boot" })).await;
    assert_status(&public, StatusCode::CREATED, None);
    for cookie in [&c.plain, &c.boss_like] {
        call(&c.app, cookie, Method::POST, &format!("/api/issues/{issue}/read"), None).await;
    }
    let internal = c
        .comment(
            &c.admin,
            &issue,
            json!({
                "body": "Staff only: warranty expired",
                "is_internal_only": true,
                "mention_user_ids": [c.org.plain_a, c.org.boss_like_a, c.org.multi],
            }),
        )
        .await;
    assert_status(&internal, StatusCode::CREATED, None);
    let internal_id = id(&internal.body);
    // Only readers of internal comments stay mentioned.
    assert_eq!(internal.body["mentions"], json!([c.org.boss_like_a]));

    // Lists.
    assert_eq!(c.comment_ids(&c.plain, &issue).await, [id(&public.body)]);
    assert_eq!(c.comment_ids(&c.multi, &issue).await, [id(&public.body)]);
    assert_eq!(c.comment_ids(&c.boss_like, &issue).await.len(), 2);
    assert_eq!(c.comment_ids(&c.admin, &issue).await.len(), 2);

    // Notifications: nothing about it reaches plain_a (creator) or multi (watcher).
    let about = |user: Uuid| {
        let db = c.app.db.clone();
        let comment = internal_id.clone();
        async move {
            sqlx::query_scalar!(
                r#"SELECT count(*) AS "n!" FROM notification WHERE recipient_id = $1 AND payload->>'comment_id' = $2"#,
                user,
                comment
            )
            .fetch_one(&db)
            .await
            .unwrap()
        }
    };
    assert_eq!(about(c.org.plain_a).await, 0);
    assert_eq!(about(c.org.multi).await, 0);
    assert_eq!(notifications_of(&c.app.db, c.org.boss_like_a, "mentioned").await, 1);

    // Unread activity: an internal comment doesn't make the issue unread for plain_a.
    assert!(!c.unread(&c.plain, &issue).await);
    assert!(c.unread(&c.boss_like, &issue).await);

    // Edit and delete: the comment doesn't exist for plain_a.
    let uri = format!("/api/comments/{internal_id}");
    let res = call(&c.app, &c.plain, Method::PATCH, &uri, Some(json!({ "body": "x" }))).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    assert_status(&call(&c.app, &c.plain, Method::DELETE, &uri, None).await, StatusCode::NOT_FOUND, None);

    // Attachments on it: 404 for plain_a.
    let file = upload(
        &c.app,
        &c.admin,
        &issue,
        ("notes.txt", "text/plain", b"internal notes"),
        &[("comment_id", internal_id.clone())],
    )
    .await;
    assert_status(&file, StatusCode::CREATED, None);
    let file_uri = format!("/api/attachments/{}", id(&file.body));
    assert_status(&call(&c.app, &c.plain, Method::GET, &file_uri, None).await, StatusCode::NOT_FOUND, None);
    assert_status(&call(&c.app, &c.boss_like, Method::GET, &file_uri, None).await, StatusCode::OK, None);
    let detail = call(&c.app, &c.plain, Method::GET, &format!("/api/issues/{issue}"), None).await;
    assert!(detail.body["attachments"].as_array().unwrap().is_empty());

    // History: a moderated internal comment leaves an audit row only staff see.
    assert_status(&call(&c.app, &c.admin, Method::DELETE, &uri, None).await, StatusCode::NO_CONTENT, None);
    let comment_rows = |res: &TestResponse| {
        res.body["items"].as_array().unwrap().iter().filter(|h| h["entity_type"] == "issue_comment").count()
    };
    let plain_history = call(&c.app, &c.plain, Method::GET, &format!("/api/issues/{issue}/history"), None).await;
    assert_eq!(comment_rows(&plain_history), 0);
    assert!(!plain_history.body.to_string().contains(&internal_id));
    let staff_history = call(&c.app, &c.boss_like, Method::GET, &format!("/api/issues/{issue}/history"), None).await;
    assert_eq!(comment_rows(&staff_history), 1);
    // Nothing anywhere in plain_a's responses ever carried the internal text.
    for path in [format!("/api/issues/{issue}"), format!("/api/issues/{issue}/comments"), "/api/issues".to_owned()] {
        let res = call(&c.app, &c.plain, Method::GET, &path, None).await;
        assert!(!res.body.to_string().contains("warranty"), "{path} leaked the internal comment");
    }
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn comment_notifications_go_to_creator_assignees_and_watchers(pool: PgPool) {
    let c = setup(pool).await;
    let issue = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "action", "title": "Job", "targets": [{ "user_id": c.org.plain_a }] }))
        .await;
    let (issue_id, item_id) = (id(&issue), id(&issue["work_items"][0]));
    call(&c.app, &c.multi, Method::PUT, &format!("/api/issues/{issue_id}/watch"), None).await;

    // From the assignee, on their work item: the creator and the watcher hear about it.
    let res = c.comment(&c.plain, &issue_id, json!({ "body": "Started", "work_item_id": item_id })).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(notifications_of(&c.app.db, c.org.admin_a, "commented").await, 1);
    assert_eq!(notifications_of(&c.app.db, c.org.multi, "commented").await, 1);
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "commented").await, 0, "never the author");

    // A mention replaces `commented` for that person; non-readers are dropped silently.
    let res = c
        .comment(
            &c.admin,
            &issue_id,
            json!({ "body": "@plain thanks", "mention_user_ids": [c.org.plain_a, c.org.admin_b] }),
        )
        .await;
    assert_eq!(res.body["mentions"], json!([c.org.plain_a]));
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "mentioned").await, 1);
    assert_eq!(notifications_of(&c.app.db, c.org.plain_a, "commented").await, 0);
    assert_eq!(notifications_of(&c.app.db, c.org.admin_b, "mentioned").await, 0);

    // The work item thread filter.
    let thread =
        call(&c.app, &c.plain, Method::GET, &format!("/api/issues/{issue_id}/comments?work_item_id={item_id}"), None)
            .await;
    assert_eq!(thread.body["items"].as_array().unwrap().len(), 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn comment_editing_deleting_and_moderation(pool: PgPool) {
    let c = setup(pool).await;
    let issue = id(&c.issue(&c.plain, json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "Q" })).await);

    for (body, code) in
        [(json!({ "body": "  " }), "invalid_comment"), (json!({ "body": "x".repeat(20_001) }), "invalid_comment")]
    {
        assert_status(&c.comment(&c.plain, &issue, body).await, StatusCode::UNPROCESSABLE_ENTITY, Some(code));
    }
    let res = c.comment(&c.plain, &issue, json!({ "body": "x", "work_item_id": Uuid::new_v4() })).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_work_item"));

    let mine = id(&c.comment(&c.plain, &issue, json!({ "body": "first" })).await.body);
    let uri = format!("/api/comments/{mine}");
    let res = call(&c.app, &c.plain, Method::PATCH, &uri, Some(json!({ "body": "first (edited)" }))).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["body"], "first (edited)");
    assert_eq!(res.body["edited"], true);
    // Only the author edits; moderators delete.
    assert_status(
        &call(&c.app, &c.boss_like, Method::PATCH, &uri, Some(json!({ "body": "x" }))).await,
        StatusCode::FORBIDDEN,
        None,
    );
    assert_status(&call(&c.app, &c.manager, Method::DELETE, &uri, None).await, StatusCode::FORBIDDEN, None);
    assert_status(&call(&c.app, &c.boss_like, Method::DELETE, &uri, None).await, StatusCode::NO_CONTENT, None);

    // The deleted comment keeps its place without its text.
    let list = call(&c.app, &c.plain, Method::GET, &format!("/api/issues/{issue}/comments"), None).await;
    let gone = &list.body["items"][0];
    assert_eq!(gone["deleted"], true);
    assert!(gone["body"].is_null());
    assert_status(
        &call(&c.app, &c.plain, Method::PATCH, &uri, Some(json!({ "body": "again" }))).await,
        StatusCode::CONFLICT,
        Some("comment_deleted"),
    );
    assert_status(&call(&c.app, &c.plain, Method::DELETE, &uri, None).await, StatusCode::NOT_FOUND, None);

    // Authors delete their own without any grant.
    let second = id(&c.comment(&c.plain, &issue, json!({ "body": "second" })).await.body);
    assert_status(
        &call(&c.app, &c.plain, Method::DELETE, &format!("/api/comments/{second}"), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    let audit = sqlx::query!("SELECT new_value FROM audit_log WHERE entity_type = 'issue_comment' ORDER BY id")
        .fetch_all(&c.app.db)
        .await
        .unwrap();
    assert_eq!(audit.len(), 2);
    assert_eq!(audit[0].new_value.as_ref().unwrap()["moderated"], true);
    assert_eq!(audit[1].new_value.as_ref().unwrap()["moderated"], false);
    assert!(
        !audit.iter().any(|a| a.new_value.as_ref().unwrap().to_string().contains("first")),
        "bodies stay out of the audit log"
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn comments_on_unreadable_issues_are_404(pool: PgPool) {
    let c = setup(pool).await;
    let private = id(&c
        .issue(
            &c.boss_like,
            json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "HR", "is_private": true }),
        )
        .await);
    assert_status(&c.comment(&c.plain, &private, json!({ "body": "hi" })).await, StatusCode::NOT_FOUND, None);
    let res = call(&c.app, &c.plain, Method::GET, &format!("/api/issues/{private}/comments"), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn reports_go_from_draft_to_submitted_and_lock_on_approval(pool: PgPool) {
    let c = setup(pool).await;
    let issue = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "report", "title": "Term report", "targets": [{ "user_id": c.org.plain_a }] }))
        .await;
    let (issue_id, item_id) = (id(&issue), id(&issue["work_items"][0]));
    let reports_uri = format!("/api/issues/{issue_id}/reports");

    // Only the assignee writes the report for their work.
    let body = json!({ "title": "Term 1", "body": "All good.", "work_item_id": item_id });
    assert_status(
        &call(&c.app, &c.multi, Method::POST, &reports_uri, Some(body.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let draft = call(&c.app, &c.plain, Method::POST, &reports_uri, Some(body.clone())).await;
    assert_status(&draft, StatusCode::CREATED, None);
    let report = id(&draft.body);
    assert!(draft.body["submitted_at"].is_null());
    assert_status(
        &call(&c.app, &c.plain, Method::POST, &reports_uri, Some(body)).await,
        StatusCode::CONFLICT,
        Some("report_exists"),
    );

    // Drafts are the author's alone.
    let admin_view = call(&c.app, &c.admin, Method::GET, &reports_uri, None).await;
    assert!(admin_view.body["items"].as_array().unwrap().is_empty());
    let res = call(
        &c.app,
        &c.admin,
        Method::PATCH,
        &format!("/api/reports/{report}"),
        Some(json!({ "version": 1, "body": "x" })),
    )
    .await;
    assert_status(&res, StatusCode::NOT_FOUND, None);

    // The work can't be submitted until the report is.
    let submit_uri = format!("/api/work-items/{item_id}/submit");
    let submit_work =
        |version: i64| call(&c.app, &c.plain, Method::POST, &submit_uri, Some(json!({ "version": version })));
    assert_status(&submit_work(1).await, StatusCode::UNPROCESSABLE_ENTITY, Some("report_required"));

    let edited = call(
        &c.app,
        &c.plain,
        Method::PATCH,
        &format!("/api/reports/{report}"),
        Some(json!({ "version": 1, "body": "All good, details inside." })),
    )
    .await;
    assert_status(&edited, StatusCode::OK, None);
    assert_eq!(edited.body["version"], 2);
    let stale =
        call(&c.app, &c.plain, Method::POST, &format!("/api/reports/{report}/submit"), Some(json!({ "version": 1 })))
            .await;
    assert_status(&stale, StatusCode::CONFLICT, Some("version_conflict"));
    let submitted =
        call(&c.app, &c.plain, Method::POST, &format!("/api/reports/{report}/submit"), Some(json!({ "version": 2 })))
            .await;
    assert_status(&submitted, StatusCode::OK, None);
    assert!(submitted.body["submitted_at"].is_string());

    // Now visible to readers, but still only the author edits it.
    let admin_view = call(&c.app, &c.admin, Method::GET, &reports_uri, None).await;
    assert_eq!(admin_view.body["items"][0]["body"], "All good, details inside.");
    let res = call(
        &c.app,
        &c.admin,
        Method::PATCH,
        &format!("/api/reports/{report}"),
        Some(json!({ "version": 3, "body": "x" })),
    )
    .await;
    assert_status(&res, StatusCode::FORBIDDEN, None);

    assert_status(&submit_work(1).await, StatusCode::OK, None);
    let approve = call(
        &c.app,
        &c.admin,
        Method::POST,
        &format!("/api/work-items/{item_id}/approve"),
        Some(json!({ "version": 2 })),
    )
    .await;
    assert_status(&approve, StatusCode::OK, None);
    let locked = call(
        &c.app,
        &c.plain,
        Method::PATCH,
        &format!("/api/reports/{report}"),
        Some(json!({ "version": 3, "body": "late edit" })),
    )
    .await;
    assert_status(&locked, StatusCode::CONFLICT, Some("report_locked"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn self_filed_reports(pool: PgPool) {
    let c = setup(pool).await;
    let issue = id(&c
        .issue(&c.plain, json!({ "branch_id": c.org.branch_a, "type": "report", "title": "My incident report" }))
        .await);
    let uri = format!("/api/issues/{issue}/reports");

    // Only the issue's creator files a report for themselves.
    let body = json!({ "title": "What happened", "body": "Details" });
    assert_status(&call(&c.app, &c.multi, Method::POST, &uri, Some(body.clone())).await, StatusCode::FORBIDDEN, None);
    let res = call(&c.app, &c.plain, Method::POST, &uri, Some(body)).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert!(res.body["work_item_id"].is_null());
    let report = id(&res.body);
    call(&c.app, &c.plain, Method::POST, &format!("/api/reports/{report}/submit"), Some(json!({ "version": 1 }))).await;

    // ...and closes it; after that the report is locked.
    let res =
        call(&c.app, &c.plain, Method::POST, &format!("/api/issues/{issue}/close"), Some(json!({ "version": 1 })))
            .await;
    assert_status(&res, StatusCode::OK, None);
    let res = call(
        &c.app,
        &c.plain,
        Method::PATCH,
        &format!("/api/reports/{report}"),
        Some(json!({ "version": 2, "body": "x" })),
    )
    .await;
    assert_status(&res, StatusCode::CONFLICT, Some("report_locked"));

    // Reports belong on report issues.
    let ticket = id(&c.issue(&c.plain, json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "T" })).await);
    let res = call(
        &c.app,
        &c.plain,
        Method::POST,
        &format!("/api/issues/{ticket}/reports"),
        Some(json!({ "title": "x", "body": "y" })),
    )
    .await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("not_a_report"));
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn attachments_round_trip_with_checks(pool: PgPool) {
    let c = setup(pool).await;
    let issue = id(&c
        .issue(&c.plain, json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "Broken printer" }))
        .await);
    let pdf = b"%PDF-1.7\nfake but fine".to_vec();

    let res = upload(&c.app, &c.plain, &issue, ("../../evil/Printer log v2.pdf", "application/pdf", &pdf), &[]).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(res.body["file_name"], "Printer log v2.pdf");
    assert_eq!(res.body["file_size_bytes"], pdf.len());
    let expected_sum: String = Sha256::digest(&pdf).iter().map(|b| format!("{b:02x}")).collect();
    assert_eq!(res.body["checksum_sha256"], expected_sum);
    let file_id = id(&res.body);

    // Stored under issues/{issue}/{id}.
    let on_disk = c.app.storage.path().join("issues").join(&issue).join(&file_id);
    assert_eq!(std::fs::read(&on_disk).unwrap(), pdf);

    // Downloaded through the API, as a download.
    let res = call(&c.app, &c.multi, Method::GET, &format!("/api/attachments/{file_id}"), None).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.bytes, pdf);
    assert_eq!(res.headers[header::CONTENT_TYPE], "application/pdf");
    assert_eq!(res.headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
    let disposition = res.headers[header::CONTENT_DISPOSITION].to_str().unwrap();
    assert!(disposition.starts_with("attachment; filename=\"Printer log v2.pdf\""), "{disposition}");
    let detail = call(&c.app, &c.multi, Method::GET, &format!("/api/issues/{issue}"), None).await;
    assert_eq!(detail.body["attachments"][0]["id"], file_id.as_str());

    // Type allow-list (no SVG or HTML), size limit, empty files.
    for ty in ["image/svg+xml", "text/html", "application/x-msdownload", "application/octet-stream"] {
        let res = upload(&c.app, &c.plain, &issue, ("x", ty, b"data"), &[]).await;
        assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("unsupported_type"));
    }
    let res =
        upload(&c.app, &c.plain, &issue, ("big.pdf", "application/pdf", &vec![b'x'; 25 * 1024 * 1024 + 1]), &[]).await;
    assert_status(&res, StatusCode::PAYLOAD_TOO_LARGE, Some("payload_too_large"));
    let res = upload(&c.app, &c.plain, &issue, ("empty.txt", "text/plain", b""), &[]).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("empty_file"));
    let ok = upload(&c.app, &c.plain, &issue, ("max.pdf", "application/pdf", &vec![b'x'; 25 * 1024 * 1024]), &[]).await;
    assert_status(&ok, StatusCode::CREATED, None);
    // Ordinary JSON routes keep their 1 MB limit.
    let res = c.comment(&c.plain, &issue, json!({ "body": "x".repeat(1_100_000) })).await;
    assert_status(&res, StatusCode::PAYLOAD_TOO_LARGE, Some("payload_too_large"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn attachments_follow_their_parent(pool: PgPool) {
    let c = setup(pool).await;
    let issue = id(&c.issue(&c.plain, json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "T" })).await);
    let comment = id(&c.comment(&c.plain, &issue, json!({ "body": "see attached" })).await.body);
    let file = ("a.txt", "text/plain", b"hello".as_slice());

    // Someone else's comment: no.
    let res = upload(&c.app, &c.multi, &issue, file, &[("comment_id", comment.clone())]).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
    let res = upload(&c.app, &c.plain, &issue, file, &[("comment_id", comment.clone())]).await;
    assert_status(&res, StatusCode::CREATED, None);
    let listed = call(&c.app, &c.multi, Method::GET, &format!("/api/issues/{issue}/comments"), None).await;
    assert_eq!(listed.body["items"][0]["attachments"][0]["file_name"], "a.txt");
    let res = upload(&c.app, &c.plain, &issue, file, &[("comment_id", Uuid::new_v4().to_string())]).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_parent"));

    // Deleting the comment hides its files.
    let file_id = id(&comment_attachment(&c, &issue, &comment).await);
    call(&c.app, &c.plain, Method::DELETE, &format!("/api/comments/{comment}"), None).await;
    let res = call(&c.app, &c.multi, Method::GET, &format!("/api/attachments/{file_id}"), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);

    // Draft report files are the author's alone.
    let report_issue = c
        .issue(&c.admin, json!({ "branch_id": c.org.branch_a, "type": "report", "title": "R", "targets": [{ "user_id": c.org.plain_a }] }))
        .await;
    let (rid, item) = (id(&report_issue), id(&report_issue["work_items"][0]));
    let report = call(
        &c.app,
        &c.plain,
        Method::POST,
        &format!("/api/issues/{rid}/reports"),
        Some(json!({ "title": "t", "body": "b", "work_item_id": item })),
    )
    .await;
    let report_id = id(&report.body);
    let res =
        upload(&c.app, &c.plain, &rid, ("chart.png", "image/png", b"\x89PNG"), &[("report_id", report_id.clone())])
            .await;
    assert_status(&res, StatusCode::CREATED, None);
    let png = format!("/api/attachments/{}", id(&res.body));
    assert_status(&call(&c.app, &c.admin, Method::GET, &png, None).await, StatusCode::NOT_FOUND, None);
    assert_status(&call(&c.app, &c.plain, Method::GET, &png, None).await, StatusCode::OK, None);
    call(&c.app, &c.plain, Method::POST, &format!("/api/reports/{report_id}/submit"), Some(json!({ "version": 1 })))
        .await;
    assert_status(&call(&c.app, &c.admin, Method::GET, &png, None).await, StatusCode::OK, None);
}

/// The attachment just uploaded to a comment, from the comment list.
async fn comment_attachment(c: &Ctx, issue: &str, comment: &str) -> Value {
    let list = call(&c.app, &c.plain, Method::GET, &format!("/api/issues/{issue}/comments"), None).await;
    let item = list.body["items"].as_array().unwrap().iter().find(|i| i["id"] == comment).unwrap().clone();
    item["attachments"][0].clone()
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn an_unreadable_issues_attachment_is_404(pool: PgPool) {
    let c = setup(pool).await;
    let private = id(&c
        .issue(
            &c.boss_like,
            json!({ "branch_id": c.org.branch_a, "type": "ticket", "title": "HR", "is_private": true }),
        )
        .await);
    let res = upload(&c.app, &c.boss_like, &private, ("contract.pdf", "application/pdf", b"%PDF"), &[]).await;
    assert_status(&res, StatusCode::CREATED, None);
    let uri = format!("/api/attachments/{}", id(&res.body));

    assert_status(&call(&c.app, &c.plain, Method::GET, &uri, None).await, StatusCode::NOT_FOUND, Some("not_found"));
    let outsider = as_user(&c.app, "admin_b@example.com").await;
    assert_status(&call(&c.app, &outsider, Method::GET, &uri, None).await, StatusCode::NOT_FOUND, Some("not_found"));
    // Same answer as for an id that doesn't exist.
    let missing = call(&c.app, &c.plain, Method::GET, &format!("/api/attachments/{}", Uuid::new_v4()), None).await;
    assert_status(&missing, StatusCode::NOT_FOUND, Some("not_found"));
    // Uploading to it is 404 too.
    let res = upload(&c.app, &c.plain, &private, ("x.txt", "text/plain", b"x"), &[]).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);

    // The admin can read it.
    assert_status(&call(&c.app, &c.admin, Method::GET, &uri, None).await, StatusCode::OK, None);
}
