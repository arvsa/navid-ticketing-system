//! `authorize(actor, action)`: the decision procedure of section 6.4.
//!
//! Each [`Action`] carries the facts about its resource (loaded by
//! `relations`), so the check itself is a pure function and is unit tested
//! below. Domain functions call it; HTTP handlers never check permissions.
//!
//! Three layers decide: the baseline every user has (their own issues and
//! what's sent to them, see [`baseline`]), the business rules of departments
//! and passing work along, and the branch-wide grants of the permission
//! groups attached to the actor's departments.

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
    /// Change the app's settings (the school's name).
    EditSettings,
    /// Create, edit and archive issue templates (school-wide).
    ManageTemplates,
    /// Everyone's names and emails, for chosen branches or all.
    ExportPeople,
    ViewBranch {
        branch_id: Uuid,
    },

    // -- departments ------------------------------------------------------------
    /// List the branch's departments, their members and heads.
    ViewDepartments {
        branch_id: Uuid,
    },
    /// Create, rename, archive or delete departments; choose their heads.
    ManageDepartments {
        branch_id: Uuid,
    },
    /// Add people to the department called `department`, or remove them.
    ManageDepartmentMembers {
        branch_id: Uuid,
        department: &'a str,
    },

    // -- permission groups (admin only) ----------------------------------------
    /// Create, change or delete the branch's permission groups, and attach
    /// permission groups to its departments.
    ManagePermissionGroups {
        branch_id: Uuid,
    },
    /// List, create and change school-wide permission groups, "Everyone"
    /// included.
    ManageSchoolPermissionGroups,
    /// A member's effective permissions, with where each comes from.
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

    /// List the people and departments of every branch, to send an item to
    /// them.
    FindPeopleInOtherBranches,

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
    /// Soft delete: hidden from everyone, its history kept.
    DeleteIssue {
        issue: &'a IssueFacts,
    },
    /// Add or remove a target. Whole-branch targets are for the branch's
    /// admins and super admins.
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
    /// Pass work you hold on to someone else in its branch.
    PassWorkItem {
        item: &'a WorkItemFacts,
    },
    /// Pass a question you were asked on to someone else.
    PassTicket {
        issue: &'a IssueFacts,
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
            | DeleteIssue { issue }
            | TargetIssue { issue, .. }
            | CommentOnIssue { issue }
            | InternalComments { issue }
            | ModerateComments { issue }
            | PassTicket { issue } => Some(issue),
            PassWorkItem { item }
            | UpdateWorkItem { item }
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
            CreateBranch
            | EditBranch { .. }
            | SetBranchAdmin { .. }
            | SetSuperAdmin
            | ManageSchoolPermissionGroups
            | EditSettings
            | ManageTemplates
            | ExportPeople => true,
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
            // Permission groups decide what people may do: no grant hands that out.
            ManagePermissionGroups { .. } | ReactivateMember { .. } | CancelWorkItem { .. } | DeleteIssue { .. } => {
                true
            }
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
            CreateBranch
            | SetSuperAdmin
            | ManageSchoolPermissionGroups
            | FindPeopleInOtherBranches
            | EditSettings
            | ManageTemplates
            | ExportPeople => vec![],
            EditBranch { branch_id }
            | SetBranchAdmin { branch_id }
            | ViewBranch { branch_id }
            | ViewDepartments { branch_id }
            | ManageDepartments { branch_id }
            | ManageDepartmentMembers { branch_id, .. }
            | ManagePermissionGroups { branch_id }
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
            | CancelWorkItem { item }
            | PassWorkItem { item } => vec![item.branch_id],
            Export { branch_ids } => branch_ids.to_vec(),
            ReadIssue { issue }
            | EditIssue { issue }
            | CloseIssue { issue }
            | DeleteIssue { issue }
            | TargetIssue { issue, .. }
            | CommentOnIssue { issue }
            | InternalComments { issue }
            | ModerateComments { issue }
            | PassTicket { issue } => issue.branches(),
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
    // 2b. Sending to other branches or whole branches, or changing who a
    // school-wide item goes to.
    if let Some(allowed) = across_branches(actor, &action) {
        return if allowed { Ok(()) } else { Err(Forbidden) };
    }
    // 2c. Passing on what you hold: work you're assigned, or a question you were asked.
    match action {
        Action::PassWorkItem { item } => {
            return if item.assignee_id == Some(actor.user_id) { Ok(()) } else { Err(Forbidden) };
        }
        Action::PassTicket { issue } => {
            return if issue.actor_targeted && issue.issue_type == IssueType::Ticket { Ok(()) } else { Err(Forbidden) };
        }
        _ => {}
    }
    // 2d. Work passed along is reviewed one level up the chain: by whoever
    // passed it on (or the branch's admins), before the sender sees it.
    if let Action::ApproveWorkItem { item } = action {
        if let Some(reviewer) = item.reviewer {
            let allowed = reviewer == actor.user_id || actor.is_admin_of(item.branch_id);
            return if allowed { Ok(()) } else { Err(Forbidden) };
        }
    }
    // 2e. The sender approves (or cancels) the work on what they sent.
    if let Action::ApproveWorkItem { item } | Action::CancelWorkItem { item } = action {
        if item.issue.created_by == actor.user_id {
            return Ok(());
        }
    }
    // 2f. A department's heads run what's sent to it.
    if runs_department_work(actor, &action) {
        return Ok(());
    }
    // 2g. What every user may do without a grant.
    if baseline(actor, &action) {
        return Ok(());
    }

    // 3. The resource's branch(es). Not a member of any: it isn't visible.
    let mut ids = action.branches();
    // A school-wide item: its sender works on the item itself under the rules
    // of their own branches, and only they edit, close or delete it (it spans
    // branches the receiving admins don't run). Work items still follow the
    // branch they're in.
    if let Some(issue) = action.issue() {
        let issue_level = !matches!(
            action,
            Action::UpdateWorkItem { .. }
                | Action::ClaimWorkItem { .. }
                | Action::AssignWorkItem { .. }
                | Action::ApproveWorkItem { .. }
                | Action::CancelWorkItem { .. }
        );
        if issue_level && issue.branch_id.is_none() {
            if matches!(action, Action::EditIssue { .. } | Action::CloseIssue { .. } | Action::DeleteIssue { .. }) {
                ids.clear();
            }
            if issue.created_by == actor.user_id {
                ids.extend(actor.branches.keys().copied());
            }
        }
    }
    let branches: Vec<(Uuid, &BranchAccess)> =
        ids.into_iter().filter_map(|b| actor.branch(b).map(|access| (b, access))).collect();
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
        // 6. Grants.
        if allowed_by_grants(actor, branch_id, access, &action) {
            return Ok(());
        }
    }
    // 7. Otherwise deny.
    Err(Forbidden)
}

