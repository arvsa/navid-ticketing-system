//! The SQL list filter (`issue_visible`) and `policy::can_read` must agree
//! for every actor and issue (section 6.6, item 2). Phase 3 extends the
//! fixture into the full authorization matrix.

mod common;

use std::collections::BTreeSet;

use backend::{
    authz::{policy::can_read, relations, Actor, IssueFilter},
    db::MIGRATOR,
};
use common::*;
use sqlx::PgPool;
use uuid::Uuid;

struct NewIssue<'a> {
    branch: Option<Uuid>,
    ty: &'a str,
    private: bool,
    by: Uuid,
    super_issue: bool,
}

async fn issue(db: &PgPool, i: NewIssue<'_>) -> Uuid {
    sqlx::query_scalar!(
        r#"INSERT INTO issue (branch_id, type_id, title, is_private, created_by, requires_super_admin_approval)
           VALUES ($1, (SELECT id FROM issue_type WHERE code = $2), 'T', $3, $4, $5) RETURNING id"#,
        i.branch,
        i.ty,
        i.private,
        i.by,
        i.super_issue
    )
    .fetch_one(db)
    .await
    .unwrap()
}

async fn target(db: &PgPool, issue: Uuid, branch: Uuid, user: Option<Uuid>, group: Option<Uuid>) -> Uuid {
    let kind = match (user, group) {
        (Some(_), _) => "user",
        (_, Some(_)) => "group",
        _ => "branch",
    };
    sqlx::query_scalar!(
        r#"INSERT INTO issue_target (issue_id, branch_id, kind, user_id, group_id)
           VALUES ($1, $2, $3::text::target_kind, $4, $5) RETURNING id"#,
        issue,
        branch,
        kind,
        user,
        group
    )
    .fetch_one(db)
    .await
    .unwrap()
}

async fn load_actor(db: &PgPool, user: Uuid) -> Actor {
    let is_super =
        sqlx::query_scalar!("SELECT is_super_admin FROM app_user WHERE id = $1", user).fetch_one(db).await.unwrap();
    Actor::load(db, user, is_super).await.unwrap()
}

async fn visible_by_filter(db: &PgPool, actor: &Actor) -> BTreeSet<Uuid> {
    let filter = IssueFilter::for_actor(actor).into_json();
    sqlx::query_scalar!(
        "SELECT i.id FROM issue i WHERE issue_visible(i.id, i.branch_id, i.type_id, i.is_private, i.created_by, $1)",
        filter
    )
    .fetch_all(db)
    .await
    .unwrap()
    .into_iter()
    .collect()
}

