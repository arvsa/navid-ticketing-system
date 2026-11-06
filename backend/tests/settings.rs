//! App settings (super admins).

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
