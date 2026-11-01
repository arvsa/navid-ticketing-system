//! App settings (super admins) and the whole-school analytics.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_school_name_is_public_and_set_by_super_admins(pool: PgPool) {
    let app = TestApp::new(pool);
    Org::seed(&app.db).await;
    // Anyone, signed in or not.
    let res = app.get("/api/settings").await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["school_name"], "Navid Schools");

    let admin = as_user(&app, "admin_a@example.com").await;
    let rename = json!({ "school_name": "  Navid Schools Tehran " });
    assert_status(
        &call(&app, &admin, Method::PATCH, "/api/settings", Some(rename.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let root = as_root(&app).await;
    let res = call(&app, &root, Method::PATCH, "/api/settings", Some(rename)).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["school_name"], "Navid Schools Tehran");
    let blank = call(&app, &root, Method::PATCH, "/api/settings", Some(json!({ "school_name": " " }))).await;
    assert_status(&blank, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_name"));
    assert_eq!(audit_count(&app.db, "app_settings", "update").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn analytics_show_activity_speed_on_time_and_workload(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let multi = as_user(&app, "multi@example.com").await;
    let soon = (time::OffsetDateTime::now_utc() + time::Duration::days(2))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let res = call(
        &app,
        &admin,
        Method::POST,
        "/api/issues",
        Some(json!({ "branch_id": org.branch_a, "type": "action", "title": "Two jobs", "sla_due_at": soon,
                     "targets": [{ "user_id": org.plain_a }, { "user_id": org.multi }] })),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    let first = &res.body["work_items"][0];
    let (id, who) = (first["id"].as_str().unwrap(), first["assignee_id"].as_str().unwrap().to_owned());
    let worker = if who == org.plain_a.to_string() { &plain } else { &multi };
    let submitted =
        call(&app, worker, Method::POST, &format!("/api/work-items/{id}/submit"), Some(json!({ "version": 1 }))).await;
    assert_status(&submitted, StatusCode::OK, None);
    let approved =
        call(&app, &admin, Method::POST, &format!("/api/work-items/{id}/approve"), Some(json!({ "version": 2 }))).await;
    assert_status(&approved, StatusCode::OK, None);

    // Super admins only.
    assert_status(&call(&app, &admin, Method::GET, "/api/analytics", None).await, StatusCode::FORBIDDEN, None);
    let root = as_root(&app).await;
    let res = call(&app, &root, Method::GET, "/api/analytics?weeks=4", None).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["weeks"], 4);
    let a =
        res.body["branches"].as_array().unwrap().iter().find(|b| b["branch_id"] == org.branch_a.to_string()).unwrap();
    assert_eq!(a["activity"].as_array().unwrap().len(), 4);
    let this_week = a["activity"].as_array().unwrap().last().unwrap();
    assert_eq!(this_week["created"], 1);
    assert_eq!(this_week["finished"], 1);
    assert_eq!(a["finished"], 1);
    assert_eq!(a["finished_with_due_date"], 1);
    assert_eq!(a["on_time_rate"], 1.0);
    assert!(a["avg_hours_to_finish"].as_f64().unwrap() >= 0.0);
    // The other job is open, with someone.
    let workload = res.body["workload"].as_array().unwrap();
    assert_eq!(workload.len(), 1);
    assert_eq!(workload[0]["open"], 1);
    assert_eq!(workload[0]["overdue"], 0);
    let b =
        res.body["branches"].as_array().unwrap().iter().find(|b| b["branch_id"] == org.branch_b.to_string()).unwrap();
    assert!(b["avg_hours_to_finish"].is_null() && b["on_time_rate"].is_null());

    let bad = call(&app, &root, Method::GET, "/api/analytics?weeks=0", None).await;
    assert_status(&bad, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_query"));
}