async fn visible_by_policy(db: &PgPool, actor: &Actor) -> BTreeSet<Uuid> {
    let all = sqlx::query_scalar!("SELECT id FROM issue").fetch_all(db).await.unwrap();
    let mut out = BTreeSet::new();
    for id in all {
        let facts = relations::load_issue(db, actor, id).await.unwrap().unwrap();
        if can_read(actor, &facts) {
            out.insert(id);
        }
    }
    out
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn list_filter_and_read_decision_agree(pool: PgPool) {
    let db = &pool;
    let org = Org::seed(db).await;

    // Extra actors: a private reader, a reader limited to actions, a member
    // with no read grant at all, and a group member targeted via the group.
    let private_reader = create_user(db, NewUser::member("private_reader@example.com", PW)).await;
    let action_reader = create_user(db, NewUser::member("action_reader@example.com", PW)).await;
    let blind = create_user(db, NewUser::member("blind@example.com", PW)).await;
    let grouped = create_user(db, NewUser::member("grouped@example.com", PW)).await;
    for u in [private_reader, action_reader, blind, grouped] {
        add_member(db, org.branch_a, u).await;
    }
    create_group(db, org.branch_a, "Private readers", &[("issue.read_private", None, "branch")], &[private_reader])
        .await;
    let team = create_group(db, org.branch_a, "Team", &[], &[grouped]).await;
    // Remove the baseline from the restricted users: drop them from "All members".
    sqlx::query!(
        "DELETE FROM group_member gm USING user_group g
         WHERE g.id = gm.group_id AND g.is_default AND gm.user_id = ANY($1)",
        &[action_reader, blind][..]
    )
    .execute(db)
    .await
    .unwrap();
    create_group(db, org.branch_a, "Action readers", &[("issue.read", Some("action"), "branch")], &[action_reader])
        .await;

    let a = Some(org.branch_a);
    let b = Some(org.branch_b);
    let creators = [org.admin_a, org.plain_a, org.boss_like_a, org.manager_a];
    for by in creators {
        for ty in ["ticket", "action", "report", "event"] {
            for private in [false, true] {
                issue(db, NewIssue { branch: a, ty, private, by, super_issue: false }).await;
            }
        }
    }
    // Private issues reaching someone through a target.
    let to_user =
        issue(db, NewIssue { branch: a, ty: "ticket", private: true, by: org.admin_a, super_issue: false }).await;
    target(db, to_user, org.branch_a, Some(org.plain_a), None).await;
    let to_group =
        issue(db, NewIssue { branch: a, ty: "action", private: true, by: org.admin_a, super_issue: false }).await;
    target(db, to_group, org.branch_a, None, Some(team)).await;
    // Private, reaching someone only as an assignee.
    let assigned =
        issue(db, NewIssue { branch: a, ty: "action", private: true, by: org.admin_a, super_issue: false }).await;
    let t = target(db, assigned, org.branch_a, None, Some(org.managers_group)).await;
    sqlx::query!(
        "INSERT INTO work_item (issue_id, target_id, branch_id, assignee_id) VALUES ($1, $2, $3, $4)",
        assigned,
        t,
        org.branch_a,
        blind
    )
    .execute(db)
    .await
    .unwrap();
    // Branch B issues.
    issue(db, NewIssue { branch: b, ty: "ticket", private: false, by: org.admin_b, super_issue: false }).await;
    issue(db, NewIssue { branch: b, ty: "ticket", private: true, by: org.admin_b, super_issue: false }).await;
    // Cross-branch super admin issues: one sent to branch B, one to a group in A.
    let cross_b =
        issue(db, NewIssue { branch: None, ty: "action", private: false, by: org.root, super_issue: true }).await;
    target(db, cross_b, org.branch_b, None, None).await;
    let cross_a_group =
        issue(db, NewIssue { branch: None, ty: "ticket", private: false, by: org.root, super_issue: true }).await;
    target(db, cross_a_group, org.branch_a, None, Some(team)).await;
    let cross_private =
        issue(db, NewIssue { branch: None, ty: "ticket", private: true, by: org.root, super_issue: true }).await;
    target(db, cross_private, org.branch_a, None, Some(team)).await;

    let actors = [
        org.root,
        org.admin_a,
        org.admin_b,
        org.manager_a,
        org.boss_like_a,
        org.plain_a,
        org.multi,
        private_reader,
        action_reader,
        blind,
        grouped,
    ];
    for user in actors {
        let actor = load_actor(db, user).await;
        let by_filter = visible_by_filter(db, &actor).await;
        let by_policy = visible_by_policy(db, &actor).await;
        assert_eq!(by_filter, by_policy, "filter and policy disagree for user {user}");
    }

    // Spot checks that the fixture exercises the interesting cases.
    let total = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM issue"#).fetch_one(db).await.unwrap() as usize;
    let seen = |u: Uuid| async move { visible_by_filter(db, &load_actor(db, u).await).await };
    assert_eq!(seen(org.root).await.len(), total);
    let plain = seen(org.plain_a).await;
    assert!(plain.contains(&to_user), "a targeted user sees the private issue");
    assert!(!plain.contains(&to_group));
    assert!(seen(grouped).await.contains(&to_group), "group targets reach current members");
    assert!(seen(grouped).await.contains(&cross_private), "targeted members see private cross-branch issues");
    assert!(seen(blind).await.contains(&assigned), "assignees see the issue");
    assert!(!seen(blind).await.contains(&to_user));
    assert!(seen(org.multi).await.contains(&cross_b), "branch targets reach every member");
    assert!(!seen(org.admin_a).await.contains(&cross_b), "admin of A doesn't see an issue sent only to B");
    assert!(seen(org.admin_a).await.contains(&cross_private), "admins of a targeted branch see it");
    let action_only = seen(action_reader).await;
    assert!(!action_only.is_empty());
    assert!(!plain.is_empty() && plain.len() < total);
}
