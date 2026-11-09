//! School-wide groups (templates copied into every branch) and saving
//! several grants at once.

mod common;

use axum::http::{Method, StatusCode};
use backend::db::MIGRATOR;
use common::*;
use serde_json::json;
use sqlx::PgPool;

#[sqlx::test(migrator = "MIGRATOR")]
async fn school_wide_groups_are_copied_into_every_branch(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let admin = as_user(&app, "admin_a@example.com").await;
    // Branch A already has its own Coordinators group: it gets adopted.
    let own = create_group(&app.db, org.branch_a, "Coordinators", &[], &[org.plain_a]).await;

    // Super admins only, and never named like the default group.
    let new = json!({ "name": "Coordinators" });
    assert_status(
        &call(&app, &admin, Method::POST, "/api/school-groups", Some(new.clone())).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let taken = json!({ "name": "All Members" });
    assert_status(
        &call(&app, &root, Method::POST, "/api/school-groups", Some(taken)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("reserved_group_name"),
    );
    let res = call(&app, &root, Method::POST, "/api/school-groups", Some(new.clone())).await;
    assert_status(&res, StatusCode::CREATED, None);
    assert!(res.body["branch_id"].is_null());
    let template = res.body["id"].as_str().unwrap().to_owned();
    assert_eq!(res.body["member_count"], 1, "counts the members of its copies");
    assert_status(
        &call(&app, &root, Method::POST, "/api/school-groups", Some(new)).await,
        StatusCode::CONFLICT,
        Some("group_name_taken"),
    );

    // One copy per branch: A's own group, and a new one in B.
    let copies = call(&app, &root, Method::GET, &format!("/api/school-groups/{template}/copies"), None).await;
    assert_status(&copies, StatusCode::OK, None);
    let copies = copies.body.as_array().unwrap().clone();
    assert_eq!(copies.len(), 2);
    assert!(copies.iter().all(|c| c["template_id"] == template.as_str()));
    let copy_a = copies.iter().find(|c| c["branch_id"] == org.branch_a.to_string()).unwrap();
    assert_eq!(copy_a["id"], own.to_string(), "adopted, members kept");
    let copy_b =
        copies.iter().find(|c| c["branch_id"] == org.branch_b.to_string()).unwrap()["id"].as_str().unwrap().to_owned();

    // The school-wide group has no members; branch admins fill their copy.
    let add = format!("/api/groups/{template}/members/{}", org.multi);
    assert_status(
        &call(&app, &root, Method::PUT, &add, None).await,
        StatusCode::CONFLICT,
        Some("school_group_has_no_members"),
    );
    let admin_b = as_user(&app, "admin_b@example.com").await;
    let add_b = format!("/api/groups/{copy_b}/members/{}", org.multi);
    assert_status(&call(&app, &admin_b, Method::PUT, &add_b, None).await, StatusCode::NO_CONTENT, None);
    // ...but can't change what the copy is.
    let rename = Some(json!({ "name": "Mine" }));
    assert_status(
        &call(&app, &admin_b, Method::PATCH, &format!("/api/groups/{copy_b}"), rename).await,
        StatusCode::CONFLICT,
        Some("managed_by_template"),
    );
    let grant = Some(json!({ "grant": [{ "permission": "export.run", "issue_type": null, "scope": "branch" }] }));
    assert_status(
        &call(&app, &admin_b, Method::PUT, &format!("/api/groups/{copy_b}/permissions"), grant).await,
        StatusCode::CONFLICT,
        Some("managed_by_template"),
    );

    // Grants set once reach every copy; each branch's admins are told once.
    let changes = json!({ "grant": [
        { "permission": "dashboard.branch", "issue_type": null, "scope": "branch" },
        { "permission": "export.run", "issue_type": null, "scope": "branch" },
    ] });
    let saved = call(&app, &root, Method::PUT, &format!("/api/groups/{template}/permissions"), Some(changes)).await;
    assert_status(&saved, StatusCode::OK, None);
    for copy in [own.to_string(), copy_b.clone()] {
        let grants = call(&app, &root, Method::GET, &format!("/api/groups/{copy}/permissions"), None).await;
        assert_eq!(grants.body["items"].as_array().unwrap().len(), 2, "copy {copy} follows the template");
    }
    assert_eq!(notifications_of(&app.db, org.admin_a, "permissions_changed").await, 1);
    assert_eq!(
        notifications_of(&app.db, org.admin_b, "permissions_changed").await,
        1,
        "they added the member themselves"
    );
    let eff = call(
        &app,
        &admin_b,
        Method::GET,
        &format!("/api/branches/{}/members/{}/effective-permissions", org.branch_b, org.multi),
        None,
    )
    .await;
    assert_eq!(
        eff.body["grants"].as_array().unwrap().iter().filter(|g| g["group"]["id"] == copy_b.as_str()).count(),
        2
    );

    // A new branch starts with a copy, grants included.
    let new_branch = create_branch(&app.db, "CCC", org.admin_a).await;
    let copies = call(&app, &root, Method::GET, &format!("/api/school-groups/{template}/copies"), None).await;
    let copy_c = copies
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["branch_id"] == new_branch.to_string())
        .expect("copied into the new branch")["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let grants = call(&app, &root, Method::GET, &format!("/api/groups/{copy_c}/permissions"), None).await;
    assert_eq!(grants.body["items"].as_array().unwrap().len(), 2);

    // Renaming carries over; deleting leaves ordinary branch groups behind.
    let rename = Some(json!({ "name": "Year coordinators" }));
    assert_status(
        &call(&app, &root, Method::PATCH, &format!("/api/groups/{template}"), rename).await,
        StatusCode::OK,
        None,
    );
    let groups_b = call(&app, &admin_b, Method::GET, &format!("/api/branches/{}/groups", org.branch_b), None).await;
    assert!(groups_b.body["items"].as_array().unwrap().iter().any(|g| g["name"] == "Year coordinators"));
    assert_status(
        &call(&app, &root, Method::DELETE, &format!("/api/groups/{template}"), None).await,
        StatusCode::OK,
        None,
    );
    let rename = Some(json!({ "name": "Ours now" }));
    assert_status(
        &call(&app, &admin_b, Method::PATCH, &format!("/api/groups/{copy_b}"), rename).await,
        StatusCode::OK,
        None,
    );
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn saving_several_grants_tells_admins_once(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let url = format!("/api/groups/{}/permissions", org.managers_group);
    let current = call(&app, &root, Method::GET, &url, None).await;
    let old = current.body["items"][0]["id"].as_str().unwrap().to_owned();

    let changes = json!({
        "revoke": [old],
        "grant": [
            { "permission": "dashboard.branch", "issue_type": null, "scope": "branch" },
            { "permission": "export.run", "issue_type": null, "scope": "branch" },
            { "permission": "issue.close", "issue_type": "ticket", "scope": "branch" },
        ],
    });
    let saved = call(&app, &root, Method::PUT, &url, Some(changes)).await;
    assert_status(&saved, StatusCode::OK, None);
    assert_eq!(saved.body.as_array().unwrap().len(), 3);
    assert_eq!(notifications_of(&app.db, org.admin_a, "permissions_changed").await, 1);
    assert_eq!(audit_count(&app.db, "group_permission", "grant").await, 3);
    assert_eq!(audit_count(&app.db, "group_permission", "revoke").await, 1);

    // All or nothing: a bad grant keeps everything as it was.
    let bad = json!({ "grant": [
        { "permission": "export.run", "issue_type": null, "scope": "branch" },
    ] });
    assert_status(&call(&app, &root, Method::PUT, &url, Some(bad)).await, StatusCode::CONFLICT, Some("grant_exists"));
    let after = call(&app, &root, Method::GET, &url, None).await;
    assert_eq!(after.body["items"].as_array().unwrap().len(), 3);
    // Someone else's grant id is not found.
    let other = json!({ "revoke": [uuid::Uuid::new_v4()] });
    assert_status(&call(&app, &root, Method::PUT, &url, Some(other)).await, StatusCode::NOT_FOUND, None);
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn everyone_grants_apply_to_every_user_in_every_branch(pool: PgPool) {
    let app = TestApp::new(pool);
    let org = Org::seed(&app.db).await;
    let root = as_root(&app).await;
    let plain = as_user(&app, "plain_a@example.com").await;

    let list = call(&app, &root, Method::GET, "/api/school-groups", None).await;
    let everyone = &list.body.as_array().unwrap()[0];
    assert_eq!(everyone["is_default"], true, "Everyone comes first");
    assert_eq!(everyone["name"], "Everyone");
    let id = everyone["id"].as_str().unwrap().to_owned();

    // Plain members can't export until Everyone may.
    let can_export = |me: &serde_json::Value, branch: uuid::Uuid| {
        me["memberships"].as_array().unwrap().iter().find(|m| m["branch"]["id"] == branch.to_string()).unwrap()
            ["grants"]
            .as_array()
            .unwrap()
            .iter()
            .any(|g| g["permission"] == "export.run")
    };
    assert!(!can_export(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a));
    let res = call(
        &app,
        &root,
        Method::POST,
        &format!("/api/groups/{id}/permissions"),
        Some(json!({ "permission": "export.run", "scope": "branch" })),
    )
    .await;
    assert_status(&res, StatusCode::CREATED, None);
    assert!(can_export(&call(&app, &plain, Method::GET, "/api/me", None).await.body, org.branch_a));
    let multi = as_user(&app, "multi@example.com").await;
    let me = call(&app, &multi, Method::GET, "/api/me", None).await.body;
    assert!(can_export(&me, org.branch_a) && can_export(&me, org.branch_b), "in every branch");
    let why = call(
        &app,
        &root,
        Method::GET,
        &format!("/api/branches/{}/members/{}/effective-permissions", org.branch_b, org.multi),
        None,
    )
    .await;
    assert!(why.body["grants"].as_array().unwrap().iter().any(|g| g["group"]["name"] == "Everyone"));

    // Branch admins can't touch it; it has no members, no copies, and stays put.
    let admin = as_user(&app, "admin_a@example.com").await;
    let grant = Some(json!({ "permission": "member.view", "scope": "branch" }));
    assert_status(
        &call(&app, &admin, Method::POST, &format!("/api/groups/{id}/permissions"), grant).await,
        StatusCode::FORBIDDEN,
        None,
    );
    let res = call(&app, &root, Method::PUT, &format!("/api/groups/{id}/members/{}", org.plain_a), None).await;
    assert_status(&res, StatusCode::CONFLICT, Some("default_group"));
    let res = call(&app, &root, Method::PATCH, &format!("/api/groups/{id}"), Some(json!({ "archived": true }))).await;
    assert_status(&res, StatusCode::CONFLICT, Some("default_group"));
    assert_status(
        &call(&app, &root, Method::DELETE, &format!("/api/groups/{id}"), None).await,
        StatusCode::CONFLICT,
        None,
    );
    let new_branch = create_branch(&app.db, "CCC", org.admin_a).await;
    let copies = call(&app, &root, Method::GET, &format!("/api/school-groups/{id}/copies"), None).await;
    assert!(copies.body.as_array().unwrap().is_empty());
    let names = call(&app, &root, Method::GET, &format!("/api/branches/{new_branch}/groups"), None).await;
    assert!(!names.body["items"].as_array().unwrap().iter().any(|g| g["name"] == "Everyone"));

    let taken = json!({ "name": "everyone" });
    assert_status(
        &call(&app, &root, Method::POST, "/api/school-groups", Some(taken)).await,
        StatusCode::UNPROCESSABLE_ENTITY,
        Some("reserved_group_name"),
    );
}
