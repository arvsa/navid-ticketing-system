//! Templates (super admins run them, everyone uses them) and tags.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrator = "MIGRATOR")]
async fn super_admins_run_templates_and_everyone_reads_them(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;

    let listed = call(&app, &plain, Method::GET, "/api/templates", None).await;
    assert_status(&listed, StatusCode::OK, None);
    assert_eq!(listed.body.as_array().unwrap().len(), 1, "the built-in Report template");
    assert_eq!(listed.body[0]["type"], "action");

    let body = json!({ "name": "Field trip", "type": "event", "tag": "  #Trips " });
    assert_status(
        &call(&app, &admin, Method::POST, "/api/templates", Some(body.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let made = call(&app, &root, Method::POST, "/api/templates", Some(body.clone())).await;
    assert_status(&made, StatusCode::CREATED, None);
    assert_eq!(made.body["tag"], "trips");
    assert_status(
        &call(&app, &root, Method::POST, "/api/templates", Some(body)).await,
        StatusCode::CONFLICT,
        Some("template_name_taken"),
    );
    // A report rule only fits actions.
    let bad = json!({ "name": "Odd", "type": "ticket", "requires_report": true });
    assert_status(
        &call(&app, &root, Method::POST, "/api/templates", Some(bad)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_template"),
    );

    // Archived: hidden from everyone but super admins asking for them.
    let id = made.body["id"].as_str().unwrap();
    let archive = json!({ "version": 1, "archived": true });
    let archived = call(&app, &root, Method::PATCH, &format!("/api/templates/{id}"), Some(archive)).await;
    assert_status(&archived, StatusCode::OK, None);
    assert!(archived.body["archived_at"].is_string());
    let seen = call(&app, &plain, Method::GET, "/api/templates?include_archived=true", None).await;
    assert_eq!(seen.body.as_array().unwrap().len(), 1);
    let all = call(&app, &root, Method::GET, "/api/templates?include_archived=true", None).await;
    assert_eq!(all.body.as_array().unwrap().len(), 2);
    assert!(audit_count(&app.db, "issue_template", "update").await >= 1);
    let _ = org;
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn issues_take_their_templates_tag_and_rules(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let report = report_template(&app.db).await;

    let made = call(
        &app,
        &admin,
        Method::POST,
        "/api/issues",
        Some(json!({ "branch_id": org.branch_a, "type": "action", "template_id": report, "title": "Term report",
                     "tags": ["Science", "science", "term 1"], "targets": [{ "user_id": org.plain_a }] })),
    )
    .await;
    assert_status(&made, StatusCode::CREATED, None);
    assert_eq!(made.body["tags"], json!(["report", "science", "term 1"]));
    assert_eq!(made.body["requires_report"], true);
    assert_eq!(made.body["template_id"], report.to_string());

    // The template's type is the issue's.
    let wrong = json!({ "branch_id": org.branch_a, "type": "ticket", "template_id": report, "title": "X" });
    assert_status(
        &call(&app, &admin, Method::POST, "/api/issues", Some(wrong)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_template"),
    );
    // A plain action needs no report and has no tags.
    let plain_action = call(
        &app,
        &admin,
        Method::POST,
        "/api/issues",
        Some(json!({ "branch_id": org.branch_a, "type": "action", "title": "Fix the sign", "targets": [{ "user_id": org.plain_a }] })),
    )
    .await;
    assert_eq!(plain_action.body["requires_report"], false);
    assert_eq!(plain_action.body["tags"], json!([]));

    // Filter by tag.
    let tagged = call(&app, &admin, Method::GET, "/api/issues?tag=Report", None).await;
    let found: Vec<_> = tagged.body["items"].as_array().unwrap().iter().map(|i| i["title"].clone()).collect();
    assert_eq!(found, [json!("Term report")]);

    // Tags can be edited; the report rule stays even if the template changes.
    let id = made.body["id"].as_str().unwrap();
    let edited = call(
        &app,
        &admin,
        Method::PATCH,
        &format!("/api/issues/{id}"),
        Some(json!({ "version": made.body["version"], "tags": ["report"] })),
    )
    .await;
    assert_status(&edited, StatusCode::OK, None);
    assert_eq!(edited.body["tags"], json!(["report"]));
    let off = json!({ "version": 1, "requires_report": false });
    assert_status(
        &call(&app, &root, Method::PATCH, &format!("/api/templates/{report}"), Some(off)).await,
        StatusCode::OK,
        None,
    );
    let again = call(&app, &admin, Method::GET, &format!("/api/issues/{id}"), None).await;
    assert_eq!(again.body["requires_report"], true);

    // An archived template can't make new issues.
    let archive = json!({ "version": 2, "archived": true });
    assert_status(
        &call(&app, &root, Method::PATCH, &format!("/api/templates/{report}"), Some(archive)).await,
        StatusCode::OK,
        None,
    );
    let late = json!({ "branch_id": org.branch_a, "type": "action", "template_id": report, "title": "Late" });
    assert_status(
        &call(&app, &admin, Method::POST, "/api/issues", Some(late)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_template"),
    );
}