/// Anyone may send items to people and departments in any branch. Whole
/// branches are for that branch's admins (and super admins). Only its
/// sender changes who a school-wide item goes to. `None` for every other
/// action, including a branch item going to people or departments of its
/// own branch.
fn across_branches(actor: &Actor, action: &Action<'_>) -> Option<bool> {
    let member_somewhere = !actor.branches.is_empty();
    match *action {
        Action::FindPeopleInOtherBranches => Some(member_somewhere),
        Action::CreateIssue { branch_id: None, targets_whole_branches, .. } => {
            // A school-wide item reaches whole branches only from super admins.
            Some(member_somewhere && !targets_whole_branches)
        }
        Action::TargetIssue { issue, whole_branch } if issue.branch_id.is_none() => {
            Some(issue.created_by == actor.user_id && issue.sender_may_change && !whole_branch)
        }
        Action::CreateIssue { branch_id: Some(b), targets_whole_branches: true, .. } => Some(actor.is_admin_of(b)),
        Action::TargetIssue { issue, whole_branch: true } => {
            Some(issue.branch_id.is_some_and(|b| actor.is_admin_of(b)))
        }
        _ => None,
    }
}

/// Work sent to a department the actor heads (hand it out, approve or send
/// it back, cancel it), and closing a question sent to it, while still a
/// member of its branch.
fn runs_department_work(actor: &Actor, action: &Action<'_>) -> bool {
    match *action {
        Action::AssignWorkItem { item } | Action::ApproveWorkItem { item } | Action::CancelWorkItem { item } => {
            actor.branch(item.branch_id).is_some() && item.target_department_id.is_some_and(|d| actor.heads(d))
        }
        Action::CloseIssue { issue } => {
            issue.issue_type == IssueType::Ticket
                && issue.branch_id.is_some_and(|b| actor.branch(b).is_some())
                && issue.target_department_ids.iter().any(|d| actor.heads(*d))
        }
        _ => false,
    }
}

