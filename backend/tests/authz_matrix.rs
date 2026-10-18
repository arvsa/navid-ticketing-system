//! Section 6.6: the authorization matrix.
//!
//! Fixture: a super admin; branches A and B, each with an admin, a plain
//! member and a member of an admin-like group; a member who is admin in A
//! and plain in B; single-grant actors for every row of the 6.1 table; and
//! issues of every type, private and public, created by each role,
//! including a cross-branch super admin issue.
//!
//! 1. `matrix`: a table of (actor, action, resource, expected) rows run
//!    through `relations` + `policy::authorize` on the real database.
//! 2. `list_matches_read_decisions`: for every actor, `GET /api/issues`
//!    returns exactly the issues `authorize(Read)` allows.
//! 3. `revocation_is_instant`: group removal and leaving a branch take
//!    effect on the next request.

mod common;

use std::collections::{BTreeSet, HashMap};

use axum::http::{Method, StatusCode};
use backend::{
    authz::{authorize, relations, Action, Actor, AuthzError, IssueType},
    db::MIGRATOR,
};
use common::*;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

const TYPES: [&str; 4] = ["ticket", "report", "event", "action"];

/// Grants for the single-grant actors in branch A: (name, permission, type, scope).
/// Each also gets `issue.read @branch` unless the row is about reading, so a
/// missing read doesn't mask the permission under test.
const GRANTEES: &[(&str, &str, Option<&str>, &str)] = &[
    ("g_read_branch", "issue.read", None, "branch"),
    ("g_read_ticket", "issue.read", Some("ticket"), "branch"),
    ("g_read_own", "issue.read", None, "own"),
    ("g_read_targeted", "issue.read", None, "targeted"),
    ("g_read_private", "issue.read_private", None, "branch"),
    ("g_read_private_action", "issue.read_private", Some("action"), "branch"),
    ("g_create_action", "issue.create", Some("action"), "branch"),
    ("g_edit_own", "issue.edit", None, "own"),
    ("g_edit_branch", "issue.edit", None, "branch"),
    ("g_edit_ticket", "issue.edit", Some("ticket"), "branch"),
    ("g_close_own", "issue.close", None, "own"),
    ("g_close_branch", "issue.close", None, "branch"),
    ("g_private_own", "issue.set_private", None, "own"),
    ("g_private_branch", "issue.set_private", None, "branch"),
    ("g_target_own", "issue.target", None, "own"),
    ("g_target_branch", "issue.target", None, "branch"),
    ("g_update_targeted", "work_item.update", None, "targeted"),
    ("g_update_branch", "work_item.update", None, "branch"),
    ("g_assign_targeted", "work_item.assign", None, "targeted"),
    ("g_assign_branch", "work_item.assign", None, "branch"),
    ("g_approve", "work_item.approve", None, "branch"),
    ("g_approve_report", "work_item.approve", Some("report"), "branch"),
    ("g_comment_targeted", "comment.create", None, "targeted"),
    ("g_comment_branch", "comment.create", None, "branch"),
    ("g_internal", "comment.internal", None, "branch"),
    ("g_moderate", "comment.moderate", None, "branch"),
    ("g_member_view", "member.view", None, "branch"),
    ("g_member_manage", "member.manage", None, "branch"),
    ("g_dashboard", "dashboard.branch", None, "branch"),
    ("g_export", "export.run", None, "branch"),
];

struct Fixture {
    db: PgPool,
    users: HashMap<String, Uuid>,
    branches: HashMap<&'static str, Uuid>,
    issues: HashMap<String, Uuid>,
    items: HashMap<&'static str, Uuid>,
}

impl Fixture {
    fn user(&self, name: &str) -> Uuid {
        *self.users.get(name).unwrap_or_else(|| panic!("no user {name}"))
    }

    fn issue(&self, name: &str) -> Uuid {
        *self.issues.get(name).unwrap_or_else(|| panic!("no issue {name}"))
    }

    async fn actor(&self, name: &str) -> Actor {
        let id = self.user(name);
        let is_super = sqlx::query_scalar!("SELECT is_super_admin FROM app_user WHERE id = $1", id)
            .fetch_one(&self.db)
            .await
            .unwrap();
        Actor::load(&self.db, id, is_super).await.unwrap()
    }
}

