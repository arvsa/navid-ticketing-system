//! Phase 2: branches, memberships, groups, grants, and the 6.2 rules
//! enforced end to end through the HTTP API.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Branches (6.2: super admin only)
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn only_super_admins_create_and_edit_branches(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;

    let body =
        json!({ "code": "CCC", "name": "Central", "timezone": "Europe/Paris", "first_admin_user_id": org.plain_a });
    for cookie in [&admin, &boss_like] {
        assert_status(
            &call(&app, cookie, Method::POST, "/api/branches", Some(body.clone())).await,
            StatusCode::FORBIDDEN,
            Some("forbidden"),
        );
    }
    let created = call(&app, &root, Method::POST, "/api/branches", Some(body.clone())).await;
    assert_status(&created, StatusCode::CREATED, None);
    let branch_id: Uuid = created.body["id"].as_str().unwrap().parse().unwrap();
    assert_eq!(created.body["timezone"], "Europe/Paris");

    // The schema created "All members" with the baseline and the admin membership.
    let groups = call(&app, &root, Method::GET, &format!("/api/branches/{branch_id}/groups"), None).await;
    let items = groups.body["items"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["is_default"], true);
    assert_eq!(items[0]["member_count"], 1);
    let is_admin = sqlx::query_scalar!(
        "SELECT is_admin FROM branch_membership WHERE branch_id = $1 AND user_id = $2",
        branch_id,
        org.plain_a
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert!(is_admin);
    assert_eq!(audit_count(&app.db, "branch", "create").await, 1);

    // Validation and uniqueness.
    let dup_body = json!({ "code": "CCC", "name": "Other", "timezone": "UTC", "first_admin_user_id": org.plain_a });
    let dup = call(&app, &root, Method::POST, "/api/branches", Some(dup_body)).await;
    assert_status(&dup, StatusCode::CONFLICT, Some("branch_code_taken"));
    let bad_tz = json!({ "code": "DDD", "name": "D", "timezone": "Mars/Base", "first_admin_user_id": org.plain_a });
    assert_status(
        &call(&app, &root, Method::POST, "/api/branches", Some(bad_tz)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_timezone"),
    );
    let bad_code = json!({ "code": "lower", "name": "E", "timezone": "UTC", "first_admin_user_id": org.plain_a });
    assert_status(
        &call(&app, &root, Method::POST, "/api/branches", Some(bad_code)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_branch_code"),
    );
    let no_admin = json!({ "code": "FFF", "name": "F", "timezone": "UTC", "first_admin_user_id": Uuid::new_v4() });
    assert_status(
        &call(&app, &root, Method::POST, "/api/branches", Some(no_admin)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_admin"),
    );

    // Editing (including deactivation) is super admin only.
    let uri = format!("/api/branches/{}", org.branch_a);
    assert_status(
        &call(&app, &admin, Method::PATCH, &uri, Some(json!({ "name": "Renamed" }))).await,
        StatusCode::FORBIDDEN,
        None,
    );
    assert_status(
        &call(&app, &admin, Method::PATCH, &uri, Some(json!({ "is_active": false }))).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let renamed = call(&app, &root, Method::PATCH, &uri, Some(json!({ "name": "Renamed", "email": null }))).await;
    assert_status(&renamed, StatusCode::OK, None);
    assert_eq!(renamed.body["name"], "Renamed");
    assert_eq!(audit_count(&app.db, "branch", "update").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn branch_list_shows_only_my_branches(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let ids = |res: TestResponse| -> Vec<String> {
        res.body["items"].as_array().unwrap().iter().map(|b| b["id"].as_str().unwrap().to_owned()).collect()
    };

    let plain = as_user(&app, "plain_a@example.com").await;
    assert_eq!(ids(call(&app, &plain, Method::GET, "/api/branches", None).await), [org.branch_a.to_string()]);
    let multi = as_user(&app, "multi@example.com").await;
    assert_eq!(ids(call(&app, &multi, Method::GET, "/api/branches", None).await).len(), 2);
    let root = as_root(&app).await;
    assert_eq!(ids(call(&app, &root, Method::GET, "/api/branches", None).await).len(), 2);

    // Not a member of B: 404, not 403.
    let res = call(&app, &plain, Method::GET, &format!("/api/branches/{}", org.branch_b), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, Some("not_found"));
}

// ---------------------------------------------------------------------------
// Admins and super admins
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn only_super_admins_appoint_and_demote_admins(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;
    let uri = |user: Uuid| format!("/api/branches/{}/admins/{user}", org.branch_a);

    for cookie in [&admin, &boss_like] {
        assert_status(&call(&app, cookie, Method::PUT, &uri(org.plain_a), None).await, StatusCode::FORBIDDEN, None);
    }
    assert_status(&call(&app, &admin, Method::DELETE, &uri(org.admin_a), None).await, StatusCode::FORBIDDEN, None);

    assert_status(&call(&app, &root, Method::PUT, &uri(org.plain_a), None).await, StatusCode::NO_CONTENT, None);
    assert_status(&call(&app, &root, Method::DELETE, &uri(org.admin_a), None).await, StatusCode::NO_CONTENT, None);
    // The last admin can't be demoted.
    let last = call(&app, &root, Method::DELETE, &uri(org.plain_a), None).await;
    assert_status(&last, StatusCode::CONFLICT, Some("last_admin"));

    // Appointing a non-member adds the membership.
    assert_status(&call(&app, &root, Method::PUT, &uri(org.admin_b), None).await, StatusCode::NO_CONTENT, None);
    let admin_b = as_user(&app, "admin_b@example.com").await;
    let me = call(&app, &admin_b, Method::GET, "/api/me", None).await;
    assert_eq!(me.body["memberships"].as_array().unwrap().len(), 2);

    assert!(audit_count(&app.db, "branch_membership", "update").await >= 2);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn concurrent_demotions_cannot_remove_every_admin(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let uri = |user: Uuid| format!("/api/branches/{}/admins/{user}", org.branch_a);
    call(&app, &root, Method::PUT, &uri(org.plain_a), None).await;

    let (uri_1, uri_2) = (uri(org.admin_a), uri(org.plain_a));
    let (first, second) =
        tokio::join!(call(&app, &root, Method::DELETE, &uri_1, None), call(&app, &root, Method::DELETE, &uri_2, None),);
    let mut statuses = [first.status, second.status];
    statuses.sort();
    assert_eq!(statuses, [StatusCode::NO_CONTENT, StatusCode::CONFLICT], "{} / {}", first.body, second.body);

    let admins = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM branch_membership WHERE branch_id = $1 AND is_admin AND left_at IS NULL"#,
        org.branch_a
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    assert_eq!(admins, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn super_admin_status_is_super_admin_only_and_never_reaches_zero(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let uri = |user: Uuid| format!("/api/users/{user}/super-admin");

    assert_status(&call(&app, &admin, Method::PUT, &uri(org.admin_a), None).await, StatusCode::FORBIDDEN, None);
    assert_status(&call(&app, &admin, Method::DELETE, &uri(org.root), None).await, StatusCode::FORBIDDEN, None);

    // The last super admin can't step down or be deactivated.
    let res = call(&app, &root, Method::DELETE, &uri(org.root), None).await;
    assert_status(&res, StatusCode::CONFLICT, Some("last_super_admin"));
    let res = call(
        &app,
        &root,
        Method::PATCH,
        &format!("/api/users/{}/active", org.root),
        Some(json!({ "is_active": false })),
    )
    .await;
    assert_status(&res, StatusCode::CONFLICT, Some("last_super_admin"));

    // With a second one, it works.
    assert_status(&call(&app, &root, Method::PUT, &uri(org.multi), None).await, StatusCode::NO_CONTENT, None);
    assert_status(&call(&app, &root, Method::DELETE, &uri(org.root), None).await, StatusCode::NO_CONTENT, None);
    assert_eq!(audit_count(&app.db, "app_user", "update").await, 2);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn adding_members_creates_accounts_or_memberships(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let manager = as_user(&app, "manager_a@example.com").await;
    let uri = format!("/api/branches/{}/members", org.branch_a);

    // New account: a temporary password, returned once.
    let res = call(
        &app,
        &manager,
        Method::POST,
        &uri,
        Some(json!({ "email": "New@Example.com", "first_name": "New", "last_name": "Person" })),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(res.body["created"], true);
    let temp = res.body["temporary_password"].as_str().unwrap().to_owned();
    let login = app.login("new@example.com", &temp).await;
    assert_eq!(login.status, StatusCode::OK);
    assert_eq!(login.body["user"]["must_change_password"], true);
    // ...in "All members" via the trigger.
    assert_eq!(login.body["memberships"][0]["grants"].as_array().unwrap().len(), 12);

    // New account without names.
    let res = call(&app, &manager, Method::POST, &uri, Some(json!({ "email": "noname@example.com" }))).await;
    assert_status(&res, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_name"));

    // Existing account from another branch: just a membership.
    let res = call(&app, &manager, Method::POST, &uri, Some(json!({ "email": "admin_b@example.com" }))).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(res.body["created"], false);
    assert!(res.body.get("temporary_password").is_none());

    // Already a member.
    let res = call(&app, &manager, Method::POST, &uri, Some(json!({ "email": "plain_a@example.com" }))).await;
    assert_status(&res, StatusCode::CONFLICT, Some("already_member"));

    // A plain member can't add people.
    let plain = as_user(&app, "plain_a@example.com").await;
    let res = call(
        &app,
        &plain,
        Method::POST,
        &uri,
        Some(json!({ "email": "x@example.com", "first_name": "X", "last_name": "Y" })),
    )
    .await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn removing_a_member_ends_access_and_only_admins_reactivate(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let manager = as_user(&app, "manager_a@example.com").await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let members_uri = format!("/api/branches/{}/members", org.branch_a);

    let extra_group = create_group(&app.db, org.branch_a, "Extra", &[], &[org.plain_a]).await;
    let res = call(&app, &manager, Method::DELETE, &format!("{members_uri}/{}", org.plain_a), None).await;
    assert_status(&res, StatusCode::NO_CONTENT, None);

    // Next request: no access to the branch at all.
    let res = call(&app, &plain, Method::GET, &members_uri, None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    let me = call(&app, &plain, Method::GET, "/api/me", None).await;
    assert_eq!(me.body["memberships"], json!([]));
    // ...and out of every group in the branch.
    let still_in = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM group_member WHERE user_id = $1"#, org.plain_a)
        .fetch_one(&app.db)
        .await
        .unwrap();
    assert_eq!(still_in, 0, "group {extra_group} membership should be gone");

    // Departed members are listed only for admins.
    let res = call(&app, &manager, Method::GET, &format!("{members_uri}?include_left=true"), None).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
    let res = call(&app, &admin, Method::GET, &format!("{members_uri}?include_left=true"), None).await;
    assert!(res.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["user_id"] == org.plain_a.to_string() && m["left_at"].is_string()));

    // Reactivating a departed member is admin only.
    let body = json!({ "email": "plain_a@example.com" });
    assert_status(
        &call(&app, &manager, Method::POST, &members_uri, Some(body.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let res = call(&app, &admin, Method::POST, &members_uri, Some(body)).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(res.body["reactivated"], true);
    let me = call(&app, &plain, Method::GET, "/api/me", None).await;
    assert_eq!(me.body["memberships"].as_array().unwrap().len(), 1);

    assert_eq!(audit_count(&app.db, "branch_membership", "remove").await, 1);
    assert_eq!(audit_count(&app.db, "branch_membership", "reactivate").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn admins_cannot_be_removed_until_demoted(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let res =
        call(&app, &root, Method::DELETE, &format!("/api/branches/{}/members/{}", org.branch_a, org.admin_a), None)
            .await;
    assert_status(&res, StatusCode::CONFLICT, Some("member_is_admin"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn member_manage_never_touches_admins_or_other_branches(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let manager = as_user(&app, "manager_a@example.com").await;
    let a = org.branch_a;

    // Admins (here, or in another branch) are out of reach.
    sqlx::query!(
        "UPDATE branch_membership SET is_admin = true WHERE user_id = $1 AND branch_id = $2",
        org.multi,
        org.branch_b
    )
    .execute(&app.db)
    .await
    .unwrap();
    for target in [org.admin_a, org.multi] {
        let res = call(
            &app,
            &manager,
            Method::PATCH,
            &format!("/api/branches/{a}/members/{target}"),
            Some(json!({ "first_name": "Hacked" })),
        )
        .await;
        assert_status(&res, StatusCode::FORBIDDEN, None);
        let res = call(&app, &manager, Method::POST, &format!("/api/users/{target}/reset-password"), None).await;
        assert_status(&res, StatusCode::FORBIDDEN, None);
    }
    // Plain members are fine.
    let res = call(
        &app,
        &manager,
        Method::PATCH,
        &format!("/api/branches/{a}/members/{}", org.plain_a),
        Some(json!({ "first_name": "Renamed" })),
    )
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["first_name"], "Renamed");

    // Other branches: invisible.
    let res = call(
        &app,
        &manager,
        Method::PATCH,
        &format!("/api/branches/{}/members/{}", org.branch_b, org.admin_b),
        Some(json!({ "first_name": "X" })),
    )
    .await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    let res = call(&app, &manager, Method::POST, &format!("/api/users/{}/reset-password", org.admin_b), None).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn password_resets_follow_member_rules(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let plain_session = as_user(&app, "plain_a@example.com").await;

    let res = call(&app, &admin, Method::POST, &format!("/api/users/{}/reset-password", org.plain_a), None).await;
    assert_status(&res, StatusCode::OK, None);
    let temp = res.body["temporary_password"].as_str().unwrap();
    // Sessions revoked; the temp password works and forces a change.
    assert_status(&call(&app, &plain_session, Method::GET, "/api/me", None).await, StatusCode::UNAUTHORIZED, None);
    let login = app.login("plain_a@example.com", temp).await;
    assert_eq!(login.body["user"]["must_change_password"], true);

    // A branch admin can't take over a super admin's account.
    add_member(&app.db, org.branch_a, org.root).await;
    let res = call(&app, &admin, Method::POST, &format!("/api/users/{}/reset-password", org.root), None).await;
    assert_status(&res, StatusCode::FORBIDDEN, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn deactivation_rules(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let manager = as_user(&app, "manager_a@example.com").await;
    let active = |user: Uuid| format!("/api/users/{user}/active");
    let off = Some(json!({ "is_active": false }));

    // Multi-branch users and admins: super admin only.
    assert_status(
        &call(&app, &admin, Method::PATCH, &active(org.multi), off.clone()).await,
        StatusCode::FORBIDDEN,
        None,
    );
    assert_status(
        &call(&app, &manager, Method::PATCH, &active(org.multi), off.clone()).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let second_admin = create_user(&app.db, NewUser::member("admin2@example.com", PW)).await;
    add_member(&app.db, org.branch_a, second_admin).await;
    sqlx::query!("UPDATE branch_membership SET is_admin = true WHERE user_id = $1", second_admin)
        .execute(&app.db)
        .await
        .unwrap();
    assert_status(
        &call(&app, &admin, Method::PATCH, &active(second_admin), off.clone()).await,
        StatusCode::FORBIDDEN,
        None,
    );

    // Single-branch plain member: member.manage is enough.
    let plain_session = as_user(&app, "plain_a@example.com").await;
    assert_status(
        &call(&app, &manager, Method::PATCH, &active(org.plain_a), off.clone()).await,
        StatusCode::NO_CONTENT,
        None,
    );
    assert_status(&call(&app, &plain_session, Method::GET, "/api/me", None).await, StatusCode::UNAUTHORIZED, None);
    assert_eq!(audit_count(&app.db, "app_user", "deactivate").await, 1);

    // Super admin: allowed, but never leaving a branch without an admin.
    assert_status(
        &call(&app, &root, Method::PATCH, &active(org.multi), off.clone()).await,
        StatusCode::NO_CONTENT,
        None,
    );
    let res = call(&app, &root, Method::PATCH, &active(org.admin_b), off.clone()).await;
    assert_status(&res, StatusCode::CONFLICT, Some("last_admin"));
    assert_status(&call(&app, &root, Method::PATCH, &active(second_admin), off).await, StatusCode::NO_CONTENT, None);
}

// ---------------------------------------------------------------------------
// Groups (6.2: branch admin only)
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn only_admins_manage_groups_even_against_admin_like_groups(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let groups_uri = format!("/api/branches/{}/groups", org.branch_a);
    let g = org.managers_group;

    let forbidden = [
        (Method::POST, groups_uri.clone(), Some(json!({ "name": "Mine" }))),
        (Method::PATCH, format!("/api/groups/{g}"), Some(json!({ "name": "Renamed" }))),
        (Method::DELETE, format!("/api/groups/{g}"), None),
        (Method::PUT, format!("/api/groups/{g}/members/{}", org.plain_a), None),
        (Method::DELETE, format!("/api/groups/{g}/members/{}", org.manager_a), None),
        (
            Method::POST,
            format!("/api/groups/{g}/permissions"),
            Some(json!({ "permission": "export.run", "scope": "branch" })),
        ),
        (Method::GET, format!("/api/groups/{g}/permissions"), None),
    ];
    for (method, uri, body) in forbidden {
        let res = call(&app, &boss_like, method.clone(), &uri, body).await;
        assert_status(&res, StatusCode::FORBIDDEN, None);
    }

    // Admin of another branch: not visible.
    let admin_b = as_user(&app, "admin_b@example.com").await;
    assert_status(
        &call(&app, &admin_b, Method::PATCH, &format!("/api/groups/{g}"), Some(json!({ "name": "X" }))).await,
        StatusCode::NOT_FOUND,
        None,
    );

    // The admin can do all of it.
    let res =
        call(&app, &admin, Method::POST, &groups_uri, Some(json!({ "name": "Teachers", "description": "Staff" })))
            .await;
    assert_status(&res, StatusCode::CREATED, None);
    let teachers = res.body["id"].as_str().unwrap().to_owned();
    assert_status(
        &call(&app, &admin, Method::POST, &groups_uri, Some(json!({ "name": "teachers " }))).await,
        StatusCode::CREATED,
        None,
    );
    assert_status(
        &call(&app, &admin, Method::POST, &groups_uri, Some(json!({ "name": "Teachers" }))).await,
        StatusCode::CONFLICT,
        Some("group_name_taken"),
    );
    assert_status(
        &call(&app, &admin, Method::PUT, &format!("/api/groups/{teachers}/members/{}", org.plain_a), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    // Non-members of the branch can't join its groups.
    assert_status(
        &call(&app, &admin, Method::PUT, &format!("/api/groups/{teachers}/members/{}", org.admin_b), None).await,
        StatusCode::CONFLICT,
        Some("not_a_member"),
    );

    // Any member can list groups (e.g. to target them).
    let plain = as_user(&app, "plain_a@example.com").await;
    let list = call(&app, &plain, Method::GET, &groups_uri, None).await;
    assert_eq!(list.body["items"].as_array().unwrap().len(), 5);
    let filtered =
        call(&app, &plain, Method::GET, &format!("/api/branches/{}/members?group_id={teachers}", org.branch_a), None)
            .await;
    assert_eq!(filtered.body["items"].as_array().unwrap().len(), 1);

    assert!(audit_count(&app.db, "user_group", "create").await >= 2);
    assert_eq!(audit_count(&app.db, "group_member", "add").await, 1);
    assert_eq!(notifications_of(&app.db, org.plain_a, "added_to_group").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_default_group_cannot_be_deleted_renamed_or_joined_by_hand(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let default = sqlx::query_scalar!("SELECT id FROM user_group WHERE branch_id = $1 AND is_default", org.branch_a)
        .fetch_one(&app.db)
        .await
        .unwrap();
    let uri = format!("/api/groups/{default}");

    assert_status(&call(&app, &admin, Method::DELETE, &uri, None).await, StatusCode::CONFLICT, Some("default_group"));
    assert_status(
        &call(&app, &admin, Method::PATCH, &uri, Some(json!({ "name": "Everyone" }))).await,
        StatusCode::CONFLICT,
        Some("default_group"),
    );
    assert_status(
        &call(&app, &admin, Method::PATCH, &uri, Some(json!({ "archived": true }))).await,
        StatusCode::CONFLICT,
        Some("default_group"),
    );
    assert_status(
        &call(&app, &admin, Method::DELETE, &format!("{uri}/members/{}", org.plain_a), None).await,
        StatusCode::CONFLICT,
        Some("default_group"),
    );
    // Its description and grants are editable.
    assert_status(
        &call(&app, &admin, Method::PATCH, &uri, Some(json!({ "description": "Everyone here" }))).await,
        StatusCode::OK,
        None,
    );

    // Revoking a baseline grant takes effect on the next request.
    let plain = as_user(&app, "plain_a@example.com").await;
    let members_uri = format!("/api/branches/{}/members", org.branch_a);
    assert_status(&call(&app, &plain, Method::GET, &members_uri, None).await, StatusCode::OK, None);
    let grants = call(&app, &admin, Method::GET, &format!("{uri}/permissions"), None).await;
    let member_view =
        grants.body["items"].as_array().unwrap().iter().find(|g| g["permission"] == "member.view").unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned();
    assert_status(
        &call(&app, &admin, Method::DELETE, &format!("/api/group-permissions/{member_view}"), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    assert_status(&call(&app, &plain, Method::GET, &members_uri, None).await, StatusCode::FORBIDDEN, None);
    assert_eq!(audit_count(&app.db, "group_permission", "revoke").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn referenced_groups_are_archived_instead_of_deleted(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;

    let unreferenced = create_group(&app.db, org.branch_a, "Temp", &[], &[org.plain_a]).await;
    let res = call(&app, &admin, Method::DELETE, &format!("/api/groups/{unreferenced}"), None).await;
    assert_eq!(res.body, json!({ "deleted": true, "archived": false }));

    // Reference the managers group from an issue target.
    let issue = sqlx::query_scalar!(
        "INSERT INTO issue (branch_id, type_id, title, created_by) VALUES ($1, (SELECT id FROM issue_type WHERE code = 'ticket'), 'Q', $2) RETURNING id",
        org.branch_a,
        org.admin_a
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO issue_target (issue_id, branch_id, kind, group_id) VALUES ($1, $2, 'group', $3)",
        issue,
        org.branch_a,
        org.managers_group
    )
    .execute(&app.db)
    .await
    .unwrap();

    let manager = as_user(&app, "manager_a@example.com").await;
    let members_uri = format!("/api/branches/{}/members", org.branch_a);
    let body = json!({ "email": "y@example.com", "first_name": "Y", "last_name": "Z" });
    assert_status(
        &call(&app, &manager, Method::POST, &members_uri, Some(body.clone())).await,
        StatusCode::CREATED,
        None,
    );

    let res = call(&app, &admin, Method::DELETE, &format!("/api/groups/{}", org.managers_group), None).await;
    assert_eq!(res.body, json!({ "deleted": false, "archived": true }));
    // Archived groups grant nothing.
    let body = json!({ "email": "z@example.com", "first_name": "Z", "last_name": "Z" });
    assert_status(
        &call(&app, &manager, Method::POST, &members_uri, Some(body.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    // Hidden from the list unless asked for; can be restored.
    let list = call(&app, &admin, Method::GET, &format!("/api/branches/{}/groups", org.branch_a), None).await;
    assert!(!list.body["items"].as_array().unwrap().iter().any(|g| g["id"] == org.managers_group.to_string()));
    let res = call(
        &app,
        &admin,
        Method::PATCH,
        &format!("/api/groups/{}", org.managers_group),
        Some(json!({ "archived": false })),
    )
    .await;
    assert!(res.body["archived_at"].is_null());
    assert_status(&call(&app, &manager, Method::POST, &members_uri, Some(body)).await, StatusCode::CREATED, None);
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn grants_are_validated_with_friendly_errors(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let uri = format!("/api/groups/{}/permissions", org.managers_group);
    let post = |body: Value| call(&app, &admin, Method::POST, &uri, Some(body));

    let cases = [
        (json!({ "permission": "no.such", "scope": "branch" }), "unknown_permission"),
        (json!({ "permission": "issue.create", "scope": "own" }), "invalid_scope"),
        (json!({ "permission": "issue.read", "scope": "galaxy" }), "invalid_scope"),
        (json!({ "permission": "member.view", "issue_type": "ticket", "scope": "branch" }), "invalid_issue_type"),
        (json!({ "permission": "issue.read", "issue_type": "memo", "scope": "branch" }), "invalid_issue_type"),
    ];
    for (body, code) in cases {
        assert_status(&post(body).await, StatusCode::UNPROCESSABLE_ENTITY, Some(code));
    }

    let res = post(json!({ "permission": "issue.edit", "issue_type": "ticket", "scope": "own" })).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert_eq!(res.body["issue_type"], "ticket");
    assert_eq!(res.body["scope"], "own");
    assert_status(
        &post(json!({ "permission": "issue.edit", "issue_type": "ticket", "scope": "own" })).await,
        StatusCode::CONFLICT,
        Some("grant_exists"),
    );

    // Admins are notified; the acting admin is not.
    let admin2 = create_user(&app.db, NewUser::member("admin2@example.com", PW)).await;
    add_member(&app.db, org.branch_a, admin2).await;
    sqlx::query!("UPDATE branch_membership SET is_admin = true WHERE user_id = $1", admin2)
        .execute(&app.db)
        .await
        .unwrap();
    assert_status(&post(json!({ "permission": "export.run", "scope": "branch" })).await, StatusCode::CREATED, None);
    assert_eq!(notifications_of(&app.db, admin2, "permissions_changed").await, 1);
    assert_eq!(notifications_of(&app.db, org.admin_a, "permissions_changed").await, 0);
    assert_eq!(audit_count(&app.db, "group_permission", "grant").await, 2);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn losing_a_group_or_the_branch_revokes_on_the_next_request(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let manager = as_user(&app, "manager_a@example.com").await;
    let reset_uri = format!("/api/users/{}/reset-password", org.plain_a);

    assert_status(&call(&app, &manager, Method::POST, &reset_uri, None).await, StatusCode::OK, None);
    let res = call(
        &app,
        &admin,
        Method::DELETE,
        &format!("/api/groups/{}/members/{}", org.managers_group, org.manager_a),
        None,
    )
    .await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    // Same session, next request.
    assert_status(&call(&app, &manager, Method::POST, &reset_uri, None).await, StatusCode::FORBIDDEN, None);

    // Leaving the branch: everything in it is gone.
    let multi = as_user(&app, "multi@example.com").await;
    let a_members = format!("/api/branches/{}/members", org.branch_a);
    assert_status(&call(&app, &multi, Method::GET, &a_members, None).await, StatusCode::OK, None);
    assert_status(
        &call(&app, &admin, Method::DELETE, &format!("{a_members}/{}", org.multi), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    assert_status(&call(&app, &multi, Method::GET, &a_members, None).await, StatusCode::NOT_FOUND, None);
    // Branch B is unaffected.
    assert_status(
        &call(&app, &multi, Method::GET, &format!("/api/branches/{}/members", org.branch_b), None).await,
        StatusCode::OK,
        None,
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn effective_permissions_show_their_source_groups(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let uri = format!("/api/branches/{}/members/{}/effective-permissions", org.branch_a, org.manager_a);

    let res = call(&app, &admin, Method::GET, &uri, None).await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["is_admin"], false);
    let grants = res.body["grants"].as_array().unwrap();
    assert_eq!(grants.len(), 13);
    let manage = grants.iter().find(|g| g["permission"] == "member.manage").unwrap();
    assert_eq!(manage["group"]["name"], "Managers");
    assert!(grants.iter().filter(|g| g["group"]["name"] == "All members").count() == 12);

    // The member can see their own; other members can't.
    let manager = as_user(&app, "manager_a@example.com").await;
    assert_status(&call(&app, &manager, Method::GET, &uri, None).await, StatusCode::OK, None);
    let plain = as_user(&app, "plain_a@example.com").await;
    assert_status(&call(&app, &plain, Method::GET, &uri, None).await, StatusCode::FORBIDDEN, None);
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn member_lists_page_with_a_keyset_cursor(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let base = format!("/api/branches/{}/members?limit=2", org.branch_a);

    let mut seen = Vec::new();
    let mut uri = base.clone();
    loop {
        let res = call(&app, &admin, Method::GET, &uri, None).await;
        assert_status(&res, StatusCode::OK, None);
        for m in res.body["items"].as_array().unwrap() {
            seen.push(m["user_id"].as_str().unwrap().to_owned());
        }
        match res.body["next_cursor"].as_str() {
            Some(c) => uri = format!("{base}&after={c}"),
            None => break,
        }
    }
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 5, "admin, manager, boss-like, plain, multi");

    assert_status(
        &call(&app, &admin, Method::GET, &format!("{base}&after=zz"), None).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_cursor"),
    );
    let too_big = format!("/api/branches/{}/members?limit=500", org.branch_a);
    assert_status(
        &call(&app, &admin, Method::GET, &too_big, None).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("invalid_limit"),
    );
}

// ---------------------------------------------------------------------------
// Departing members' work
// ---------------------------------------------------------------------------

#[sqlx::test(migrator = "MIGRATOR")]
async fn departing_members_work_items_become_unassigned(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let manager = as_user(&app, "manager_a@example.com").await;

    // A per_member action sent to a group: one item per member.
    let team = create_group(&app.db, org.branch_a, "Team", &[], &[org.plain_a, org.multi]).await;
    let issue = sqlx::query_scalar!(
        r#"INSERT INTO issue (branch_id, type_id, title, completion_mode, created_by)
           VALUES ($1, (SELECT id FROM issue_type WHERE code = 'action'), 'Do it', 'per_member', $2) RETURNING id"#,
        org.branch_a,
        org.admin_a
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    let target = sqlx::query_scalar!(
        "INSERT INTO issue_target (issue_id, branch_id, kind, group_id) VALUES ($1, $2, 'group', $3) RETURNING id",
        issue,
        org.branch_a,
        team
    )
    .fetch_one(&app.db)
    .await
    .unwrap();
    for (assignee, status) in [(org.plain_a, "in_progress"), (org.multi, "open")] {
        sqlx::query!(
            "INSERT INTO work_item (issue_id, target_id, branch_id, assignee_id, status) VALUES ($1, $2, $3, $4, $5::text::work_status)",
            issue,
            target,
            org.branch_a,
            assignee,
            status
        )
        .execute(&app.db)
        .await
        .unwrap();
    }

    // Both leave: the second departure used to violate the unique constraint.
    for user in [org.plain_a, org.multi] {
        let res =
            call(&app, &manager, Method::DELETE, &format!("/api/branches/{}/members/{user}", org.branch_a), None).await;
        assert_status(&res, StatusCode::NO_CONTENT, None);
    }

    let items =
        sqlx::query!(r#"SELECT assignee_id, status::text AS "status!", version FROM work_item ORDER BY status::text"#)
            .fetch_all(&app.db)
            .await
            .unwrap();
    assert_eq!(items.len(), 2);
    for item in &items {
        assert!(item.assignee_id.is_none());
        assert_eq!(item.version, 2);
    }
    // Their status is kept; only the assignee changes.
    assert_eq!(items.iter().map(|i| i.status.as_str()).collect::<Vec<_>>(), ["in_progress", "open"]);

    for user in [org.plain_a, org.multi] {
        assert_eq!(notifications_of(&app.db, user, "unassigned").await, 1);
    }
    assert_eq!(notifications_of(&app.db, org.admin_a, "status_changed").await, 2);
    assert_eq!(audit_count(&app.db, "work_item", "unassign").await, 2);

    // Still at most one item per assignee on a target.
    let dup = sqlx::query!(
        "INSERT INTO work_item (issue_id, target_id, branch_id, assignee_id) VALUES ($1, $2, $3, $4), ($1, $2, $3, $4)",
        issue,
        target,
        org.branch_a,
        org.admin_a
    )
    .execute(&app.db)
    .await;
    assert!(dup.is_err());
}