/// What every user may do without a grant, in branches they belong to:
/// create items and send them to anyone; edit, retarget or delete their own
/// while open and current (closing them at any time); comment on, and work
/// on, what's sent to them.
fn baseline(actor: &Actor, action: &Action<'_>) -> bool {
    use Action::*;
    let me = actor.user_id;
    let own = |issue: &IssueFacts| issue.created_by == me;
    match *action {
        CreateIssue { branch_id: Some(b), targets_whole_branches: false, .. } => actor.branch(b).is_some(),
        EditIssue { issue } | DeleteIssue { issue } | TargetIssue { issue, whole_branch: false } => {
            own(issue) && issue.sender_may_change
        }
        CloseIssue { issue } => own(issue),
        CommentOnIssue { issue } => own(issue) || issue.actor_targeted,
        UpdateWorkItem { item } | ClaimWorkItem { item } => work_item_targeted(item, me),
        ViewDepartments { branch_id } | ViewBranch { branch_id } => actor.branch(branch_id).is_some(),
        ViewEffectivePermissions { branch_id, user_id } => user_id == me && actor.branch(branch_id).is_some(),
        _ => false,
    }
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
        access.is_admin || has_grant(access, Permission::IssueRead, Some(issue.issue_type))
    })
}

fn allowed_by_grants(actor: &Actor, branch_id: Uuid, access: &BranchAccess, action: &Action<'_>) -> bool {
    use Action::*;
    use Permission as P;
    let _ = (actor, branch_id);

    match *action {
        ViewMembers { .. } => has_grant(access, P::MemberView, None),
        AddMember { .. } | EditMember { .. } | RemoveMember { .. } | ResetPassword { .. } | SetUserActive { .. } => {
            has_grant(access, P::MemberManage, None)
        }
        ViewBranchDashboard { .. } => has_grant(access, P::DashboardBranch, None),
        Export { .. } => has_grant(access, P::ExportRun, None),

        ManageDepartments { .. } => has_grant(access, P::DepartmentManage, None),
        ManageDepartmentMembers { department, .. } => access.manages_members_of(department),

        // Other people's issues.
        EditIssue { issue } | TargetIssue { issue, .. } => has_grant(access, P::IssueEdit, Some(issue.issue_type)),
        CloseIssue { issue } => has_grant(access, P::IssueClose, Some(issue.issue_type)),
        CommentOnIssue { .. } => has_grant(access, P::CommentCreate, None),
        InternalComments { .. } => has_grant(access, P::CommentInternal, None),
        ModerateComments { .. } => has_grant(access, P::CommentModerate, None),

        UpdateWorkItem { item } => has_grant(access, P::WorkItemUpdate, Some(item.issue.issue_type)),
        ClaimWorkItem { item } | AssignWorkItem { item } => {
            has_grant(access, P::WorkItemAssign, Some(item.issue.issue_type))
        }
        ApproveWorkItem { item } => has_grant(access, P::WorkItemApprove, Some(item.issue.issue_type)),

        // Decided before the grant step.
        CreateBranch
        | EditBranch { .. }
        | SetBranchAdmin { .. }
        | SetSuperAdmin
        | EditSettings
        | ManageTemplates
        | ExportPeople
        | ViewBranch { .. }
        | ViewDepartments { .. }
        | ManagePermissionGroups { .. }
        | ManageSchoolPermissionGroups
        | ViewEffectivePermissions { .. }
        | ReactivateMember { .. }
        | CreateIssue { .. }
        | ReadIssue { .. }
        | DeleteIssue { .. }
        | PassWorkItem { .. }
        | PassTicket { .. }
        | FindPeopleInOtherBranches
        | CancelWorkItem { .. } => false,
    }
}

/// Work sent to the actor: they're its assignee, or for an unassigned item a
/// member of its target.
fn work_item_targeted(item: &WorkItemFacts, me: Uuid) -> bool {
    match item.assignee_id {
        Some(assignee) => assignee == me,
        None => item.actor_in_target,
    }
}

