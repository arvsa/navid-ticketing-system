mod common;

use axum::http::{Method, StatusCode};
use backend::{
    auth::bootstrap,
    authz::permission::{self, CatalogError},
    db::MIGRATOR,
};
use common::*;
use serde_json::json;
use sqlx::PgPool;

const PW: &str = "correct-horse-1";

async fn member(app: &TestApp, email: &str) -> uuid::Uuid {
    create_user(&app.db, NewUser::member(email, PW)).await
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn login_success_sets_session_cookie(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let user_id = member(&app, "ann@example.com").await;

    // email matching is case-insensitive
    let res = app.login("ANN@example.com", PW).await;
    assert_eq!(res.status, StatusCode::OK, "{}", res.body);
    assert_eq!(res.body["user"]["id"], user_id.to_string());
    assert_eq!(res.body["user"]["email"], "ann@example.com");
    assert!(res.body["user"]["last_login_at"].is_string());

    let set_cookie = res.set_cookie().unwrap();
    for attr in ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=604800"] {
        assert!(set_cookie.contains(attr), "missing {attr} in {set_cookie}");
    }
    assert!(!set_cookie.contains("Secure"), "Secure is off in dev: {set_cookie}");

    // Only the hash of the token is stored, and it expires in 7 days.
    let token = res.session_cookie().unwrap().trim_start_matches("sid=").to_owned();
    let row = sqlx::query!(
        r#"SELECT token_hash, (expires_at - created_at) = interval '7 days' AS "seven_days!" FROM user_session"#
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(token.len(), 64);
    assert_ne!(row.token_hash, token.as_bytes());
    assert_eq!(row.token_hash.len(), 32);
    assert!(row.seven_days);

    let me = app.req(Method::GET, "/api/me").cookie(&res.session_cookie().unwrap()).send().await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.body["user"]["id"], user_id.to_string());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn wrong_password_and_unknown_email_look_the_same(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;

    let wrong = app.login("ann@example.com", "nope-nope-nope").await;
    let unknown = app.login("ghost@example.com", "nope-nope-nope").await;
    for res in [&wrong, &unknown] {
        assert_eq!(res.status, StatusCode::UNAUTHORIZED);
        assert_eq!(res.error_code(), Some("invalid_credentials"));
        assert!(res.set_cookie().is_none());
    }
    assert_eq!(wrong.body, unknown.body);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn malformed_login_body_is_422(pool: PgPool) {
    let app = TestApp::new(pool);
    let res = app.post("/api/auth/login", json!({ "email": "a@example.com" })).await;
    assert_eq!(res.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(res.error_code(), Some("invalid_body"));
}

// ---------------------------------------------------------------------------
// Lockout
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn five_failures_lock_the_account_for_15_minutes(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let id = member(&app, "ann@example.com").await;

    for _ in 0..5 {
        assert_eq!(app.login("ann@example.com", "wrong-password").await.status, StatusCode::UNAUTHORIZED);
    }
    let locked = sqlx::query_scalar!(
        r#"SELECT locked_until BETWEEN now() + interval '14 minutes' AND now() + interval '16 minutes' AS "ok!"
           FROM app_user WHERE id = $1"#,
        id
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert!(locked, "locked_until should be ~15 minutes ahead");

    // The right password is refused while locked, with the same answer.
    let res = app.login("ann@example.com", PW).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(res.error_code(), Some("invalid_credentials"));

    // Once the lock has passed, the right password works and resets the state.
    sqlx::query!("UPDATE app_user SET locked_until = now() - interval '1 second' WHERE id = $1", id)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(app.login("ann@example.com", PW).await.status, StatusCode::OK);
    let row = sqlx::query!("SELECT failed_login_count, locked_until FROM app_user WHERE id = $1", id)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(row.failed_login_count, 0);
    assert!(row.locked_until.is_none());
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn success_resets_the_failure_count(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let id = member(&app, "ann@example.com").await;

    for _ in 0..4 {
        app.login("ann@example.com", "wrong-password").await;
    }
    assert_eq!(app.login("ann@example.com", PW).await.status, StatusCode::OK);
    // Four more failures must not lock: the count started again from zero.
    for _ in 0..4 {
        app.login("ann@example.com", "wrong-password").await;
    }
    assert_eq!(app.login("ann@example.com", PW).await.status, StatusCode::OK);
    let count = sqlx::query_scalar!("SELECT failed_login_count FROM app_user WHERE id = $1", id)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(count, 0);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn missing_or_garbage_cookie_is_401(pool: PgPool) {
    let app = TestApp::new(pool);
    let none = app.get("/api/me").await;
    assert_eq!(none.status, StatusCode::UNAUTHORIZED);
    assert_eq!(none.error_code(), Some("unauthenticated"));

    let garbage = app.req(Method::GET, "/api/me").cookie("sid=not-a-token").send().await;
    assert_eq!(garbage.status, StatusCode::UNAUTHORIZED);

    let unknown = app.req(Method::GET, "/api/me").cookie(&format!("sid={}", "a".repeat(64))).send().await;
    assert_eq!(unknown.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn expired_session_is_rejected(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;

    sqlx::query!("UPDATE user_session SET expires_at = now() - interval '1 second'").execute(&app.db).await.unwrap();
    let res = app.req(Method::GET, "/api/me").cookie(&cookie).send().await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(res.error_code(), Some("unauthenticated"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn idle_session_expires_after_12_hours(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;

    sqlx::query!("UPDATE user_session SET last_seen_at = now() - interval '11 hours 59 minutes'")
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&cookie).send().await.status, StatusCode::OK);

    sqlx::query!("UPDATE user_session SET last_seen_at = now() - interval '12 hours 1 minute'")
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&cookie).send().await.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn last_seen_slides_at_most_once_a_minute(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;

    let last_seen =
        || async { sqlx::query_scalar!("SELECT last_seen_at FROM user_session").fetch_one(&app.db).await.unwrap() };

    // Fresh session: a request within the minute doesn't write.
    sqlx::query!("UPDATE user_session SET last_seen_at = now() - interval '30 seconds'")
        .execute(&app.db)
        .await
        .unwrap();
    let before = last_seen().await;
    app.req(Method::GET, "/api/me").cookie(&cookie).send().await;
    assert_eq!(last_seen().await, before);

    // Older than a minute: slides forward.
    sqlx::query!("UPDATE user_session SET last_seen_at = now() - interval '2 minutes'").execute(&app.db).await.unwrap();
    let before = last_seen().await;
    app.req(Method::GET, "/api/me").cookie(&cookie).send().await;
    assert!(last_seen().await > before);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn logout_revokes_the_session(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;

    let res = app.req(Method::POST, "/api/auth/logout").cookie(&cookie).send().await;
    assert_eq!(res.status, StatusCode::NO_CONTENT);
    assert!(res.set_cookie().unwrap().contains("Max-Age=0"));

    let revoked = sqlx::query_scalar!(r#"SELECT revoked_at IS NOT NULL AS "r!" FROM user_session"#)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert!(revoked);
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&cookie).send().await.status, StatusCode::UNAUTHORIZED);
    // Logging out again needs a session.
    let again = app.req(Method::POST, "/api/auth/logout").cookie(&cookie).send().await;
    assert_eq!(again.status, StatusCode::UNAUTHORIZED);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn inactive_user_loses_sessions_and_cannot_log_in(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let id = member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;

    sqlx::query!("UPDATE app_user SET is_active = false WHERE id = $1", id).execute(&app.db).await.unwrap();

    assert_eq!(app.req(Method::GET, "/api/me").cookie(&cookie).send().await.status, StatusCode::UNAUTHORIZED);
    let res = app.login("ann@example.com", PW).await;
    assert_eq!(res.status, StatusCode::UNAUTHORIZED);
    assert_eq!(res.error_code(), Some("invalid_credentials"));
}

// ---------------------------------------------------------------------------
// Forced password change
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn must_change_password_gates_everything_but_me_password_and_logout(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let mut new_user = NewUser::member("ann@example.com", PW);
    new_user.must_change_password = true;
    create_user(&app.db, new_user).await;

    let cookie = app.session("ann@example.com", PW).await;
    let other_cookie = app.session("ann@example.com", PW).await;

    // Allowed while the change is pending:
    let me = app.req(Method::GET, "/api/me").cookie(&cookie).send().await;
    assert_eq!(me.status, StatusCode::OK);
    assert_eq!(me.body["user"]["must_change_password"], true);

    // Everything else is gated:
    let gated = app.req(Method::GET, "/api/permissions").cookie(&cookie).send().await;
    assert_eq!(gated.status, StatusCode::FORBIDDEN);
    assert_eq!(gated.error_code(), Some("password_change_required"));

    // Change it.
    let res = app
        .req(Method::POST, "/api/me/password")
        .cookie(&cookie)
        .json(json!({ "current_password": PW, "new_password": "a-brand-new-one" }))
        .send()
        .await;
    assert_eq!(res.status, StatusCode::NO_CONTENT, "{}", res.body);

    // The gate is lifted for this session...
    let after = app.req(Method::GET, "/api/permissions").cookie(&cookie).send().await;
    assert_eq!(after.status, StatusCode::OK);
    assert_eq!(after.body.as_array().unwrap().len(), 17);
    // ...the other session was signed out...
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&other_cookie).send().await.status, StatusCode::UNAUTHORIZED);
    // ...and only the new password works.
    assert_eq!(app.login("ann@example.com", PW).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(app.login("ann@example.com", "a-brand-new-one").await.status, StatusCode::OK);

    // Logout also works while gated.
    let mut gated_user = NewUser::member("bob@example.com", PW);
    gated_user.must_change_password = true;
    create_user(&app.db, gated_user).await;
    let bob = app.session("bob@example.com", PW).await;
    assert_eq!(app.req(Method::POST, "/api/auth/logout").cookie(&bob).send().await.status, StatusCode::NO_CONTENT);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn change_password_validates_input(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;

    let change = |current: &str, new: &str| {
        app.req(Method::POST, "/api/me/password")
            .cookie(&cookie)
            .json(json!({ "current_password": current, "new_password": new }))
            .send()
    };
    let wrong = change("not-my-password", "another-password").await;
    assert_eq!(wrong.status, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(wrong.error_code(), Some("invalid_current_password"));

    let short = change(PW, "short").await;
    assert_eq!(short.error_code(), Some("weak_password"));

    let same = change(PW, PW).await;
    assert_eq!(same.error_code(), Some("password_unchanged"));
}

// ---------------------------------------------------------------------------
// CSRF origin check
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn non_get_requests_need_the_app_origin(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    member(&app, "ann@example.com").await;
    let body = json!({ "email": "ann@example.com", "password": PW });

    for origin in [None, Some("https://evil.example"), Some("http://localhost:5173.evil.example")] {
        let res = app.req(Method::POST, "/api/auth/login").origin(origin).json(body.clone()).send().await;
        assert_eq!(res.status, StatusCode::FORBIDDEN, "origin {origin:?}");
        assert_eq!(res.error_code(), Some("origin_mismatch"));
        assert!(res.set_cookie().is_none());
    }

    let cookie = app.session("ann@example.com", PW).await;
    // GET needs no Origin.
    let get = app.req(Method::GET, "/api/me").origin(None).cookie(&cookie).send().await;
    assert_eq!(get.status, StatusCode::OK);
    // A cross-site logout attempt is refused and the session survives.
    let res =
        app.req(Method::POST, "/api/auth/logout").origin(Some("https://evil.example")).cookie(&cookie).send().await;
    assert_eq!(res.status, StatusCode::FORBIDDEN);
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&cookie).send().await.status, StatusCode::OK);
}

// ---------------------------------------------------------------------------
// Actor: memberships and grants
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn me_reports_memberships_and_effective_grants(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let admin = member(&app, "admin@example.com").await;
    let ann = member(&app, "ann@example.com").await;
    let branch = create_branch(&app.db, "NORTH", admin).await;
    add_member(&app.db, branch, ann).await;

    let cookie = app.session("ann@example.com", PW).await;
    let me = app.req(Method::GET, "/api/me").cookie(&cookie).send().await;
    let memberships = me.body["memberships"].as_array().unwrap();
    assert_eq!(memberships.len(), 1);
    let m = &memberships[0];
    assert_eq!(m["branch"]["id"], branch.to_string());
    assert_eq!(m["branch"]["code"], "NORTH");
    assert_eq!(m["is_admin"], false);

    // The "All members" baseline from the schema trigger.
    let grants = m["grants"].as_array().unwrap();
    assert_eq!(grants.len(), 12, "{grants:#?}");
    assert!(grants.contains(&json!({ "permission": "issue.read", "issue_type": null, "scope": "branch" })));
    assert!(grants.contains(&json!({ "permission": "issue.create", "issue_type": "ticket", "scope": "branch" })));
    assert!(grants.contains(&json!({ "permission": "work_item.update", "issue_type": null, "scope": "targeted" })));

    let admin_cookie = app.session("admin@example.com", PW).await;
    let admin_me = app.req(Method::GET, "/api/me").cookie(&admin_cookie).send().await;
    assert_eq!(admin_me.body["memberships"][0]["is_admin"], true);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn group_and_membership_changes_apply_on_the_next_request(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let admin = member(&app, "admin@example.com").await;
    let ann = member(&app, "ann@example.com").await;
    let branch = create_branch(&app.db, "NORTH", admin).await;
    add_member(&app.db, branch, ann).await;
    let cookie = app.session("ann@example.com", PW).await;

    let grants = |res: &TestResponse| res.body["memberships"][0]["grants"].as_array().map_or(0, Vec::len);

    // An extra group with one grant.
    let group =
        sqlx::query_scalar!("INSERT INTO user_group (branch_id, name) VALUES ($1, 'Staff') RETURNING id", branch)
            .fetch_one(&app.db)
            .await
            .unwrap();
    sqlx::query!(
        "INSERT INTO group_permission (group_id, permission_key, scope) VALUES ($1, 'export.run', 'branch')",
        group
    )
    .execute(&app.db)
    .await
    .unwrap();
    sqlx::query!("INSERT INTO group_member (group_id, user_id, branch_id) VALUES ($1, $2, $3)", group, ann, branch)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(grants(&app.req(Method::GET, "/api/me").cookie(&cookie).send().await), 13);

    // Archived groups grant nothing.
    sqlx::query!("UPDATE user_group SET archived_at = now() WHERE id = $1", group).execute(&app.db).await.unwrap();
    assert_eq!(grants(&app.req(Method::GET, "/api/me").cookie(&cookie).send().await), 12);
    sqlx::query!("UPDATE user_group SET archived_at = NULL WHERE id = $1", group).execute(&app.db).await.unwrap();

    // Removed from the group: the grant is gone on the next request.
    sqlx::query!("DELETE FROM group_member WHERE group_id = $1 AND user_id = $2", group, ann)
        .execute(&app.db)
        .await
        .unwrap();
    assert_eq!(grants(&app.req(Method::GET, "/api/me").cookie(&cookie).send().await), 12);

    // Left the branch: the membership and every grant in it disappear.
    sqlx::query!("UPDATE branch_membership SET left_at = now() WHERE user_id = $1 AND branch_id = $2", ann, branch)
        .execute(&app.db)
        .await
        .unwrap();
    let me = app.req(Method::GET, "/api/me").cookie(&cookie).send().await;
    assert_eq!(me.body["memberships"], json!([]));
}

// ---------------------------------------------------------------------------
// Permission catalog
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn permission_enum_matches_the_table(pool: PgPool) {
    permission::verify_catalog(&pool).await.unwrap();

    sqlx::query!("INSERT INTO permission (key, description, per_issue_type, allowed_scopes) VALUES ('x.y', 'x', false, '{branch}')")
        .execute(&pool)
        .await
        .unwrap();
    let err = permission::verify_catalog(&pool).await.unwrap_err();
    assert!(matches!(&err, CatalogError::Mismatch(msg) if msg.contains("x.y")), "{err}");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn permission_catalog_detects_scope_drift(pool: PgPool) {
    sqlx::query!("UPDATE permission SET allowed_scopes = '{branch}' WHERE key = 'issue.read'")
        .execute(&pool)
        .await
        .unwrap();
    let err = permission::verify_catalog(&pool).await.unwrap_err();
    assert!(err.to_string().contains("issue.read"), "{err}");
}

// ---------------------------------------------------------------------------
// Bootstrap CLI
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn bootstrap_creates_a_super_admin_with_a_temporary_password(pool: PgPool) {
    let app = TestApp::new(pool);
    let created =
        bootstrap::create_super_admin(&app.db, "boss@example.com", "Boss", "Person").await.expect("bootstrap");
    let temp = created.temporary_password.expose().to_owned();
    assert_eq!(temp.len(), 16);

    let res = app.login("boss@example.com", &temp).await;
    assert_eq!(res.status, StatusCode::OK);
    assert_eq!(res.body["user"]["is_super_admin"], true);
    assert_eq!(res.body["user"]["must_change_password"], true);

    let audit = sqlx::query!("SELECT entity_type, action, actor_id FROM audit_log").fetch_one(&app.db).await.unwrap();
    assert_eq!((audit.entity_type.as_str(), audit.action.as_str()), ("app_user", "create"));
    assert!(audit.actor_id.is_none());

    let dup = bootstrap::create_super_admin(&app.db, "BOSS@example.com", "B", "P").await.unwrap_err();
    assert_eq!(dup.code(), "email_taken");
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn reset_password_forces_a_change_and_signs_out(pool: PgPool) {
    let app = TestApp::new(pool);
    create_root(&app.db).await;
    let id = member(&app, "ann@example.com").await;
    let cookie = app.session("ann@example.com", PW).await;
    sqlx::query!("UPDATE app_user SET locked_until = now() + interval '1 hour' WHERE id = $1", id)
        .execute(&app.db)
        .await
        .unwrap();

    let reset = bootstrap::reset_password(&app.db, "ann@example.com").await.unwrap();
    assert_eq!(app.req(Method::GET, "/api/me").cookie(&cookie).send().await.status, StatusCode::UNAUTHORIZED);

    let res = app.login("ann@example.com", reset.temporary_password.expose()).await;
    assert_eq!(res.status, StatusCode::OK, "reset also clears the lockout");
    assert_eq!(res.body["user"]["must_change_password"], true);

    let missing = bootstrap::reset_password(&app.db, "ghost@example.com").await.unwrap_err();
    assert_eq!(missing.code(), "not_found");
}
