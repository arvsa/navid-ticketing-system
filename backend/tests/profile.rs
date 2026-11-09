//! Profiles: name (super admins), bio, cover and picture; and the directory.

mod common;

use axum::http::{header, Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::json;
use sqlx::PgPool;

/// The smallest valid PNG: enough for the type check.
const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR\0\0\0\x01\0\0\0\x01\x08\x06\0\0\0\x1f\x15\xc4\x89";
const JPEG: &[u8] = b"\xFF\xD8\xFF\xE0\0\x10JFIF\0";

#[sqlx::test(migrator = "MIGRATOR")]
async fn everyone_writes_a_bio_and_super_admins_their_name(pool: PgPool) {
    let app = TestApp::new(pool);
    Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;

    let res = call(&app, &plain, Method::PATCH, "/api/me", Some(json!({ "bio": "  Maths teacher, year 9.  " }))).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["user"]["bio"], "Maths teacher, year 9.");
    let long = "x".repeat(501);
    let res = call(&app, &plain, Method::PATCH, "/api/me", Some(json!({ "bio": long }))).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_bio"));
    let res = call(&app, &plain, Method::PATCH, "/api/me", Some(json!({ "bio": null }))).await;
    assert!(res.body["user"]["bio"].is_null(), "null clears it");

    // Names: their admin changes them, unless they're a super admin.
    let res = call(&app, &plain, Method::PATCH, "/api/me", Some(json!({ "first_name": "Pat" }))).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
    let root = as_root(&app).await;
    let res =
        call(&app, &root, Method::PATCH, "/api/me", Some(json!({ "first_name": " Navid ", "last_name": "Office" })))
            .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["user"]["first_name"], "Navid");
    assert_eq!(res.body["user"]["last_name"], "Office");
    let res = call(&app, &root, Method::PATCH, "/api/me", Some(json!({ "first_name": " " }))).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_name"));
    assert_eq!(audit_count(&app.db, "app_user", "update_profile").await, 3);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn a_cover_image_is_seen_by_everyone_signed_in(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;

    let res = send_multipart(&app, &plain, Method::PUT, "/api/me/cover", ("cover.png", "image/png", PNG), &[]).await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    let me = call(&app, &plain, Method::GET, "/api/me", None).await;
    let version = me.body["user"]["cover_version"].as_str().unwrap().to_owned();
    assert!(version.ends_with("-png"));

    // Everyone signed in sees it (the directory spans the school); signed out, no one.
    let uri = format!("/api/users/{}/cover", org.plain_a);
    let manager = as_user(&app, "manager_a@example.com").await;
    let img = call(&app, &manager, Method::GET, &uri, None).await;
    assert_status(&img, StatusCode::OK, None);
    assert_eq!(img.headers[header::CONTENT_TYPE], "image/png");
    assert_eq!(img.bytes, PNG);
    let profile = call(&app, &manager, Method::GET, &format!("/api/users/{}/profile", org.plain_a), None).await;
    assert_eq!(profile.body["cover_version"], version.as_str());
    let admin_b = as_user(&app, "admin_b@example.com").await;
    assert_status(&call(&app, &admin_b, Method::GET, &uri, None).await, StatusCode::OK, None);
    assert_status(&app.get(&uri).await, StatusCode::UNAUTHORIZED, None);

    // A new cover replaces the old one; the type comes from the bytes, not the label.
    let res =
        send_multipart(&app, &plain, Method::PUT, "/api/me/cover", ("photo", "application/octet-stream", JPEG), &[])
            .await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    let img = call(&app, &manager, Method::GET, &uri, None).await;
    assert_eq!(img.headers[header::CONTENT_TYPE], "image/jpeg");
    let res = send_multipart(
        &app,
        &plain,
        Method::PUT,
        "/api/me/cover",
        ("evil.png", "image/png", b"<svg onload=alert(1)>"),
        &[],
    )
    .await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("unsupported_type"));

    assert_status(&call(&app, &plain, Method::DELETE, "/api/me/cover", None).await, StatusCode::NO_CONTENT, None);
    assert_status(&call(&app, &manager, Method::GET, &uri, None).await, StatusCode::NOT_FOUND, None);
    let me = call(&app, &plain, Method::GET, "/api/me", None).await;
    assert!(me.body["user"]["cover_version"].is_null());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn a_profile_picture_shows_everywhere(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let admin_b = as_user(&app, "admin_b@example.com").await;

    assert_eq!(call(&app, &admin_b, Method::GET, "/api/avatars", None).await.body, json!([]));
    let res = send_multipart(&app, &plain, Method::PUT, "/api/me/avatar", ("me.png", "image/png", PNG), &[]).await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    let me = call(&app, &plain, Method::GET, "/api/me", None).await;
    let version = me.body["user"]["avatar_version"].as_str().unwrap().to_owned();
    assert!(me.body["user"]["cover_version"].is_null(), "the cover is separate");

    let list = call(&app, &admin_b, Method::GET, "/api/avatars", None).await;
    assert_eq!(list.body, json!([{ "user_id": org.plain_a, "version": version }]));
    let img = call(&app, &admin_b, Method::GET, &format!("/api/users/{}/avatar", org.plain_a), None).await;
    assert_status(&img, StatusCode::OK, None);
    assert_eq!(img.bytes, PNG);

    let res = send_multipart(&app, &plain, Method::PUT, "/api/me/avatar", ("x.gif", "image/gif", b"GIF89a"), &[]).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("unsupported_type"));
    assert_status(&call(&app, &plain, Method::DELETE, "/api/me/avatar", None).await, StatusCode::NO_CONTENT, None);
    assert_eq!(call(&app, &admin_b, Method::GET, "/api/avatars", None).await.body, json!([]));
    assert_eq!(audit_count(&app.db, "app_user", "set_avatar").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_directory_shows_every_branch_its_departments_and_people(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let plain_b = create_user(&app.db, NewUser::member("plain_b@example.com", PW)).await;
    add_member(&app.db, org.branch_b, plain_b).await;
    let science = create_group(&app.db, org.branch_b, "Science", &[], &[plain_b]).await;

    // Someone only in branch A sees branch B's departments and people.
    let plain = as_user(&app, "plain_a@example.com").await;
    let res = call(&app, &plain, Method::GET, "/api/directory", None).await;
    assert_status(&res, StatusCode::OK, None);
    let b = res.body.as_array().unwrap().iter().find(|b| b["id"] == org.branch_b.to_string()).unwrap();
    let dept = b["groups"].as_array().unwrap().iter().find(|g| g["id"] == science.to_string()).unwrap();
    assert_eq!(dept["member_ids"], json!([plain_b]));
    assert!(b["groups"].as_array().unwrap().iter().all(|g| g["name"] != "All members"));
    let person = b["people"].as_array().unwrap().iter().find(|p| p["user_id"] == plain_b.to_string()).unwrap();
    assert_eq!(person["email"], "plain_b@example.com");
    let admin = b["people"].as_array().unwrap().iter().find(|p| p["user_id"] == org.admin_b.to_string()).unwrap();
    assert_eq!(admin["is_admin"], true);
    assert_status(&app.get("/api/directory").await, StatusCode::UNAUTHORIZED, None);
}