/// Does any grant in the branch match the permission and the issue type (a
/// grant without a type covers all types)? Every grant is branch-wide.
fn has_grant(access: &BranchAccess, permission: Permission, issue_type: Option<IssueType>) -> bool {
    access.grants.iter().any(|g| {
        g.permission == permission && (g.issue_type.is_none() || g.issue_type == issue_type) && g.scope == Scope::Branch
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

    /// A new branch's "All members" permission group (schema trigger).
    fn baseline() -> Vec<Grant> {
        use Permission::*;
        vec![
            grant(IssueRead, None, Scope::Branch),
            grant(CommentCreate, None, Scope::Branch),
            grant(MemberView, None, Scope::Branch),
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
                .map(|(b, is_admin, grants)| {
                    (*b, BranchAccess { is_admin: *is_admin, grants: grants.clone(), manages_members_of: vec![] })
                })
                .collect(),
            heads: Default::default(),
        }
    }

    fn super_admin() -> Actor {
        Actor { user_id: uid(0), is_super_admin: true, branches: HashMap::new(), heads: Default::default() }
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
            created_by,
            target_branch_ids: vec![A],
            target_department_ids: vec![],
            sender_may_change: true,
            actor_targeted: false,
        }
    }

    fn item(issue: IssueFacts, assignee: Option<Uuid>, actor_in_target: bool) -> WorkItemFacts {
        WorkItemFacts {
            id: Uuid::from_u128(0x77),
            branch_id: A,
            assignee_id: assignee,
            reviewer: None,
            actor_in_target,
            target_department_id: None,
            issue,
        }
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
    fn whole_branches_are_for_their_admins_and_school_wide_ones_for_root_users() {
        let own_branch =
            Action::CreateIssue { branch_id: Some(A), issue_type: IssueType::Action, targets_whole_branches: true };
        ok(&super_admin(), own_branch);
        ok(&admin(1), own_branch);
        // Grants don't open whole branches.
        denied(&admin_like(2), own_branch, Forbidden);
        denied(&member(3), own_branch, Forbidden);
        // Another branch's whole branch: only its own admins.
        let other_branch =
            Action::CreateIssue { branch_id: Some(B), issue_type: IssueType::Action, targets_whole_branches: true };
        denied(&admin(1), other_branch, Forbidden);
        // School-wide items to whole branches: root users only.
        let cross =
            Action::CreateIssue { branch_id: None, issue_type: IssueType::Action, targets_whole_branches: true };
        ok(&super_admin(), cross);
        denied(&admin(1), cross, Forbidden);
    }

    #[test]
    fn the_sender_approves_and_cancels_the_work_they_sent() {
        let sent = issue(uid(1), IssueType::Action);
        let work = item(sent.clone(), Some(uid(3)), true);
        let sender = member(1);
        ok(&sender, Action::ApproveWorkItem { item: &work });
        ok(&sender, Action::CancelWorkItem { item: &work });
        // ...but not their own work, and nobody else's item.
        let own = item(sent, Some(uid(1)), true);
        denied(&sender, Action::ApproveWorkItem { item: &own }, Forbidden);
        let theirs = item(issue(uid(9), IssueType::Action), Some(uid(3)), true);
        denied(&sender, Action::ApproveWorkItem { item: &theirs }, Forbidden);
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
    fn permission_groups_are_admin_only_even_for_admin_like_departments() {
        let action = Action::ManagePermissionGroups { branch_id: A };
        ok(&super_admin(), action);
        ok(&admin(1), action);
        denied(&admin_like(2), action, Forbidden);
        denied(&member(3), action, Forbidden);
        // Admin of another branch: not visible.
        denied(&actor(4, &[(B, true, vec![])]), action, NotFound);
    }

    #[test]
    fn departments_are_managed_by_admins_and_department_manage() {
        let action = Action::ManageDepartments { branch_id: A };
        ok(&admin(1), action);
        ok(&admin_like(2), action);
        denied(&member(3), action, Forbidden);
        ok(&member(3), Action::ViewDepartments { branch_id: A });
        denied(&member(3), Action::ViewDepartments { branch_id: B }, NotFound);
    }

    #[test]
    fn department_members_are_chosen_per_department() {
        let it = Action::ManageDepartmentMembers { branch_id: A, department: "IT" };
        let health = Action::ManageDepartmentMembers { branch_id: A, department: "Health" };
        let mut chooser = member(1);
        chooser.branches.get_mut(&A).unwrap().manages_members_of = vec!["it".into()];
        ok(&chooser, it);
        denied(&chooser, health, Forbidden);
        let mut everywhere = member(2);
        everywhere.branches.get_mut(&A).unwrap().manages_members_of = vec!["*".into()];
        ok(&everywhere, health);
        ok(&admin(3), health);
        denied(&member(4), it, Forbidden);
        // Heads choose members only through a grant.
        let mut head = member(5);
        head.heads.insert(Uuid::from_u128(0xD));
        denied(&head, it, Forbidden);
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
        ok(&multi, Action::ManagePermissionGroups { branch_id: A });
        denied(&multi, Action::ManagePermissionGroups { branch_id: B }, Forbidden);
        denied(&multi, Action::ViewMembers { branch_id: B }, Forbidden);
        ok(&multi, Action::ViewMembers { branch_id: A });
    }

    // ---- issues (6.1 and 6.4) ---------------------------------------------------

    #[test]
    fn issues_are_hidden_from_members_without_branch_read() {
        let theirs = issue(uid(9), IssueType::Ticket);
        // In the branch, but without issue.read at branch scope.
        let m = actor(1, &[(A, false, vec![grant(Permission::CommentCreate, None, Scope::Branch)])]);
        denied(&m, Action::ReadIssue { issue: &theirs }, NotFound);
        // Every action on an unreadable issue is 404, not 403.
        denied(&m, Action::CommentOnIssue { issue: &theirs }, NotFound);
        denied(&m, Action::EditIssue { issue: &theirs }, NotFound);

        ok(&member(2), Action::ReadIssue { issue: &theirs });
        ok(&admin(3), Action::ReadIssue { issue: &theirs });
        ok(&super_admin(), Action::ReadIssue { issue: &theirs });

        let mut targeted = theirs.clone();
        targeted.actor_targeted = true;
        ok(&m, Action::ReadIssue { issue: &targeted });
        let own = IssueFacts { created_by: m.user_id, ..theirs.clone() };
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
    fn every_member_creates_every_type() {
        let create = |b, ty| Action::CreateIssue { branch_id: Some(b), issue_type: ty, targets_whole_branches: false };
        let bare = actor(1, &[(A, false, vec![])]);
        for ty in [IssueType::Ticket, IssueType::Event, IssueType::Action] {
            ok(&bare, create(A, ty));
        }
        // Not in another branch's name.
        denied(&bare, create(B, IssueType::Ticket), NotFound);
    }

    #[test]
    fn senders_change_their_own_issues_while_open_and_current() {
        let m = actor(1, &[(A, false, vec![])]);
        let mine = issue(m.user_id, IssueType::Action);
        for action in [
            Action::EditIssue { issue: &mine },
            Action::TargetIssue { issue: &mine, whole_branch: false },
            Action::DeleteIssue { issue: &mine },
            Action::CloseIssue { issue: &mine },
        ] {
            ok(&m, action);
        }
        // Ended, past its deadline, or closed: closing is all that's left.
        let stale = IssueFacts { sender_may_change: false, ..mine.clone() };
        denied(&m, Action::EditIssue { issue: &stale }, Forbidden);
        denied(&m, Action::TargetIssue { issue: &stale, whole_branch: false }, Forbidden);
        denied(&m, Action::DeleteIssue { issue: &stale }, Forbidden);
        ok(&m, Action::CloseIssue { issue: &stale });
        // Whole-branch targets stay with the branch's admins.
        denied(&m, Action::TargetIssue { issue: &mine, whole_branch: true }, Forbidden);
        ok(&admin(5), Action::TargetIssue { issue: &mine, whole_branch: true });
    }

    #[test]
    fn other_peoples_issues_need_grants_and_deleting_them_admins() {
        let theirs = issue(uid(9), IssueType::Action);
        denied(&member(1), Action::EditIssue { issue: &theirs }, Forbidden);
        denied(&member(1), Action::CloseIssue { issue: &theirs }, Forbidden);
        denied(&member(1), Action::TargetIssue { issue: &theirs, whole_branch: false }, Forbidden);
        ok(&admin_like(2), Action::EditIssue { issue: &theirs });
        ok(&admin_like(2), Action::CloseIssue { issue: &theirs });
        ok(&admin_like(2), Action::TargetIssue { issue: &theirs, whole_branch: false });
        denied(&admin_like(2), Action::DeleteIssue { issue: &theirs }, Forbidden);
        let stale = IssueFacts { sender_may_change: false, ..theirs };
        ok(&admin(3), Action::DeleteIssue { issue: &stale });
    }

    #[test]
    fn creators_can_always_close_what_they_sent() {
        let bare = actor(1, &[(A, false, vec![])]);
        for ty in [IssueType::Ticket, IssueType::Event, IssueType::Action] {
            ok(&bare, Action::CloseIssue { issue: &issue(bare.user_id, ty) });
        }
    }

    #[test]
    fn everyone_comments_on_what_they_sent_or_were_sent() {
        let reader = actor(1, &[(A, false, vec![grant(Permission::IssueRead, None, Scope::Branch)])]);
        let other = issue(uid(9), IssueType::Ticket);
        denied(&reader, Action::CommentOnIssue { issue: &other }, Forbidden);
        let targeted = IssueFacts { actor_targeted: true, ..other.clone() };
        ok(&reader, Action::CommentOnIssue { issue: &targeted });
        let mine = IssueFacts { created_by: reader.user_id, ..other.clone() };
        ok(&reader, Action::CommentOnIssue { issue: &mine });
        ok(&member(2), Action::CommentOnIssue { issue: &other });
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
    fn school_wide_permission_groups_are_super_admin_only() {
        ok(&super_admin(), Action::ManageSchoolPermissionGroups);
        denied(&admin(1), Action::ManageSchoolPermissionGroups, Forbidden);
        denied(&admin_like(2), Action::ManageSchoolPermissionGroups, Forbidden);
    }

    #[test]
    fn anyone_sends_to_people_and_departments_in_other_branches() {
        let create = |ty| Action::CreateIssue { branch_id: None, issue_type: ty, targets_whole_branches: false };
        let bare = actor(1, &[(A, false, vec![])]);
        for ty in [IssueType::Ticket, IssueType::Event, IssueType::Action] {
            ok(&bare, create(ty));
        }
        ok(&bare, Action::FindPeopleInOtherBranches);
        // Someone in no branch at all can't.
        let nowhere = actor(2, &[]);
        denied(&nowhere, create(IssueType::Ticket), Forbidden);
        denied(&nowhere, Action::FindPeopleInOtherBranches, Forbidden);
    }

    #[test]
    fn the_sender_of_a_school_wide_item_keeps_their_own_branch_rules() {
        let sender = member(1);
        let sent = IssueFacts { branch_id: None, target_branch_ids: vec![B], ..issue(uid(1), IssueType::Action) };
        ok(&sender, Action::ReadIssue { issue: &sent });
        ok(&sender, Action::EditIssue { issue: &sent });
        ok(&sender, Action::CloseIssue { issue: &sent });
        ok(&sender, Action::CommentOnIssue { issue: &sent });
        ok(&sender, Action::TargetIssue { issue: &sent, whole_branch: false });
        ok(&sender, Action::DeleteIssue { issue: &sent });
        // Whole branches: root users only.
        denied(&sender, Action::TargetIssue { issue: &sent, whole_branch: true }, Forbidden);
        // The sender approves the work, wherever it is.
        let work = WorkItemFacts { branch_id: B, ..item(sent.clone(), Some(uid(7)), false) };
        ok(&sender, Action::ApproveWorkItem { item: &work });
        // Nobody else changes the sender's recipients, admins included.
        let other = actor(2, &[(A, true, baseline())]);
        let mut targeted = sent.clone();
        targeted.actor_targeted = true;
        denied(&other, Action::TargetIssue { issue: &targeted, whole_branch: false }, Forbidden);
        // Admins of the receiving branch read, comment and approve their part,
        // but the item itself is the sender's.
        let admin_b = actor(3, &[(B, true, vec![])]);
        ok(&admin_b, Action::ReadIssue { issue: &sent });
        ok(&admin_b, Action::CommentOnIssue { issue: &sent });
        ok(&admin_b, Action::ApproveWorkItem { item: &work });
        denied(&admin_b, Action::TargetIssue { issue: &sent, whole_branch: false }, Forbidden);
        denied(&admin_b, Action::EditIssue { issue: &sent }, Forbidden);
        denied(&admin_b, Action::CloseIssue { issue: &sent }, Forbidden);
        denied(&admin_b, Action::DeleteIssue { issue: &sent }, Forbidden);
    }

    #[test]
    fn cross_branch_issues_use_every_targeted_branch() {
        let cross = IssueFacts { branch_id: None, target_branch_ids: vec![A, B], ..issue(uid(0), IssueType::Action) };
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
        let w = item(i, Some(uid(8)), false);
        ok(&admin(1), Action::CancelWorkItem { item: &w });
        denied(&admin_like(2), Action::CancelWorkItem { item: &w }, Forbidden);
        ok(&super_admin(), Action::CancelWorkItem { item: &w });
    }

    #[test]
    fn work_passed_along_is_reviewed_one_level_up() {
        // Sent by uid(9); first given to the head (uid 4), who passed it to uid(5).
        let sent = issue(uid(9), IssueType::Action);
        let passed = WorkItemFacts { reviewer: Some(uid(4)), ..item(sent, Some(uid(5)), true) };
        ok(&actor(4, &[(A, false, baseline())]), Action::ApproveWorkItem { item: &passed });
        ok(&admin(1), Action::ApproveWorkItem { item: &passed });
        // Not the sender or the branch's approvers yet: it isn't at the top.
        denied(&member(9), Action::ApproveWorkItem { item: &passed }, Forbidden);
        denied(&admin_like(2), Action::ApproveWorkItem { item: &passed }, Forbidden);
        // Only the holder passes it on.
        ok(&member(5), Action::PassWorkItem { item: &passed });
        denied(&actor(4, &[(A, false, baseline())]), Action::PassWorkItem { item: &passed }, Forbidden);
    }

    #[test]
    fn questions_are_passed_on_by_the_people_asked() {
        let mut ticket = issue(uid(9), IssueType::Ticket);
        ticket.actor_targeted = true;
        ok(&member(1), Action::PassTicket { issue: &ticket });
        let mut action = issue(uid(9), IssueType::Action);
        action.actor_targeted = true;
        denied(&member(1), Action::PassTicket { issue: &action }, Forbidden);
        denied(&member(2), Action::PassTicket { issue: &issue(uid(9), IssueType::Ticket) }, Forbidden);
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

    #[test]
    fn department_heads_run_what_is_sent_to_their_department() {
        const DEPT: Uuid = Uuid::from_u128(0xD);
        let mut head = actor(5, &[(A, false, baseline())]);
        head.heads.insert(DEPT);
        let plain = actor(6, &[(A, false, baseline())]);

        let ticket =
            IssueFacts { target_department_ids: vec![DEPT], actor_targeted: true, ..issue(uid(1), IssueType::Ticket) };
        assert_eq!(authorize(&head, Action::CloseIssue { issue: &ticket }), Ok(()));
        assert_eq!(authorize(&plain, Action::CloseIssue { issue: &ticket }), Err(Forbidden));

        let task = IssueFacts { actor_targeted: true, ..issue(uid(1), IssueType::Action) };
        let work = WorkItemFacts { target_department_id: Some(DEPT), ..item(task.clone(), Some(uid(7)), true) };
        for action in [
            Action::AssignWorkItem { item: &work },
            Action::ApproveWorkItem { item: &work },
            Action::CancelWorkItem { item: &work },
        ] {
            assert_eq!(authorize(&head, action), Ok(()));
        }
        assert_eq!(authorize(&plain, Action::ApproveWorkItem { item: &work }), Err(Forbidden));
        // Never their own work, and only their department's.
        let own = WorkItemFacts { assignee_id: Some(head.user_id), ..work.clone() };
        assert_eq!(authorize(&head, Action::ApproveWorkItem { item: &own }), Err(Forbidden));
        let elsewhere = WorkItemFacts { target_department_id: Some(Uuid::from_u128(0xE)), ..work.clone() };
        assert_eq!(authorize(&head, Action::ApproveWorkItem { item: &elsewhere }), Err(Forbidden));
        // A head who left the branch runs nothing there.
        let mut gone = actor(5, &[(B, false, baseline())]);
        gone.heads.insert(DEPT);
        assert_eq!(authorize(&gone, Action::ApproveWorkItem { item: &work }), Err(Forbidden));
    }
}
