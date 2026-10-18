//! `authorize(actor, action)`: the decision procedure of section 6.4.
//!
//! Each [`Action`] carries the facts about its resource (loaded by
//! `relations`), so the check itself is a pure function and is unit tested
//! below. Domain functions call it; HTTP handlers never check permissions.

use uuid::Uuid;

use super::{
    relations::{IssueFacts, UserFacts, WorkItemFacts},
    Actor, BranchAccess, IssueType, Permission, Scope,
};
use crate::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthzError {
    /// Missing or not readable: never reveal which (404).
    NotFound,
    /// Visible, but this action isn't allowed (403).
    Forbidden,
}

impl From<AuthzError> for AppError {
    fn from(err: AuthzError) -> Self {
        match err {
            AuthzError::NotFound => AppError::NotFound,
            AuthzError::Forbidden => AppError::forbidden("forbidden", "you don't have permission to do this"),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub enum Action<'a> {
    // -- branches (super admin only, except viewing) ------------------------
    CreateBranch,
    /// Rename, change timezone or email, deactivate.
    EditBranch {
        branch_id: Uuid,
    },
    /// Set or clear `branch_membership.is_admin`.
    SetBranchAdmin {
        branch_id: Uuid,
    },
    /// Set or clear `app_user.is_super_admin`.
    SetSuperAdmin,
    ViewBranch {
        branch_id: Uuid,
    },

    // -- groups (admin only, except listing) ----------------------------------
    ViewGroups {
        branch_id: Uuid,
    },
    /// Create, rename, archive or delete groups; add or remove group members;
    /// grant or revoke group permissions (including the "All members" baseline).
    ManageGroups {
        branch_id: Uuid,
    },
    /// A member's effective permissions, with the group each comes from.
    ViewEffectivePermissions {
        branch_id: Uuid,
        user_id: Uuid,
    },

    // -- members ---------------------------------------------------------------
    ViewMembers {
        branch_id: Uuid,
    },
    /// Add a person by email. `existing` is their account if it exists.
    AddMember {
        branch_id: Uuid,
        existing: Option<&'a UserFacts>,
    },
    /// Clear `left_at` on a departed membership.
    ReactivateMember {
        branch_id: Uuid,
    },
    /// Edit a member's profile.
    EditMember {
        branch_id: Uuid,
        target: &'a UserFacts,
    },
    /// Set `left_at`.
    RemoveMember {
        branch_id: Uuid,
        target: &'a UserFacts,
    },
    /// Applies in any branch the target currently belongs to.
    ResetPassword {
        target: &'a UserFacts,
    },
    /// Activate or deactivate the account.
    SetUserActive {
        target: &'a UserFacts,
    },

    // -- issues ----------------------------------------------------------------
    CreateIssue {
        branch_id: Option<Uuid>,
        issue_type: IssueType,
        targets_whole_branches: bool,
    },
    ReadIssue {
        issue: &'a IssueFacts,
    },
    EditIssue {
        issue: &'a IssueFacts,
    },
    /// Close or cancel.
    CloseIssue {
        issue: &'a IssueFacts,
    },
    SetIssuePrivate {
        issue: &'a IssueFacts,
    },
    /// Add or remove a target. Whole-branch targets are super admin only.
    TargetIssue {
        issue: &'a IssueFacts,
        whole_branch: bool,
    },
    CommentOnIssue {
        issue: &'a IssueFacts,
    },
    InternalComments {
        issue: &'a IssueFacts,
    },
    ModerateComments {
        issue: &'a IssueFacts,
    },

    // -- work items --------------------------------------------------------------
    /// Start, block, unblock, submit.
    UpdateWorkItem {
        item: &'a WorkItemFacts,
    },
    /// Claim an unassigned shared item for yourself.
    ClaimWorkItem {
        item: &'a WorkItemFacts,
    },
    /// Assign or reassign to anyone.
    AssignWorkItem {
        item: &'a WorkItemFacts,
    },
    ApproveWorkItem {
        item: &'a WorkItemFacts,
    },
    /// Cancel one work item directly (closing the issue or removing the
    /// target cancels items as part of those actions instead).
    CancelWorkItem {
        item: &'a WorkItemFacts,
    },

    // -- dashboard and export ------------------------------------------------
    ViewBranchDashboard {
        branch_id: Uuid,
    },
    Export {
        branch_ids: &'a [Uuid],
    },
}

impl Action<'_> {
    /// The issue an action is on (read precedes everything for these).
    fn issue(&self) -> Option<&IssueFacts> {
        use Action::*;
        match self {
            ReadIssue { issue }
            | EditIssue { issue }
            | CloseIssue { issue }
            | SetIssuePrivate { issue }
            | TargetIssue { issue, .. }
            | CommentOnIssue { issue }
            | InternalComments { issue }
            | ModerateComments { issue } => Some(issue),
            UpdateWorkItem { item }
            | ClaimWorkItem { item }
            | AssignWorkItem { item }
            | ApproveWorkItem { item }
            | CancelWorkItem { item } => Some(&item.issue),
            _ => None,
        }
    }

    /// Section 6.2, first list: never allowed below super admin.
    fn is_super_admin_only(&self) -> bool {
        use Action::*;
        match self {
            CreateBranch | EditBranch { .. } | SetBranchAdmin { .. } | SetSuperAdmin => true,
            CreateIssue { branch_id, targets_whole_branches, .. } => branch_id.is_none() || *targets_whole_branches,
            EditIssue { issue } | CloseIssue { issue } | SetIssuePrivate { issue } => {
                issue.requires_super_admin_approval
            }
            TargetIssue { issue, whole_branch } => issue.requires_super_admin_approval || *whole_branch,
            ApproveWorkItem { item } | CancelWorkItem { item } => item.issue.requires_super_admin_approval,
            Export { branch_ids } => branch_ids.len() != 1,
            // A super admin's account is only ever touched by super admins.
            AddMember { existing: Some(target), .. } => target.is_super_admin,
            EditMember { target, .. } | RemoveMember { target, .. } | ResetPassword { target } => target.is_super_admin,
            SetUserActive { target } => {
                target.is_super_admin || target.branches.len() != 1 || target.is_admin_anywhere()
            }
            _ => false,
        }
    }

    /// Section 6.2, second list: branch admin (or super admin) only.
    fn is_admin_only(&self) -> bool {
        use Action::*;
        match self {
            ManageGroups { .. } | ReactivateMember { .. } | CancelWorkItem { .. } => true,
            // Acting on another admin's membership or profile.
            EditMember { target, .. } | RemoveMember { target, .. } | ResetPassword { target } => {
                target.is_admin_anywhere()
            }
            _ => false,
        }
    }

    /// The branches whose rules decide the action. Allowed if any allows.
    fn branches(&self) -> Vec<Uuid> {
        use Action::*;
        match self {
            CreateBranch | SetSuperAdmin => vec![],
            EditBranch { branch_id }
            | SetBranchAdmin { branch_id }
            | ViewBranch { branch_id }
            | ViewGroups { branch_id }
            | ManageGroups { branch_id }
            | ViewEffectivePermissions { branch_id, .. }
            | ViewMembers { branch_id }
            | AddMember { branch_id, .. }
            | ReactivateMember { branch_id }
            | EditMember { branch_id, .. }
            | RemoveMember { branch_id, .. }
            | ViewBranchDashboard { branch_id } => vec![*branch_id],
            ResetPassword { target } | SetUserActive { target } => target.branches.keys().copied().collect(),
            CreateIssue { branch_id, .. } => branch_id.iter().copied().collect(),
            UpdateWorkItem { item }
            | ClaimWorkItem { item }
            | AssignWorkItem { item }
            | ApproveWorkItem { item }
            | CancelWorkItem { item } => vec![item.branch_id],
            Export { branch_ids } => branch_ids.to_vec(),
            ReadIssue { issue }
            | EditIssue { issue }
            | CloseIssue { issue }
            | SetIssuePrivate { issue }
            | TargetIssue { issue, .. }
            | CommentOnIssue { issue }
            | InternalComments { issue }
            | ModerateComments { issue } => issue.branches(),
        }
    }
}

pub fn authorize(actor: &Actor, action: Action<'_>) -> Result<(), AuthzError> {
    use AuthzError::*;

    // No self-approval, for everyone, super admins included.
    if let Action::ApproveWorkItem { item } = action {
        if item.assignee_id == Some(actor.user_id) {
            return Err(Forbidden);
        }
    }

    // Read precedes everything: an unreadable issue is "not found".
    if let Some(issue) = action.issue() {
        if !can_read(actor, issue) {
            return Err(NotFound);
        }
        if matches!(action, Action::ReadIssue { .. }) {
            return Ok(());
        }
    }

    // 1. Super admin.
    if actor.is_super_admin {
        return Ok(());
    }
    // 2. Reserved super admin actions.
    if action.is_super_admin_only() {
        return Err(Forbidden);
    }

    // 3. The resource's branch(es). Not a member of any: it isn't visible.
    let branches: Vec<(Uuid, &BranchAccess)> =
        action.branches().into_iter().filter_map(|b| actor.branch(b).map(|access| (b, access))).collect();
    if branches.is_empty() {
        return Err(if action.issue().is_some() { Forbidden } else { NotFound });
    }

    for (branch_id, access) in branches {
        // 4. Admin of that branch.
        if access.is_admin {
            return Ok(());
        }
        // 5. Reserved admin actions: not decidable by grants in this branch.
        if action.is_admin_only() {
            continue;
        }
        // 6. Grants (and the few rules that need no grant).
        if allowed_by_grants(actor, branch_id, access, &action) {
            return Ok(());
        }
    }
    // 7. Otherwise deny.
    Err(Forbidden)
}

/// Readability of an issue. Must agree with the SQL `issue_visible`.
pub fn can_read(actor: &Actor, issue: &IssueFacts) -> bool {
    // Own and targeted count only while a member of the issue's branch;
    // `actor_targeted` already includes that check.
    let own = issue.created_by == actor.user_id && issue.branch_id.is_none_or(|b| actor.branch(b).is_some());
    if actor.is_super_admin || own || issue.actor_targeted {
        return true;
    }
    issue.branches().into_iter().any(|b| {
        let Some(access) = actor.branch(b) else { return false };
        access.is_admin
            || has_grant(access, Permission::IssueReadPrivate, Some(issue.issue_type), |_| true)
            || (!issue.is_private
                && has_grant(access, Permission::IssueRead, Some(issue.issue_type), |s| s == Scope::Branch))
    })
}

fn allowed_by_grants(actor: &Actor, branch_id: Uuid, access: &BranchAccess, action: &Action<'_>) -> bool {
    use Action::*;
    use Permission as P;
    let me = actor.user_id;
    let branch_only = |s: Scope| s == Scope::Branch;

    match *action {
        // Membership alone is enough.
        ViewBranch { .. } | ViewGroups { .. } => true,
        ViewEffectivePermissions { user_id, .. } => user_id == me,

        ViewMembers { .. } => has_grant(access, P::MemberView, None, branch_only),
        AddMember { .. } | EditMember { .. } | RemoveMember { .. } | ResetPassword { .. } | SetUserActive { .. } => {
            has_grant(access, P::MemberManage, None, branch_only)
        }
        ViewBranchDashboard { .. } => has_grant(access, P::DashboardBranch, None, branch_only),
        Export { .. } => has_grant(access, P::ExportRun, None, branch_only),

        CreateIssue { issue_type, .. } => has_grant(access, P::IssueCreate, Some(issue_type), branch_only),
        EditIssue { issue } => has_issue_grant(access, P::IssueEdit, issue, me),
        CloseIssue { issue } => {
            // "Anyone can close the tickets, reports and events they created."
            (issue.created_by == me && issue.issue_type != IssueType::Action)
                || has_issue_grant(access, P::IssueClose, issue, me)
        }
        SetIssuePrivate { issue } => has_issue_grant(access, P::IssueSetPrivate, issue, me),
        TargetIssue { issue, .. } => has_issue_grant(access, P::IssueTarget, issue, me),
        CommentOnIssue { issue } => has_grant(access, P::CommentCreate, None, |s| match s {
            Scope::Branch => true,
            // Only issues you are targeted by or created.
            Scope::Targeted => issue.actor_targeted || issue.created_by == me,
            Scope::Own => false,
        }),
        InternalComments { .. } => has_grant(access, P::CommentInternal, None, branch_only),
        ModerateComments { .. } => has_grant(access, P::CommentModerate, None, branch_only),

        UpdateWorkItem { item } => {
            has_grant(access, P::WorkItemUpdate, Some(item.issue.issue_type), |s| work_item_scope(s, item, me))
        }
        ClaimWorkItem { item } => {
            has_grant(access, P::WorkItemAssign, Some(item.issue.issue_type), |s| work_item_scope(s, item, me))
        }
        AssignWorkItem { item } => has_grant(access, P::WorkItemAssign, Some(item.issue.issue_type), branch_only),
        ApproveWorkItem { item } => has_grant(access, P::WorkItemApprove, Some(item.issue.issue_type), branch_only),

        // Decided before the grant step.
        CreateBranch
        | EditBranch { .. }
        | SetBranchAdmin { .. }
        | SetSuperAdmin
        | ManageGroups { .. }
        | ReactivateMember { .. }
        | ReadIssue { .. }
        | CancelWorkItem { .. } => {
            let _ = branch_id;
            false
        }
    }
}

/// `own` / `branch` scopes for issue-level grants.
fn has_issue_grant(access: &BranchAccess, permission: Permission, issue: &IssueFacts, me: Uuid) -> bool {
    has_grant(access, permission, Some(issue.issue_type), |s| match s {
        Scope::Branch => true,
        Scope::Own => issue.created_by == me,
        Scope::Targeted => false,
    })
}

/// `targeted` for work items: the assignee, or for an unassigned item a member
/// of its target.
fn work_item_scope(scope: Scope, item: &WorkItemFacts, me: Uuid) -> bool {
    match scope {
        Scope::Branch => true,
        Scope::Targeted => match item.assignee_id {
            Some(assignee) => assignee == me,
            None => item.actor_in_target,
        },
        Scope::Own => false,
    }
}

/// Does any grant in the branch match the permission, the issue type (a grant
/// without a type covers all types) and a scope that holds?
fn has_grant(
    access: &BranchAccess,
    permission: Permission,
    issue_type: Option<IssueType>,
    scope_holds: impl Fn(Scope) -> bool,
) -> bool {
    access.grants.iter().any(|g| {
        g.permission == permission && (g.issue_type.is_none() || g.issue_type == issue_type) && scope_holds(g.scope)
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::authz::Grant;

    const A: Uuid = Uuid::from_u128(0xA);
    const B: Uuid = Uuid::from_u128(0xB);

    fn uid(n: u128) -> Uuid {
        Uuid::from_u128(0x1000 + n)
    }

    fn grant(permission: Permission, issue_type: Option<IssueType>, scope: Scope) -> Grant {
        Grant { permission, issue_type, scope }
    }

    /// The "All members" baseline from the schema trigger.
    fn baseline() -> Vec<Grant> {
        use IssueType::*;
        use Permission::*;
        use Scope::*;
        vec![
            grant(IssueRead, None, Branch),
            grant(IssueCreate, Some(Ticket), Branch),
            grant(IssueCreate, Some(Report), Branch),
            grant(IssueCreate, Some(Event), Branch),
            grant(IssueEdit, None, Own),
            grant(IssueClose, None, Own),
            grant(IssueTarget, Some(Ticket), Own),
            grant(IssueTarget, Some(Event), Own),
            grant(WorkItemUpdate, None, Targeted),
            grant(WorkItemAssign, None, Targeted),
            grant(CommentCreate, None, Branch),
            grant(MemberView, None, Branch),
        ]
    }

    /// Every grantable permission at its widest scope: an admin-like group.
    fn everything() -> Vec<Grant> {
        Permission::ALL.iter().map(|p| grant(*p, None, Scope::Branch)).collect()
    }

    fn actor(n: u128, branches: &[(Uuid, bool, Vec<Grant>)]) -> Actor {
        Actor {
            user_id: uid(n),
            is_super_admin: false,
            branches: branches
                .iter()
                .map(|(b, is_admin, grants)| (*b, BranchAccess { is_admin: *is_admin, grants: grants.clone() }))
                .collect(),
        }
    }

    fn super_admin() -> Actor {
        Actor { user_id: uid(0), is_super_admin: true, branches: HashMap::new() }
    }

    fn member(n: u128) -> Actor {
        actor(n, &[(A, false, baseline())])
    }

    fn admin(n: u128) -> Actor {
        actor(n, &[(A, true, baseline())])
    }

    fn admin_like(n: u128) -> Actor {
        let mut grants = baseline();
        grants.extend(everything());
        actor(n, &[(A, false, grants)])
    }

    fn user_facts(n: u128, branches: &[(Uuid, bool)], is_super_admin: bool) -> UserFacts {
        UserFacts {
            user_id: uid(n),
            is_super_admin,
            is_active: true,
            branches: branches.iter().copied().collect(),
            departed: vec![],
        }
    }

    fn issue(created_by: Uuid, ty: IssueType) -> IssueFacts {
        IssueFacts {
            id: Uuid::from_u128(0x99),
            branch_id: Some(A),
            issue_type: ty,
            is_private: false,
            created_by,
            requires_super_admin_approval: false,
            target_branch_ids: vec![A],
            actor_targeted: false,
        }
    }

    fn item(issue: IssueFacts, assignee: Option<Uuid>, actor_in_target: bool) -> WorkItemFacts {
        WorkItemFacts { id: Uuid::from_u128(0x77), branch_id: A, assignee_id: assignee, actor_in_target, issue }
    }

    use AuthzError::*;

    fn ok(actor: &Actor, action: Action<'_>) {
        assert_eq!(authorize(actor, action), Ok(()), "expected allow: {action:?}");
    }

    fn denied(actor: &Actor, action: Action<'_>, expected: AuthzError) {
        assert_eq!(authorize(actor, action), Err(expected), "expected {expected:?}: {action:?}");
    }

    // ---- 6.2: super admin only ------------------------------------------------

    #[test]
    fn branch_and_admin_flag_changes_are_super_admin_only() {
        for action in [
            Action::CreateBranch,
            Action::EditBranch { branch_id: A },
            Action::SetBranchAdmin { branch_id: A },
            Action::SetSuperAdmin,
        ] {
            ok(&super_admin(), action);
            denied(&admin(1), action, Forbidden);
            denied(&admin_like(2), action, Forbidden);
            denied(&member(3), action, Forbidden);
        }
    }

    #[test]
    fn cross_branch_issues_and_branch_targets_are_super_admin_only() {
        let cross =
            Action::CreateIssue { branch_id: None, issue_type: IssueType::Action, targets_whole_branches: true };
        let branch_target =
            Action::CreateIssue { branch_id: Some(A), issue_type: IssueType::Action, targets_whole_branches: true };
        for action in [cross, branch_target] {
            ok(&super_admin(), action);
            denied(&admin(1), action, Forbidden);
            denied(&admin_like(2), action, Forbidden);
        }
    }

    #[test]
    fn super_admin_issues_are_edited_closed_retargeted_and_approved_by_super_admins_only() {
        let mut sa_issue = issue(uid(0), IssueType::Action);
        sa_issue.requires_super_admin_approval = true;
        let work = item(sa_issue.clone(), Some(uid(3)), true);

        for a in [admin(1), admin_like(2)] {
            denied(&a, Action::EditIssue { issue: &sa_issue }, Forbidden);
            denied(&a, Action::CloseIssue { issue: &sa_issue }, Forbidden);
            denied(&a, Action::TargetIssue { issue: &sa_issue, whole_branch: false }, Forbidden);
            denied(&a, Action::SetIssuePrivate { issue: &sa_issue }, Forbidden);
            denied(&a, Action::ApproveWorkItem { item: &work }, Forbidden);
        }
        ok(&super_admin(), Action::EditIssue { issue: &sa_issue });
        ok(&super_admin(), Action::ApproveWorkItem { item: &work });

        // Branch admins may still read, comment, assign and update their branch's work.
        let a = admin(1);
        ok(&a, Action::ReadIssue { issue: &sa_issue });
        ok(&a, Action::CommentOnIssue { issue: &sa_issue });
        ok(&a, Action::AssignWorkItem { item: &work });
        ok(&a, Action::UpdateWorkItem { item: &work });
    }

    #[test]
    fn multi_branch_export_is_super_admin_only() {
        let two = [A, B];
        let a = actor(1, &[(A, true, vec![]), (B, true, vec![])]);
        denied(&a, Action::Export { branch_ids: &two }, Forbidden);
        ok(&super_admin(), Action::Export { branch_ids: &two });
        ok(&a, Action::Export { branch_ids: &[A] });
    }

    #[test]
    fn deactivating_multi_branch_users_admins_and_super_admins_is_super_admin_only() {
        let multi = user_facts(5, &[(A, false), (B, false)], false);
        let an_admin = user_facts(6, &[(A, true)], false);
        let a_super = user_facts(7, &[(A, false)], true);
        let single = user_facts(8, &[(A, false)], false);
        for target in [&multi, &an_admin, &a_super] {
            denied(&admin(1), Action::SetUserActive { target }, Forbidden);
            ok(&super_admin(), Action::SetUserActive { target });
        }
        ok(&admin(1), Action::SetUserActive { target: &single });
        ok(&admin_like(2), Action::SetUserActive { target: &single });
        denied(&member(3), Action::SetUserActive { target: &single }, Forbidden);
    }

    #[test]
    fn super_admin_accounts_are_untouchable_below_super_admin() {
        let sa = user_facts(7, &[(A, false)], true);
        for action in [
            Action::EditMember { branch_id: A, target: &sa },
            Action::RemoveMember { branch_id: A, target: &sa },
            Action::ResetPassword { target: &sa },
            Action::AddMember { branch_id: A, existing: Some(&sa) },
        ] {
            denied(&admin(1), action, Forbidden);
            ok(&super_admin(), action);
        }
    }

    // ---- 6.2: branch admin only ---------------------------------------------------

    #[test]
    fn group_management_is_admin_only_even_for_admin_like_groups() {
        let action = Action::ManageGroups { branch_id: A };
        ok(&super_admin(), action);
        ok(&admin(1), action);
        denied(&admin_like(2), action, Forbidden);
        denied(&member(3), action, Forbidden);
        // Admin of another branch: not visible.
        denied(&actor(4, &[(B, true, vec![])]), action, NotFound);
    }

    #[test]
    fn acting_on_another_admin_or_reactivating_is_admin_only() {
        let other_admin = user_facts(5, &[(A, true)], false);
        let admin_elsewhere = user_facts(6, &[(A, false), (B, true)], false);
        for target in [&other_admin, &admin_elsewhere] {
            for action in [
                Action::EditMember { branch_id: A, target },
                Action::ResetPassword { target },
                Action::RemoveMember { branch_id: A, target },
            ] {
                ok(&admin(1), action);
                denied(&admin_like(2), action, Forbidden);
            }
        }
        ok(&admin(1), Action::ReactivateMember { branch_id: A });
        denied(&admin_like(2), Action::ReactivateMember { branch_id: A }, Forbidden);
    }

    // ---- member.manage limits (6.4) -----------------------------------------------

    #[test]
    fn multi_branch_actions_are_allowed_if_any_branch_allows() {
        // Admin in B, plain member in A; the target is an admin elsewhere and
        // a member of both. Branch order must not matter.
        let a = actor(1, &[(A, false, baseline()), (B, true, vec![])]);
        let target = user_facts(5, &[(A, false), (B, false), (Uuid::from_u128(0xC), true)], false);
        ok(&a, Action::ResetPassword { target: &target });
    }

    #[test]
    fn member_manage_covers_plain_members_of_this_branch_only() {
        let plain = user_facts(5, &[(A, false)], false);
        let manager = actor(2, &[(A, false, vec![grant(Permission::MemberManage, None, Scope::Branch)])]);
        ok(&manager, Action::EditMember { branch_id: A, target: &plain });
        ok(&manager, Action::RemoveMember { branch_id: A, target: &plain });
        ok(&manager, Action::ResetPassword { target: &plain });
        ok(&manager, Action::AddMember { branch_id: A, existing: None });
        ok(&manager, Action::AddMember { branch_id: A, existing: Some(&plain) });
        denied(&member(3), Action::EditMember { branch_id: A, target: &plain }, Forbidden);

        // Other branches: not visible.
        let in_b = user_facts(6, &[(B, false)], false);
        denied(&manager, Action::RemoveMember { branch_id: B, target: &in_b }, NotFound);
        denied(&manager, Action::ResetPassword { target: &in_b }, NotFound);
        // Deactivating a user who is also in another branch.
        let both = user_facts(7, &[(A, false), (B, false)], false);
        denied(&manager, Action::SetUserActive { target: &both }, Forbidden);
    }

    #[test]
    fn member_view_needs_the_grant() {
        ok(&member(1), Action::ViewMembers { branch_id: A });
        denied(&actor(2, &[(A, false, vec![])]), Action::ViewMembers { branch_id: A }, Forbidden);
        denied(&member(1), Action::ViewMembers { branch_id: B }, NotFound);
    }

    #[test]
    fn effective_permissions_are_visible_to_admins_and_the_user() {
        let m = member(1);
        ok(&m, Action::ViewEffectivePermissions { branch_id: A, user_id: m.user_id });
        denied(&m, Action::ViewEffectivePermissions { branch_id: A, user_id: uid(9) }, Forbidden);
        ok(&admin(2), Action::ViewEffectivePermissions { branch_id: A, user_id: uid(9) });
    }

    #[test]
    fn grants_never_carry_over_between_branches() {
        let multi = actor(1, &[(A, true, baseline()), (B, false, vec![])]);
        ok(&multi, Action::ManageGroups { branch_id: A });
        denied(&multi, Action::ManageGroups { branch_id: B }, Forbidden);
        denied(&multi, Action::ViewMembers { branch_id: B }, Forbidden);
        ok(&multi, Action::ViewMembers { branch_id: A });
    }

    // ---- issues (6.1 and 6.4) ---------------------------------------------------

    #[test]
    fn private_issues_are_hidden_from_uninvolved_members() {
        let mut private = issue(uid(9), IssueType::Ticket);
        private.is_private = true;
        let m = member(1);
        denied(&m, Action::ReadIssue { issue: &private }, NotFound);
        // Every action on an unreadable issue is 404, not 403.
        denied(&m, Action::CommentOnIssue { issue: &private }, NotFound);
        denied(&m, Action::EditIssue { issue: &private }, NotFound);

        ok(&admin(2), Action::ReadIssue { issue: &private });
        ok(&super_admin(), Action::ReadIssue { issue: &private });
        let reader = actor(3, &[(A, false, vec![grant(Permission::IssueReadPrivate, None, Scope::Branch)])]);
        ok(&reader, Action::ReadIssue { issue: &private });
        let typed_reader =
            actor(4, &[(A, false, vec![grant(Permission::IssueReadPrivate, Some(IssueType::Action), Scope::Branch)])]);
        denied(&typed_reader, Action::ReadIssue { issue: &private }, NotFound);

        let mut targeted = private.clone();
        targeted.actor_targeted = true;
        ok(&m, Action::ReadIssue { issue: &targeted });
        let own = IssueFacts { created_by: m.user_id, ..private.clone() };
        ok(&m, Action::ReadIssue { issue: &own });
        // Own issues in a branch you've left: gone.
        let left = IssueFacts { branch_id: Some(B), ..own };
        denied(&m, Action::ReadIssue { issue: &left }, NotFound);
    }

    #[test]
    fn issue_read_at_branch_scope_respects_issue_type() {
        let pub_action = issue(uid(9), IssueType::Action);
        let pub_ticket = issue(uid(9), IssueType::Ticket);
        let ticket_reader =
            actor(1, &[(A, false, vec![grant(Permission::IssueRead, Some(IssueType::Ticket), Scope::Branch)])]);
        ok(&ticket_reader, Action::ReadIssue { issue: &pub_ticket });
        denied(&ticket_reader, Action::ReadIssue { issue: &pub_action }, NotFound);
        // Own/targeted-scoped read grants don't open the branch.
        let own_reader = actor(2, &[(A, false, vec![grant(Permission::IssueRead, None, Scope::Own)])]);
        denied(&own_reader, Action::ReadIssue { issue: &pub_ticket }, NotFound);
    }

    #[test]
    fn create_needs_the_type_specific_grant() {
        let create = |ty| Action::CreateIssue { branch_id: Some(A), issue_type: ty, targets_whole_branches: false };
        let m = member(1);
        ok(&m, create(IssueType::Ticket));
        ok(&m, create(IssueType::Report));
        ok(&m, create(IssueType::Event));
        denied(&m, create(IssueType::Action), Forbidden);
        ok(&admin(2), create(IssueType::Action));
        ok(&admin_like(3), create(IssueType::Action));
    }

    #[test]
    fn own_scope_covers_only_issues_you_created() {
        let m = member(1);
        let mine = issue(m.user_id, IssueType::Report);
        let theirs = issue(uid(9), IssueType::Report);
        ok(&m, Action::EditIssue { issue: &mine });
        denied(&m, Action::EditIssue { issue: &theirs }, Forbidden);
        ok(&admin_like(2), Action::EditIssue { issue: &theirs });
        // issue.target @own is only granted for tickets and events in the baseline.
        denied(&m, Action::TargetIssue { issue: &mine, whole_branch: false }, Forbidden);
        let my_ticket = issue(m.user_id, IssueType::Ticket);
        ok(&m, Action::TargetIssue { issue: &my_ticket, whole_branch: false });
        // Whole-branch targets: super admins only, even for admins.
        denied(&admin(5), Action::TargetIssue { issue: &my_ticket, whole_branch: true }, Forbidden);
        ok(&super_admin(), Action::TargetIssue { issue: &my_ticket, whole_branch: true });
        denied(&m, Action::SetIssuePrivate { issue: &my_ticket }, Forbidden);
    }

    #[test]
    fn creators_can_always_close_their_tickets_reports_and_events() {
        let bare = actor(1, &[(A, false, vec![grant(Permission::IssueRead, None, Scope::Branch)])]);
        for ty in [IssueType::Ticket, IssueType::Report, IssueType::Event] {
            ok(&bare, Action::CloseIssue { issue: &issue(bare.user_id, ty) });
        }
        denied(&bare, Action::CloseIssue { issue: &issue(bare.user_id, IssueType::Action) }, Forbidden);
        denied(&bare, Action::CloseIssue { issue: &issue(uid(9), IssueType::Ticket) }, Forbidden);
    }

    #[test]
    fn comment_targeted_scope_means_created_or_targeted() {
        let commenter = actor(
            1,
            &[(
                A,
                false,
                vec![
                    grant(Permission::IssueRead, None, Scope::Branch),
                    grant(Permission::CommentCreate, None, Scope::Targeted),
                ],
            )],
        );
        let other = issue(uid(9), IssueType::Ticket);
        denied(&commenter, Action::CommentOnIssue { issue: &other }, Forbidden);
        let targeted = IssueFacts { actor_targeted: true, ..other.clone() };
        ok(&commenter, Action::CommentOnIssue { issue: &targeted });
        let mine = IssueFacts { created_by: commenter.user_id, ..other };
        ok(&commenter, Action::CommentOnIssue { issue: &mine });
    }

    #[test]
    fn internal_comments_and_moderation_need_grants() {
        let i = issue(uid(9), IssueType::Ticket);
        denied(&member(1), Action::InternalComments { issue: &i }, Forbidden);
        denied(&member(1), Action::ModerateComments { issue: &i }, Forbidden);
        ok(&admin(2), Action::InternalComments { issue: &i });
        ok(&admin_like(3), Action::ModerateComments { issue: &i });
    }

    #[test]
    fn cross_branch_issues_use_every_targeted_branch() {
        let cross = IssueFacts {
            branch_id: None,
            requires_super_admin_approval: true,
            target_branch_ids: vec![A, B],
            ..issue(uid(0), IssueType::Action)
        };
        let admin_b = actor(1, &[(B, true, vec![])]);
        ok(&admin_b, Action::ReadIssue { issue: &cross });
        ok(&admin_b, Action::CommentOnIssue { issue: &cross });
        denied(&admin_b, Action::EditIssue { issue: &cross }, Forbidden);
        let outsider = actor(2, &[(Uuid::from_u128(0xC), true, vec![])]);
        denied(&outsider, Action::ReadIssue { issue: &cross }, NotFound);
    }

    // ---- work items ---------------------------------------------------------------

    #[test]
    fn work_item_targeted_means_assignee_or_member_of_unassigned_target() {
        let m = member(1);
        let action_issue = issue(uid(9), IssueType::Action);
        let mut targeted_issue = action_issue.clone();
        targeted_issue.actor_targeted = true;

        let mine = item(targeted_issue.clone(), Some(m.user_id), true);
        let someone_elses = item(targeted_issue.clone(), Some(uid(8)), true);
        let shared_unassigned = item(targeted_issue.clone(), None, true);
        let not_my_target = item(action_issue, None, false);

        ok(&m, Action::UpdateWorkItem { item: &mine });
        denied(&m, Action::UpdateWorkItem { item: &someone_elses }, Forbidden);
        ok(&m, Action::ClaimWorkItem { item: &shared_unassigned });
        denied(&m, Action::ClaimWorkItem { item: &not_my_target }, Forbidden);
        // Reassigning needs branch scope.
        denied(&m, Action::AssignWorkItem { item: &shared_unassigned }, Forbidden);
        ok(&admin_like(2), Action::AssignWorkItem { item: &shared_unassigned });
        ok(&admin(3), Action::AssignWorkItem { item: &shared_unassigned });
    }

    #[test]
    fn cancelling_work_directly_is_admin_only() {
        let i = issue(uid(9), IssueType::Action);
        let w = item(i.clone(), Some(uid(8)), false);
        ok(&admin(1), Action::CancelWorkItem { item: &w });
        denied(&admin_like(2), Action::CancelWorkItem { item: &w }, Forbidden);
        let sa_issue = IssueFacts { requires_super_admin_approval: true, ..i };
        let sa_item = item(sa_issue, Some(uid(8)), false);
        denied(&admin(1), Action::CancelWorkItem { item: &sa_item }, Forbidden);
        ok(&super_admin(), Action::CancelWorkItem { item: &sa_item });
    }

    #[test]
    fn nobody_approves_their_own_work() {
        let i = issue(uid(9), IssueType::Action);
        let sa = super_admin();
        let own_sa = item(i.clone(), Some(sa.user_id), false);
        denied(&sa, Action::ApproveWorkItem { item: &own_sa }, Forbidden);

        let a = admin(1);
        let own_admin = item(i.clone(), Some(a.user_id), false);
        denied(&a, Action::ApproveWorkItem { item: &own_admin }, Forbidden);

        let others = item(i, Some(uid(8)), false);
        ok(&a, Action::ApproveWorkItem { item: &others });
        ok(&admin_like(2), Action::ApproveWorkItem { item: &others });
        denied(&member(3), Action::ApproveWorkItem { item: &others }, Forbidden);
    }

    #[test]
    fn dashboard_and_single_branch_export_need_grants() {
        denied(&member(1), Action::ViewBranchDashboard { branch_id: A }, Forbidden);
        denied(&member(1), Action::Export { branch_ids: &[A] }, Forbidden);
        ok(&admin_like(2), Action::ViewBranchDashboard { branch_id: A });
        ok(&admin_like(2), Action::Export { branch_ids: &[A] });
        denied(&admin_like(2), Action::Export { branch_ids: &[B] }, NotFound);
    }
}
