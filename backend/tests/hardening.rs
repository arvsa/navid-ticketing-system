//! Phase 8: the OpenAPI document, demo seed, response headers, request ids,
//! and the README's error-code table staying complete.

mod common;

use std::collections::BTreeSet;

use axum::http::{header, Method, StatusCode};
use backend::{db::MIGRATOR, http, seed, AppState};
use common::*;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_openapi_document_describes_the_api(pool: PgPool) {
    let app = TestApp::new(pool);
    let res = app.get("/api/openapi.json").await;
    assert_status(&res, StatusCode::OK, None);
    let doc = &res.body;
    assert!(doc["openapi"].as_str().unwrap().starts_with("3."));

    let paths = doc["paths"].as_object().unwrap();
    let operations: usize = paths.values().map(|p| p.as_object().unwrap().len()).sum();
    // Every route in the router (only /api/openapi.json itself is left out).
    assert_eq!(operations, 66, "documented operations");
    for (path, method) in [
        ("/api/auth/login", "post"),
        ("/api/issues", "get"),
        ("/api/issues/{id}", "patch"),
        ("/api/work-items/{id}/{transition}", "post"),
        ("/api/issues/{id}/attachments", "post"),
        ("/api/stream", "get"),
        ("/api/exports", "get"),
        ("/api/branches/{id}/members/{user_id}/effective-permissions", "get"),
    ] {
        assert!(paths.get(path).and_then(|p| p.get(method)).is_some(), "{method} {path} is missing");
    }
    // Every operation documents its error shape.
    for (path, item) in paths {
        for (method, op) in item.as_object().unwrap() {
            assert!(op["responses"].get("4XX").is_some(), "{method} {path} has no error response");
        }
    }

    let schemas = doc["components"]["schemas"].as_object().unwrap();
    for name in ["IssueDetail", "WorkItem", "ErrorResponse", "NewIssue", "Comment", "Dashboard", "Grant"] {
        assert!(schemas.contains_key(name), "schema {name} is missing");
    }
    assert_eq!(doc["components"]["securitySchemes"]["session"]["in"], "cookie");
    // Login and health are public.
    assert_eq!(paths["/api/auth/login"]["post"]["security"], json!([{}]));
    // Every `$ref` points at a defined schema.
    fn refs(v: &serde_json::Value, out: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(m) => {
                if let Some(r) = m.get("$ref").and_then(|r| r.as_str()) {
                    out.push(r.trim_start_matches("#/components/schemas/").to_owned());
                }
                m.values().for_each(|x| refs(x, out));
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| refs(x, out)),
            _ => {}
        }
    }
    let mut all = Vec::new();
    refs(doc, &mut all);
    let dangling: BTreeSet<&String> = all.iter().filter(|r| !schemas.contains_key(r.as_str())).collect();
    assert!(dangling.is_empty(), "undefined schemas referenced: {dangling:?}");
    // Enums carry their values.
    let status = &schemas["WorkStatus"]["enum"];
    assert!(status.as_array().unwrap().contains(&json!("pending_approval")));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn demo_seed_fills_an_empty_database_once(pool: PgPool) {
    let seeded = seed::demo(&pool).await.unwrap();
    assert_eq!(seeded.branches, 3);
    assert_eq!(seeded.users, 1 + 3 * (seed::MEMBERS_PER_BRANCH + 2));
    assert!(seeded.issues > 100);

    let err = seed::demo(&pool).await.unwrap_err();
    assert_eq!(err.code(), "not_empty");

    // The demo accounts work, and there's something on everyone's dashboard.
    let app = TestApp::new(pool);
    for email in [seed::DEMO_SUPER_ADMIN, "admin@north.demo.school", "member3@south.demo.school"] {
        let cookie = app.session(email, seed::DEMO_PASSWORD).await;
        let issues = app.req(Method::GET, "/api/issues").cookie(&cookie).send().await;
        assert!(!issues.body["items"].as_array().unwrap().is_empty(), "{email} sees no issues");
        let dash = app.req(Method::GET, "/api/dashboard").cookie(&cookie).send().await;
        assert_status(&dash, StatusCode::OK, None);
    }
    let kinds: Vec<String> = sqlx::query_scalar!(
        r#"SELECT DISTINCT ty.code AS "code!" FROM issue i JOIN issue_type ty ON ty.id = i.type_id"#
    )
    .fetch_all(&app.db)
    .await
    .unwrap();
    assert_eq!(kinds.len(), 4, "every issue type is seeded");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn responses_carry_security_headers_and_a_request_id(pool: PgPool) {
    let app = TestApp::new(pool.clone());
    let res = app.get("/api/healthz").await;
    for (name, value) in [
        ("x-content-type-options", "nosniff"),
        ("x-frame-options", "DENY"),
        ("referrer-policy", "no-referrer"),
        ("cache-control", "no-store"),
    ] {
        assert_eq!(res.headers[name], value, "{name}");
    }
    assert!(res.headers.get(header::STRICT_TRANSPORT_SECURITY).is_none(), "no HSTS over plain HTTP");
    let id = res.headers["x-request-id"].to_str().unwrap();
    assert_eq!(id.len(), 36, "a generated UUID: {id}");
    // Errors get them too.
    assert!(app.get("/api/nope").await.headers.get("x-request-id").is_some());

    // With Secure cookies (HTTPS deployments), HSTS is on.
    let mut config = test_config();
    config.cookie_secure = true;
    let secure = http::router(AppState::new(pool, config));
    let req = axum::http::Request::get("/api/healthz").body(axum::body::Body::empty()).unwrap();
    let res = tower::ServiceExt::oneshot(secure, req).await.unwrap();
    assert!(res.headers()[header::STRICT_TRANSPORT_SECURITY].to_str().unwrap().starts_with("max-age="));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn a_client_request_id_is_kept(pool: PgPool) {
    let app = TestApp::new(pool);
    let req = axum::http::Request::get("/api/healthz")
        .header("x-request-id", "client-abc-123")
        .body(axum::body::Body::empty())
        .unwrap();
    let res = tower::ServiceExt::oneshot(app.router.clone(), req).await.unwrap();
    assert_eq!(res.headers()["x-request-id"], "client-abc-123");
}

/// Every error code the code base can return is documented in docs/REFERENCE.md.
#[test]
fn every_error_code_is_in_the_readme() {
    let readme = std::fs::read_to_string("docs/REFERENCE.md").unwrap();
    let mut codes =
        BTreeSet::from(["not_found".to_owned(), "internal_error".to_owned(), "payload_too_large".to_owned()]);
    let mut stack = vec![std::path::PathBuf::from("src")];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            for ctor in [
                "AppError::validation(",
                "AppError::conflict(",
                "AppError::forbidden(",
                "AppError::unauthorized(",
                "::validation(\n",
                "::conflict(\n",
            ] {
                for part in src.split(ctor).skip(1) {
                    let part = part.trim_start();
                    if let Some(rest) = part.strip_prefix('"') {
                        if let Some(end) = rest.find('"') {
                            codes.insert(rest[..end].to_owned());
                        }
                    }
                }
            }
        }
    }
    let missing: Vec<&String> = codes.iter().filter(|c| !readme.contains(&format!("`{c}`"))).collect();
    assert!(missing.is_empty(), "error codes missing from docs/REFERENCE.md: {missing:?}");
}