async fn insert_issue(db: &PgPool, branch: Option<Uuid>, ty: &str, private: bool, by: Uuid, super_issue: bool) -> Uuid {
    sqlx::query_scalar!(
        r#"INSERT INTO issue (branch_id, type_id, title, is_private, created_by, requires_super_admin_approval)
           VALUES ($1, (SELECT id FROM issue_type WHERE code = $2), 'Matrix', $3, $4, $5) RETURNING id"#,
        branch,
        ty,
        private,
        by,
        super_issue
    )
    .fetch_one(db)
    .await
    .unwrap()
}

/// Adds a target and, for a user target, an assigned work item; for a
/// group or branch target, an unassigned one. Returns the work item.
async fn target_with_item(db: &PgPool, issue: Uuid, branch: Uuid, user: Option<Uuid>, group: Option<Uuid>) -> Uuid {
    let kind = match (user, group) {
        (Some(_), _) => "user",
        (_, Some(_)) => "group",
        _ => "branch",
    };
    let target = sqlx::query_scalar!(
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
    .unwrap();
    sqlx::query_scalar!(
        "INSERT INTO work_item (issue_id, target_id, branch_id, assignee_id) VALUES ($1, $2, $3, $4) RETURNING id",
        issue,
        target,
        branch,
        user
    )
    .fetch_one(db)
    .await
    .unwrap()
}

async fn seed(db: &PgPool) -> Fixture {
    let mut users = HashMap::new();
    users.insert("root".to_owned(), create_root(db).await);
    for name in ["admin_a", "plain_a", "deputy_a", "admin_b", "plain_b", "deputy_b", "multi"] {
        let email = format!("{name}@example.com");
        users.insert(name.to_owned(), create_user(db, NewUser::member(&email, PW)).await);
    }
    let u = |users: &HashMap<String, Uuid>, n: &str| users[n];
    let a = create_branch(db, "AAA", u(&users, "admin_a")).await;
    let b = create_branch(db, "BBB", u(&users, "admin_b")).await;
    for n in ["plain_a", "deputy_a", "multi"] {
        add_member(db, a, u(&users, n)).await;
    }
    for n in ["plain_b", "deputy_b", "multi"] {
        add_member(db, b, u(&users, n)).await;
    }
    sqlx::query!(
        "UPDATE branch_membership SET is_admin = true WHERE user_id = $1 AND branch_id = $2",
        u(&users, "multi"),
        a
    )
    .execute(db)
    .await
    .unwrap();
    create_group(db, a, "Deputies", EVERYTHING, &[u(&users, "deputy_a")]).await;
    create_group(db, b, "Deputies", EVERYTHING, &[u(&users, "deputy_b")]).await;

    // Single-grant actors in A: only their grants, not the baseline.
    for (name, perm, ty, scope) in GRANTEES {
        let email = format!("{name}@example.com");
        let id = create_user(db, NewUser::member(&email, PW)).await;
        add_member(db, a, id).await;
        sqlx::query!(
            "DELETE FROM group_member gm USING user_group g WHERE g.id = gm.group_id AND g.is_default AND gm.user_id = $1",
            id
        )
        .execute(db)
        .await
        .unwrap();
        let mut grants = vec![(*perm, *ty, *scope)];
        if !name.starts_with("g_read") {
            grants.push(("issue.read", None, "branch"));
        }
        create_group(db, a, &format!("only {name}"), &grants, &[id]).await;
        users.insert((*name).to_owned(), id);
    }
    let team = create_group(
        db,
        a,
        "Team",
        &[],
        &[u(&users, "plain_a"), u(&users, "g_assign_targeted"), u(&users, "g_update_targeted")],
    )
    .await;

    // Issues of every type, private and public, created by each role.
    let mut issues = HashMap::new();
    for creator in ["admin_a", "plain_a", "deputy_a", "admin_b", "plain_b", "deputy_b"] {
        let branch = if creator.ends_with("_a") { a } else { b };
        for ty in TYPES {
            for private in [false, true] {
                let vis = if private { "priv" } else { "pub" };
                let id = insert_issue(db, Some(branch), ty, private, u(&users, creator), false).await;
                issues.insert(format!("{vis}_{ty}_{creator}"), id);
            }
        }
    }
    // Issues owned by the own-scope grantees.
    for name in ["g_read_own", "g_edit_own", "g_close_own", "g_private_own", "g_target_own"] {
        let id = insert_issue(db, Some(a), "action", true, u(&users, name), false).await;
        issues.insert(format!("own_{name}"), id);
    }

    let mut items = HashMap::new();
    // Private action for plain_a: targeted through a user target / assignee.
    let id = insert_issue(db, Some(a), "action", true, u(&users, "admin_a"), false).await;
    items.insert("wi_plain_a", target_with_item(db, id, a, Some(u(&users, "plain_a")), None).await);
    issues.insert("priv_action_for_plain_a".to_owned(), id);
    // Shared group work, unassigned and claimable by Team members.
    let id = insert_issue(db, Some(a), "action", false, u(&users, "admin_a"), false).await;
    items.insert("wi_shared", target_with_item(db, id, a, None, Some(team)).await);
    issues.insert("pub_action_team".to_owned(), id);
    // Work assigned to the targeted-scope grantees, and to approvers themselves.
    for (key, who) in [
        ("wi_g_update_targeted", "g_update_targeted"),
        ("wi_g_approve", "g_approve"),
        ("wi_admin_a", "admin_a"),
        ("wi_deputy_a", "deputy_a"),
    ] {
        let id = insert_issue(db, Some(a), "action", false, u(&users, "plain_a"), false).await;
        items.insert(key, target_with_item(db, id, a, Some(u(&users, who)), None).await);
    }
    let report = insert_issue(db, Some(a), "report", false, u(&users, "admin_a"), false).await;
    items.insert("wi_report", target_with_item(db, report, a, Some(u(&users, "plain_a")), None).await);
    // A ticket addressed to the targeted-comment grantee.
    let id = insert_issue(db, Some(a), "ticket", false, u(&users, "admin_a"), false).await;
    sqlx::query!(
        "INSERT INTO issue_target (issue_id, branch_id, kind, user_id) VALUES ($1, $2, 'user', $3)",
        id,
        a,
        u(&users, "g_comment_targeted")
    )
    .execute(db)
    .await
    .unwrap();
    issues.insert("ticket_to_g_comment_targeted".to_owned(), id);
    // A super admin issue in A, with work for plain_a.
    let id = insert_issue(db, Some(a), "action", false, u(&users, "root"), true).await;
    items.insert("wi_sa", target_with_item(db, id, a, Some(u(&users, "plain_a")), None).await);
    issues.insert("sa_action_a".to_owned(), id);
    // A cross-branch super admin issue sent to both branches, and a private one to B only.
    let id = insert_issue(db, None, "action", false, u(&users, "root"), true).await;
    items.insert("wi_cross_a", target_with_item(db, id, a, None, None).await);
    items.insert("wi_cross_b", target_with_item(db, id, b, None, None).await);
    issues.insert("cross".to_owned(), id);
    let id = insert_issue(db, None, "ticket", true, u(&users, "root"), true).await;
    target_with_item(db, id, b, None, None).await;
    issues.insert("cross_private_b".to_owned(), id);

    let mut branches = HashMap::new();
    branches.insert("A", a);
    branches.insert("B", b);
    Fixture { db: db.clone(), users, branches, issues, items }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Expect {
    Allow,
    Forbidden,
    NotFound,
}
use Expect::*;

/// Evaluates one matrix row.
async fn check(f: &Fixture, who: &str, act: &str, res: &str) -> Result<(), AuthzError> {
    let actor = f.actor(who).await;
    let db = &f.db;
    let branch = |name: &str| f.branches.get(name).copied();

    if let Some(ty) = act.strip_prefix("create:") {
        let issue_type = IssueType::from_code(ty).unwrap();
        let (branch_id, targets_whole_branches) = match res {
            "cross" => (None, true),
            "A+branch" => (branch("A"), true),
            other => (branch(other), false),
        };
        return authorize(&actor, Action::CreateIssue { branch_id, issue_type, targets_whole_branches });
    }
    if let Some(&item_id) = f.items.get(res) {
        let item = relations::load_work_item(db, &actor, item_id).await.unwrap().unwrap();
        let item = &item;
        let action = match act {
            "update" => Action::UpdateWorkItem { item },
            "claim" => Action::ClaimWorkItem { item },
            "assign" => Action::AssignWorkItem { item },
            "approve" => Action::ApproveWorkItem { item },
            "cancel" => Action::CancelWorkItem { item },
            "read" => Action::ReadIssue { issue: &item.issue },
            other => panic!("unknown work item action {other}"),
        };
        return authorize(&actor, action);
    }
    if let Some(&issue_id) = f.issues.get(res) {
        let issue = relations::load_issue(db, &actor, issue_id).await.unwrap().unwrap();
        let issue = &issue;
        let action = match act {
            "read" => Action::ReadIssue { issue },
            "edit" => Action::EditIssue { issue },
            "close" => Action::CloseIssue { issue },
            "private" => Action::SetIssuePrivate { issue },
            "target" => Action::TargetIssue { issue, whole_branch: false },
            "target_branch" => Action::TargetIssue { issue, whole_branch: true },
            "comment" => Action::CommentOnIssue { issue },
            "internal" => Action::InternalComments { issue },
            "moderate" => Action::ModerateComments { issue },
            other => panic!("unknown issue action {other}"),
        };
        return authorize(&actor, action);
    }
    if let Some(branch_id) = branch(res) {
        let action = match act {
            "dashboard" => Action::ViewBranchDashboard { branch_id },
            "manage_groups" => Action::ManageGroups { branch_id },
            "view_members" => Action::ViewMembers { branch_id },
            "reactivate" => Action::ReactivateMember { branch_id },
            "edit_branch" => Action::EditBranch { branch_id },
            "set_admin" => Action::SetBranchAdmin { branch_id },
            "view_branch" => Action::ViewBranch { branch_id },
            "export" => return authorize(&actor, Action::Export { branch_ids: &[branch_id] }),
            other => panic!("unknown branch action {other}"),
        };
        return authorize(&actor, action);
    }
    match (act, res) {
        ("export", "A+B") => authorize(&actor, Action::Export { branch_ids: &[f.branches["A"], f.branches["B"]] }),
        ("create_branch", "-") => authorize(&actor, Action::CreateBranch),
        ("set_super_admin", "-") => authorize(&actor, Action::SetSuperAdmin),
        (act, user) if f.users.contains_key(user) => {
            let target = relations::load_user(db, f.user(user)).await.unwrap().unwrap();
            let target = &target;
            let a = f.branches["A"];
            let action = match act {
                "edit_member" => Action::EditMember { branch_id: a, target },
                "remove_member" => Action::RemoveMember { branch_id: a, target },
                "reset_password" => Action::ResetPassword { target },
                "set_active" => Action::SetUserActive { target },
                other => panic!("unknown member action {other}"),
            };
            authorize(&actor, action)
        }
        other => panic!("unknown row {other:?}"),
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn matrix(pool: PgPool) {
    let f = seed(&pool).await;

    #[rustfmt::skip]
    let rows: &[(&str, &str, &str, Expect)] = &[
        // ---- 6.1 issue.read: own, targeted, branch; private excluded at branch scope ----
        ("g_read_branch", "read", "pub_ticket_plain_a", Allow),
        ("g_read_branch", "read", "pub_action_admin_a", Allow),
        ("g_read_branch", "read", "priv_ticket_plain_a", NotFound),
        ("g_read_branch", "read", "pub_ticket_plain_b", NotFound),
        ("g_read_ticket", "read", "pub_ticket_admin_a", Allow),
        ("g_read_ticket", "read", "pub_report_admin_a", NotFound),
        ("g_read_own", "read", "own_g_read_own", Allow),
        ("g_read_own", "read", "pub_ticket_plain_a", NotFound),
        ("g_read_targeted", "read", "pub_ticket_plain_a", NotFound),
        ("plain_a", "read", "priv_action_for_plain_a", Allow),
        ("plain_a", "read", "pub_action_team", Allow),
        // ---- issue.read_private ----
        ("g_read_private", "read", "priv_ticket_plain_a", Allow),
        ("g_read_private", "read", "priv_event_deputy_a", Allow),
        ("g_read_private", "read", "priv_ticket_plain_b", NotFound),
        ("g_read_private_action", "read", "priv_action_admin_a", Allow),
        ("g_read_private_action", "read", "priv_report_admin_a", NotFound),
        // ---- issue.create (per type, branch scope) ----
        ("g_create_action", "create:action", "A", Allow),
        ("g_create_action", "create:ticket", "A", Forbidden),
        ("g_create_action", "create:action", "B", NotFound),
        ("plain_a", "create:ticket", "A", Allow),
        ("plain_a", "create:report", "A", Allow),
        ("plain_a", "create:event", "A", Allow),
        ("plain_a", "create:action", "A", Forbidden),
        ("deputy_a", "create:action", "A", Allow),
        // ---- issue.edit: own, branch, per type ----
        ("g_edit_own", "edit", "own_g_edit_own", Allow),
        ("g_edit_own", "edit", "pub_action_plain_a", Forbidden),
        ("g_edit_branch", "edit", "pub_action_plain_a", Allow),
        ("g_edit_branch", "edit", "priv_action_plain_a", NotFound),
        ("g_edit_ticket", "edit", "pub_ticket_plain_a", Allow),
        ("g_edit_ticket", "edit", "pub_event_plain_a", Forbidden),
        ("plain_a", "edit", "pub_report_plain_a", Allow),
        ("plain_a", "edit", "pub_report_deputy_a", Forbidden),
        // ---- issue.close: own, branch (+ creators always close tickets/reports/events) ----
        ("g_close_own", "close", "own_g_close_own", Allow),
        ("g_close_own", "close", "pub_action_plain_a", Forbidden),
        ("g_close_branch", "close", "pub_action_plain_a", Allow),
        ("g_read_branch", "close", "pub_action_plain_a", Forbidden),
        ("plain_a", "close", "pub_event_plain_a", Allow),
        ("plain_a", "close", "pub_event_admin_a", Forbidden),
        // ---- issue.set_private: own, branch ----
        ("g_private_own", "private", "own_g_private_own", Allow),
        ("g_private_own", "private", "pub_ticket_plain_a", Forbidden),
        ("g_private_branch", "private", "pub_ticket_plain_a", Allow),
        ("plain_a", "private", "pub_ticket_plain_a", Forbidden),
        // ---- issue.target: own, branch ----
        ("g_target_own", "target", "own_g_target_own", Allow),
        ("g_target_own", "target", "pub_ticket_plain_a", Forbidden),
        ("g_target_branch", "target", "pub_report_plain_a", Allow),
        ("plain_a", "target", "pub_ticket_plain_a", Allow),
        ("plain_a", "target", "pub_report_plain_a", Forbidden),
        // ---- work_item.update: targeted (assignee / member of unassigned target), branch ----
        ("g_update_targeted", "update", "wi_g_update_targeted", Allow),
        ("g_update_targeted", "update", "wi_plain_a", NotFound),
        ("g_update_targeted", "update", "wi_shared", Allow),
        ("g_update_branch", "update", "wi_g_approve", Allow),
        ("plain_a", "update", "wi_plain_a", Allow),
        ("plain_a", "update", "wi_deputy_a", Forbidden),
        // ---- work_item.assign: targeted = claim only, branch = reassign ----
        ("g_assign_targeted", "claim", "wi_shared", Allow),
        ("g_assign_targeted", "assign", "wi_shared", Forbidden),
        ("g_assign_branch", "assign", "wi_shared", Allow),
        ("g_assign_branch", "assign", "wi_deputy_a", Allow),
        ("g_read_branch", "claim", "wi_shared", Forbidden),
        // ---- work_item.approve: branch, per type ----
        ("g_approve", "approve", "wi_deputy_a", Allow),
        ("g_approve_report", "approve", "wi_report", Allow),
        ("g_approve_report", "approve", "wi_deputy_a", Forbidden),
        ("plain_a", "approve", "wi_deputy_a", Forbidden),
        // ---- comment.create: targeted (created or targeted), branch ----
        ("g_comment_targeted", "comment", "ticket_to_g_comment_targeted", Allow),
        ("g_comment_targeted", "comment", "pub_ticket_plain_a", Forbidden),
        ("g_comment_branch", "comment", "pub_ticket_plain_a", Allow),
        ("g_read_branch", "comment", "pub_ticket_plain_a", Forbidden),
        // ---- comment.internal, comment.moderate ----
        ("g_internal", "internal", "pub_ticket_plain_a", Allow),
        ("plain_a", "internal", "pub_ticket_plain_a", Forbidden),
        ("g_moderate", "moderate", "pub_ticket_plain_a", Allow),
        ("deputy_a", "moderate", "pub_ticket_plain_a", Allow),
        ("plain_a", "moderate", "pub_ticket_plain_a", Forbidden),
        // ---- member.view, member.manage, dashboard.branch, export.run ----
        ("g_member_view", "view_members", "A", Allow),
        ("g_read_branch", "view_members", "A", Forbidden),
        ("g_member_view", "view_members", "B", NotFound),
        ("g_member_manage", "edit_member", "plain_a", Allow),
        ("g_member_manage", "reset_password", "plain_a", Allow),
        ("g_member_manage", "remove_member", "plain_a", Allow),
        ("g_member_view", "edit_member", "plain_a", Forbidden),
        ("g_dashboard", "dashboard", "A", Allow),
        ("plain_a", "dashboard", "A", Forbidden),
        ("g_export", "export", "A", Allow),
        ("plain_a", "export", "A", Forbidden),

        // ---- 6.2 super admin only ----
        ("root", "create_branch", "-", Allow),
        ("admin_a", "create_branch", "-", Forbidden),
        ("root", "edit_branch", "A", Allow),
        ("admin_a", "edit_branch", "A", Forbidden),
        ("deputy_a", "edit_branch", "A", Forbidden),
        ("admin_a", "set_admin", "A", Forbidden),
        ("root", "set_admin", "A", Allow),
        ("admin_a", "set_super_admin", "-", Forbidden),
        ("root", "set_super_admin", "-", Allow),
        ("admin_a", "create:action", "cross", Forbidden),
        ("root", "create:action", "cross", Allow),
        ("admin_a", "create:action", "A+branch", Forbidden),
        ("root", "create:action", "A+branch", Allow),
        ("admin_a", "approve", "wi_sa", Forbidden),
        ("deputy_a", "approve", "wi_sa", Forbidden),
        ("root", "approve", "wi_sa", Allow),
        ("admin_a", "edit", "sa_action_a", Forbidden),
        ("admin_a", "close", "sa_action_a", Forbidden),
        ("admin_a", "target", "sa_action_a", Forbidden),
        ("admin_a", "private", "sa_action_a", Forbidden),
        ("deputy_a", "edit", "sa_action_a", Forbidden),
        ("root", "close", "sa_action_a", Allow),
        ("admin_a", "target_branch", "pub_ticket_plain_a", Forbidden),
        ("admin_a", "export", "A+B", Forbidden),
        ("multi", "export", "A+B", Forbidden),
        ("root", "export", "A+B", Allow),
        ("admin_a", "set_active", "multi", Forbidden),
        ("admin_a", "set_active", "deputy_a", Allow),
        ("root", "set_active", "multi", Allow),
        ("admin_a", "reset_password", "root", Forbidden),

        // ---- 6.2 branch admin only ----
        ("admin_a", "manage_groups", "A", Allow),
        ("deputy_a", "manage_groups", "A", Forbidden),
        ("admin_a", "manage_groups", "B", NotFound),
        ("deputy_a", "reactivate", "A", Forbidden),
        ("admin_a", "reactivate", "A", Allow),
        ("deputy_a", "edit_member", "admin_a", Forbidden),
        ("deputy_a", "edit_member", "multi", Forbidden),
        ("deputy_a", "edit_member", "plain_a", Allow),
        ("admin_a", "edit_member", "multi", Allow),

        // ---- 6.4 decision procedure ----
        // 1. super admins: everything, every branch.
        ("root", "read", "priv_ticket_plain_b", Allow),
        ("root", "manage_groups", "B", Allow),
        // 3/4. Admin of the resource's branch; nothing elsewhere.
        ("admin_a", "read", "priv_ticket_plain_a", Allow),
        ("admin_a", "edit", "priv_ticket_plain_a", Allow),
        ("admin_a", "read", "priv_ticket_plain_b", NotFound),
        ("admin_a", "read", "pub_ticket_plain_b", NotFound),
        // The multi-branch member: admin in A, plain in B; nothing carries over.
        ("multi", "edit", "priv_report_deputy_a", Allow),
        ("multi", "manage_groups", "A", Allow),
        ("multi", "manage_groups", "B", Forbidden),
        ("multi", "read", "pub_ticket_plain_b", Allow),
        ("multi", "read", "priv_ticket_plain_b", NotFound),
        ("multi", "edit", "pub_ticket_plain_b", Forbidden),
        // 4. On super admin issues, admins read, comment, assign and update.
        ("admin_a", "read", "sa_action_a", Allow),
        ("admin_a", "comment", "sa_action_a", Allow),
        ("admin_a", "assign", "wi_sa", Allow),
        ("admin_a", "update", "wi_sa", Allow),
        // Cross-branch issues use every targeted branch.
        ("admin_b", "read", "cross", Allow),
        ("plain_b", "read", "cross", Allow),
        ("deputy_a", "comment", "cross", Allow),
        ("admin_a", "read", "cross_private_b", NotFound),
        ("plain_b", "read", "cross_private_b", Allow),
        ("admin_b", "edit", "cross", Forbidden),
        ("admin_b", "assign", "wi_cross_b", Allow),
        ("admin_a", "assign", "wi_cross_b", Forbidden),
        // 6. Admin-like groups: everything grantable, nothing reserved.
        ("deputy_a", "read", "priv_ticket_plain_a", Allow),
        ("deputy_a", "edit", "priv_ticket_plain_a", Allow),
        ("deputy_a", "approve", "wi_plain_a", Allow),
        ("deputy_a", "export", "A", Allow),
        ("deputy_a", "export", "B", NotFound),
        // Extra: no self-approval, super admins included.
        ("admin_a", "approve", "wi_admin_a", Forbidden),
        ("deputy_a", "approve", "wi_deputy_a", Forbidden),
        ("g_approve", "approve", "wi_g_approve", Forbidden),
        // Extra: read precedes everything (404, not 403).
        ("plain_a", "edit", "priv_ticket_deputy_a", NotFound),
        ("plain_a", "comment", "priv_ticket_deputy_a", NotFound),
        ("plain_b", "update", "wi_plain_a", NotFound),
        // Extra: private issues readable by creator, targeted, admins, read_private, super admins.
        ("plain_a", "read", "priv_ticket_plain_a", Allow),
        ("plain_a", "read", "priv_ticket_admin_a", NotFound),
        ("deputy_b", "read", "priv_ticket_plain_a", NotFound),
        // Extra: member.manage never reaches admins, super admins or other branches.
        ("g_member_manage", "edit_member", "admin_a", Forbidden),
        ("g_member_manage", "edit_member", "multi", Forbidden),
        ("g_member_manage", "reset_password", "plain_b", NotFound),
        ("g_member_manage", "set_active", "multi", Forbidden),
        ("g_member_manage", "set_active", "g_export", Allow),
    ];

    let mut failures = Vec::new();
    for (who, act, res, expect) in rows {
        let got = match check(&f, who, act, res).await {
            Ok(()) => Allow,
            Err(AuthzError::Forbidden) => Forbidden,
            Err(AuthzError::NotFound) => NotFound,
        };
        if got != *expect {
            failures.push(format!("{who} {act} {res}: expected {expect:?}, got {got:?}"));
        }
    }
    assert!(failures.is_empty(), "{} of {} rows failed:\n{}", failures.len(), rows.len(), failures.join("\n"));
}

/// Collects every issue id from `GET /api/issues`, following cursors.
async fn listed(app: &TestApp, cookie: &str) -> BTreeSet<Uuid> {
    let mut out = BTreeSet::new();
    let mut uri = "/api/issues?limit=200".to_owned();
    loop {
        let res = call(app, cookie, Method::GET, &uri, None).await;
        assert_status(&res, StatusCode::OK, None);
        for i in res.body["items"].as_array().unwrap() {
            out.insert(i["id"].as_str().unwrap().parse().unwrap());
        }
        match res.body["next_cursor"].as_str() {
            Some(c) => uri = format!("/api/issues?limit=200&after={c}"),
            None => return out,
        }
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn list_matches_read_decisions(pool: PgPool) {
    let f = seed(&pool).await;
    let app = TestApp::new(pool);
    let all = sqlx::query_scalar!("SELECT id FROM issue").fetch_all(&f.db).await.unwrap();
    assert!(all.len() > 60, "the fixture should be substantial, has {}", all.len());

    let mut names: Vec<String> = f.users.keys().cloned().collect();
    names.sort();
    for name in names {
        let actor = f.actor(&name).await;
        let mut allowed = BTreeSet::new();
        for id in &all {
            let facts = relations::load_issue(&f.db, &actor, *id).await.unwrap().unwrap();
            if authorize(&actor, Action::ReadIssue { issue: &facts }).is_ok() {
                allowed.insert(*id);
            }
        }
        let (email, password) =
            if name == "root" { (ROOT_EMAIL.to_owned(), ROOT_PASSWORD) } else { (format!("{name}@example.com"), PW) };
        let cookie = app.session(&email, password).await;
        assert_eq!(listed(&app, &cookie).await, allowed, "list and authorize(Read) disagree for {name}");
    }
}

#[sqlx::test(migrator = "MIGRATOR")]
async fn revocation_is_instant(pool: PgPool) {
    let f = seed(&pool).await;
    let app = TestApp::new(pool);
    let deputy = app.session("deputy_a@example.com", PW).await;
    let admin = app.session("admin_a@example.com", PW).await;
    let private = f.issue("priv_ticket_plain_a");
    let uri = format!("/api/issues/{private}");

    // Through the admin-like group, deputy_a can read and edit plain_a's private ticket.
    assert_status(&call(&app, &deputy, Method::GET, &uri, None).await, StatusCode::OK, None);
    let group = sqlx::query_scalar!(
        "SELECT g.id FROM user_group g WHERE g.branch_id = $1 AND g.name = 'Deputies'",
        f.branches["A"]
    )
    .fetch_one(&f.db)
    .await
    .unwrap();
    let res =
        call(&app, &admin, Method::DELETE, &format!("/api/groups/{group}/members/{}", f.user("deputy_a")), None).await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    // Same session, next request: gone, and 404 rather than 403.
    assert_status(&call(&app, &deputy, Method::GET, &uri, None).await, StatusCode::NOT_FOUND, None);
    let res = call(&app, &deputy, Method::PATCH, &uri, Some(json!({ "version": 1, "title": "x" }))).await;
    assert_status(&res, StatusCode::NOT_FOUND, None);
    assert!(!listed(&app, &deputy).await.contains(&private));
    // Public issues are still readable through the baseline.
    let public = f.issue("pub_ticket_plain_a");
    assert_status(
        &call(&app, &deputy, Method::GET, &format!("/api/issues/{public}"), None).await,
        StatusCode::OK,
        None,
    );

    // Leaving the branch: everything there is gone, including their own
    // issues and the ones addressed to them.
    let plain = app.session("plain_a@example.com", PW).await;
    assert!(!listed(&app, &plain).await.is_empty());
    let res = call(
        &app,
        &admin,
        Method::DELETE,
        &format!("/api/branches/{}/members/{}", f.branches["A"], f.user("plain_a")),
        None,
    )
    .await;
    assert_status(&res, StatusCode::NO_CONTENT, None);
    for issue in ["pub_ticket_plain_a", "pub_ticket_deputy_a", "priv_action_for_plain_a", "pub_action_team"] {
        let id = f.issue(issue);
        assert_status(
            &call(&app, &plain, Method::GET, &format!("/api/issues/{id}"), None).await,
            StatusCode::NOT_FOUND,
            None,
        );
    }
    let item = f.items["wi_plain_a"];
    assert_status(
        &call(&app, &plain, Method::GET, &format!("/api/work-items/{item}"), None).await,
        StatusCode::NOT_FOUND,
        None,
    );
    assert!(listed(&app, &plain).await.is_empty());
}
