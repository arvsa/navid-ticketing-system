//! Permission groups: branch and school-wide ones, "Everyone", attaching
//! them to departments, and the permission config document.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::{json, Value};
use sqlx::PgPool;
use uuid::Uuid;

/// Does `/api/me` list the permission in that branch?
fn has(me: &Value, branch: Uuid, permission: &str) -> bool {
    me["memberships"].as_array().unwrap().iter().find(|m| m["branch"]["id"] == branch.to_string()).unwrap()["grants"]
        .as_array()
        .unwrap()
        .iter()
        .any(|g| g["permission"] == permission)
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn permission_groups_are_admin_only_and_reach_members_through_departments(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let boss_like = as_user(&app, "boss_like_a@example.com").await;
    let plain = as_user(&app, "plain_a@example.com").await;
    let uri = format!("/api/branches/{}/permission-groups", org.branch_a);
    let teachers = create_department(&app.db, org.branch_a, "Teachers", &[], &[org.plain_a]).await;

    // Not even a department holding every grant hands out permissions.
    let body = json!({ "name": "Exporters", "grants": [{ "permission": "export.run" }] });
    assert_status(&call(&app, &boss_like, Method::POST, &uri, Some(body.clone())).await, StatusCode::FORBIDDEN, None);
    assert_status(&call(&app, &boss_like, Method::GET, &uri, None).await, StatusCode::FORBIDDEN, None);

    let res = call(&app, &admin, Method::POST, &uri, Some(body.clone())).await;
    assert_status(&res, StatusCode::CREATED, None);
    let exporters = res.body["id"].as_str().unwrap().to_owned();
    assert_eq!(res.body["grants"], json!([{ "permission": "export.run" }]));
    assert_status(
        &call(&app, &admin, Method::POST, &uri, Some(body)).await,
        StatusCode::CONFLICT,
        Some("permission_group_name_taken"),
    );

    // Attached to Teachers, its grants reach Teachers' members on the next request.
    assert!(!has(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a, "export.run"));
    let attach = format!("/api/departments/{teachers}/permission-groups/{exporters}");
    assert_status(&call(&app, &boss_like, Method::PUT, &attach, None).await, StatusCode::FORBIDDEN, None);
    assert_status(&call(&app, &admin, Method::PUT, &attach, None).await, StatusCode::NO_CONTENT, None);
    assert!(has(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a, "export.run"));
    let list = call(&app, &admin, Method::GET, &uri, None).await;
    let listed = list.body.as_array().unwrap().iter().find(|g| g["id"] == exporters.as_str()).unwrap();
    assert_eq!(listed["department_ids"], json!([teachers]));

    // Another branch's admin can't attach it to their departments.
    let other = create_department(&app.db, org.branch_b, "B team", &[], &[]).await;
    let admin_b = as_user(&app, "admin_b@example.com").await;
    let res =
        call(&app, &admin_b, Method::PUT, &format!("/api/departments/{other}/permission-groups/{exporters}"), None)
            .await;
    assert_status(&res, StatusCode::NOT_FOUND, None);

    // Detached or deleted: gone again.
    assert_status(&call(&app, &admin, Method::DELETE, &attach, None).await, StatusCode::NO_CONTENT, None);
    assert!(!has(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a, "export.run"));
    assert_status(
        &call(&app, &admin, Method::DELETE, &format!("/api/permission-groups/{exporters}"), None).await,
        StatusCode::NO_CONTENT,
        None,
    );
    assert_eq!(audit_count(&app.db, "department_permission_group", "attach").await, 1);
    assert_eq!(audit_count(&app.db, "permission_group", "delete").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn grants_are_validated_and_changes_tell_the_other_admins(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let group = permission_group_of(&app.db, org.managers_department).await;
    let uri = format!("/api/permission-groups/{group}");
    let set = |grants: Value| call(&app, &admin, Method::PATCH, &uri, Some(json!({ "grants": grants })));

    let cases = [
        (json!([{ "permission": "no.such" }]), "unknown_permission"),
        (json!([{ "permission": "issue.create" }]), "unknown_permission"),
        (json!([{ "permission": "member.view", "issue_type": "ticket" }]), "invalid_issue_type"),
        (json!([{ "permission": "issue.read", "issue_type": "memo" }]), "invalid_issue_type"),
        (json!([{ "permission": "department.members.manage" }]), "department_required"),
        (json!([{ "permission": "member.view", "department": "IT" }]), "invalid_department"),
    ];
    for (grants, code) in cases {
        assert_status(&set(grants).await, StatusCode::UNPROCESSABLE_ENTITY, Some(code));
    }

    // Admins are notified; the acting admin is not.
    let admin2 = create_user(&app.db, NewUser::member("admin2@example.com", PW)).await;
    add_member(&app.db, org.branch_a, admin2).await;
    sqlx::query!("UPDATE branch_membership SET is_admin = true WHERE user_id = $1", admin2)
        .execute(&app.db)
        .await
        .unwrap();
    let res = set(json!([
        { "permission": "member.manage" },
        { "permission": "issue.edit", "issue_type": "ticket" },
        { "permission": "issue.edit", "issue_type": "ticket" },
    ]))
    .await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["grants"].as_array().unwrap().len(), 2, "duplicates collapse");
    assert_eq!(notifications_of(&app.db, admin2, "permissions_changed").await, 1);
    assert_eq!(notifications_of(&app.db, org.admin_a, "permissions_changed").await, 0);
    assert_eq!(audit_count(&app.db, "permission_group_grant", "grant").await, 1);
    // Saving the same grants again changes nothing.
    assert_status(&set(res.body["grants"].clone()).await, StatusCode::OK, None);
    assert_eq!(notifications_of(&app.db, admin2, "permissions_changed").await, 1);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn school_wide_groups_are_attached_in_any_branch(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    let body = json!({ "name": "Coordinators", "grants": [{ "permission": "dashboard.branch" }] });

    assert_status(
        &call(&app, &admin, Method::POST, "/api/school-permission-groups", Some(body.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let res = call(&app, &root, Method::POST, "/api/school-permission-groups", Some(body)).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert!(res.body["branch_id"].is_null());
    let coordinators = res.body["id"].as_str().unwrap().to_owned();

    // Branch admins see it and attach it, but don't change it.
    let list =
        call(&app, &admin, Method::GET, &format!("/api/branches/{}/permission-groups", org.branch_a), None).await;
    assert!(list.body.as_array().unwrap().iter().any(|g| g["id"] == coordinators.as_str()));
    let rename = Some(json!({ "name": "Mine" }));
    assert_status(
        &call(&app, &admin, Method::PATCH, &format!("/api/permission-groups/{coordinators}"), rename).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let team_a = create_department(&app.db, org.branch_a, "Team", &[], &[org.plain_a]).await;
    let team_b = create_department(&app.db, org.branch_b, "Team", &[], &[org.multi]).await;
    let admin_b = as_user(&app, "admin_b@example.com").await;
    for (d, who) in [(team_a, &admin), (team_b, &admin_b)] {
        let uri = format!("/api/departments/{d}/permission-groups/{coordinators}");
        assert_status(&call(&app, who, Method::PUT, &uri, None).await, StatusCode::NO_CONTENT, None);
    }
    let multi = as_user(&app, "multi@example.com").await;
    let me = call(&app, &multi, Method::GET, "/api/me", None).await.body;
    assert!(has(&me, org.branch_b, "dashboard.branch"));
    assert!(!has(&me, org.branch_a, "dashboard.branch"), "multi isn't in branch A's Team");

    // A change reaches every branch using it.
    let res = call(
        &app,
        &root,
        Method::PATCH,
        &format!("/api/permission-groups/{coordinators}"),
        Some(json!({ "grants": [{ "permission": "export.run" }] })),
    )
    .await;
    assert_status(&res, StatusCode::OK, None);
    let plain = as_user(&app, "plain_a@example.com").await;
    let me = call(&app, &plain, Method::GET, "/api/me", None).await.body;
    assert!(has(&me, org.branch_a, "export.run") && !has(&me, org.branch_a, "dashboard.branch"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn everyone_applies_to_every_user_in_every_branch(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let plain = as_user(&app, "plain_a@example.com").await;

    let list = call(&app, &root, Method::GET, "/api/school-permission-groups", None).await;
    let everyone = &list.body.as_array().unwrap()[0];
    assert_eq!(everyone["is_default"], true, "Everyone comes first");
    assert_eq!(everyone["name"], "Everyone");
    let id = everyone["id"].as_str().unwrap().to_owned();
    let uri = format!("/api/permission-groups/{id}");

    assert!(!has(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a, "export.run"));
    let res = call(&app, &root, Method::PATCH, &uri, Some(json!({ "grants": [{ "permission": "export.run" }] }))).await;
    assert_status(&res, StatusCode::OK, None);
    assert!(has(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a, "export.run"));
    let multi = as_user(&app, "multi@example.com").await;
    let me = call(&app, &multi, Method::GET, "/api/me", None).await.body;
    assert!(has(&me, org.branch_a, "export.run") && has(&me, org.branch_b, "export.run"), "in every branch");
    let why = call(
        &app,
        &root,
        Method::GET,
        &format!("/api/branches/{}/members/{}/effective-permissions", org.branch_b, org.multi),
        None,
    )
    .await;
    let grants = why.body["grants"].as_array().unwrap();
    let from_everyone = grants.iter().find(|g| g["permission_group"]["name"] == "Everyone");
    assert!(from_everyone.is_some_and(|g| g["department"].is_null()));

    // Branch admins can't touch it; it isn't attached, renamed or deleted.
    let admin = as_user(&app, "admin_a@example.com").await;
    let grants = Some(json!({ "grants": [] }));
    assert_status(&call(&app, &admin, Method::PATCH, &uri, grants).await, StatusCode::FORBIDDEN, None);
    let all_members =
        sqlx::query_scalar!("SELECT id FROM department WHERE branch_id = $1 AND is_default", org.branch_a)
            .fetch_one(&app.db)
            .await
            .unwrap();
    let attach = format!("/api/departments/{all_members}/permission-groups/{id}");
    assert_status(&call(&app, &admin, Method::PUT, &attach, None).await, StatusCode::CONFLICT, Some("default_group"));
    let res = call(&app, &root, Method::PATCH, &uri, Some(json!({ "name": "All" }))).await;
    assert_status(&res, StatusCode::CONFLICT, Some("default_group"));
    assert_status(&call(&app, &root, Method::DELETE, &uri, None).await, StatusCode::CONFLICT, Some("default_group"));
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn the_permission_config_exports_and_imports_as_yaml_and_json(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    create_department(&app.db, org.branch_a, "IT", &[], &[org.plain_a]).await;

    // Plain members get nothing; admins their branches; root everything.
    let plain = as_user(&app, "plain_a@example.com").await;
    assert_status(&call(&app, &plain, Method::GET, "/api/permission-config", None).await, StatusCode::FORBIDDEN, None);
    let res = app.req(Method::GET, "/api/permission-config?format=json").cookie(&admin).send().await;
    assert_status(&res, StatusCode::OK, None);
    assert_eq!(res.body["version"], 1);
    let branches: Vec<&str> =
        res.body["branches"].as_array().unwrap().iter().map(|b| b["branch"].as_str().unwrap()).collect();
    assert_eq!(branches, ["AAA"]);
    let res = app.req(Method::GET, "/api/permission-config").cookie(&root).send().await;
    let yaml = String::from_utf8(res.bytes.clone()).unwrap();
    assert!(yaml.contains("name: Managers") && yaml.contains("branch: BBB"), "{yaml}");

    // Edit it: a school-wide group, attached to IT, which gets a head.
    let doc = r#"
version: 1
permission_groups:
  - name: IT support
    statements:
      - actions: [issue.read, comment.internal]
        issue_types: [ticket]
      - actions: [department.members.manage]
        departments: [IT]
branches:
  - branch: aaa
    departments:
      - name: IT
        permission_groups: [IT support]
        heads: [plain_a@example.com]
"#;
    let import = |who: &str, dry_run: bool| {
        app.req(Method::POST, &format!("/api/permission-config?dry_run={dry_run}"))
            .cookie(who)
            .raw("application/yaml", doc.as_bytes().to_vec())
            .send()
    };
    // School-wide groups are root users' to change.
    assert_status(&import(&admin, true).await, StatusCode::FORBIDDEN, None);

    let dry = import(&root, true).await;
    assert_status(&dry, StatusCode::OK, None);
    assert_eq!(dry.body["applied"], false);
    let changes: Vec<&str> = dry.body["changes"].as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect();
    assert!(changes.iter().any(|c| c.contains("\"IT support\": created")), "{changes:?}");
    assert!(changes.iter().any(|c| c.contains("attach \"IT support\"")), "{changes:?}");
    assert!(changes.iter().any(|c| c.contains("plain_a@example.com becomes a head")), "{changes:?}");
    assert!(!has(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a, "comment.internal"));

    let done = import(&root, false).await;
    assert_status(&done, StatusCode::OK, None);
    assert_eq!(done.body["applied"], true);
    assert_eq!(done.body["changes"], dry.body["changes"], "the dry run showed exactly this");
    let me = call(&app, &plain, Method::GET, "/api/me", None).await.body;
    assert!(has(&me, org.branch_a, "comment.internal"));
    let a =
        me["memberships"].as_array().unwrap().iter().find(|m| m["branch"]["id"] == org.branch_a.to_string()).unwrap();
    assert_eq!(a["manages_members_of"], json!(["it"]));
    assert_eq!(a["heads"].as_array().unwrap().len(), 1);

    // Importing it again changes nothing; the export round-trips.
    assert_eq!(import(&root, false).await.body["changes"], json!([]));
    let again = app.req(Method::GET, "/api/permission-config?format=json").cookie(&root).send().await;
    let res = app
        .req(Method::POST, "/api/permission-config?format=json")
        .cookie(&root)
        .raw("application/json", again.bytes.clone())
        .send()
        .await;
    assert_eq!(res.body["changes"], json!([]));

    // Mistakes are named.
    let bad_doc = b"version: 1\npermission_groups:\n  - name: X\n    statements:\n      - actions: [fly]\n".to_vec();
    let bad = app
        .req(Method::POST, "/api/permission-config?dry_run=true")
        .cookie(&root)
        .raw("application/yaml", bad_doc)
        .send()
        .await;
    assert_status(&bad, StatusCode::UNPROCESSABLE_ENTITY, Some("invalid_config"));
    assert!(bad.body["error"]["message"].as_str().unwrap().contains("fly"), "{}", bad.body);
}
