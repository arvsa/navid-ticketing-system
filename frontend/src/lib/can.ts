// What the viewer may do, for hiding controls (gap G-20: the API has no per-item
// `can`). The server checks everything; when unsure, these return true and the
// server answers. Rules follow UX_SPEC §3.6 and FRONTEND_PLAN §4.3.
import type { IssueDetail, IssueType, MeResponse, Permission, WorkItem } from "@/api/types";

export type Viewer = {
  me: MeResponse;
};

export const isSuper = (v: Viewer) => v.me.user.is_super_admin;

export function membership(v: Viewer, branchId?: string | null) {
  return branchId ? v.me.memberships.find((m) => m.branch.id === branchId) : undefined;
}

export function isAdminOf(v: Viewer, branchId?: string | null) {
  return isSuper(v) || !!membership(v, branchId)?.is_admin;
}

export function isAdminAnywhere(v: Viewer) {
  return isSuper(v) || v.me.memberships.some((m) => m.is_admin);
}

/** Holds the permission in the branch. Used for navigation. */
export function hasGrant(v: Viewer, branchId: string | undefined | null, perm: Permission, type?: IssueType) {
  if (isAdminOf(v, branchId)) return true;
  const m = membership(v, branchId);
  return !!m?.grants.some((g) => g.permission === perm && (!type || !g.issue_type || g.issue_type === type));
}

export function hasGrantAnywhere(v: Viewer, perm: Permission) {
  return isSuper(v) || v.me.memberships.some((m) => m.is_admin || m.grants.some((g) => g.permission === perm));
}

/** The viewer is in the department (in that branch). */
export function inDepartment(v: Viewer, branchId: string, departmentId?: string | null) {
  return !!departmentId && !!membership(v, branchId)?.departments.includes(departmentId);
}

/** How the viewer relates to an item. */
export function relation(v: Viewer, issue: IssueDetail) {
  const myId = v.me.user.id;
  const createdByMe = issue.created_by === myId;
  const targetedMe = issue.targets.some((t) => {
    if (t.kind === "user") return t.user_id === myId;
    if (t.kind === "branch") return !!membership(v, t.branch_id);
    return inDepartment(v, t.branch_id, t.department_id);
  }) || issue.work_items.some((w) => w.assignee_id === myId);
  return { createdByMe, targetedMe };
}

/** A branch-wide grant of the permission, for the item's type. */
function grantApplies(v: Viewer, issue: IssueDetail, perm: Permission, branchId = issue.branch_id) {
  const m = membership(v, branchId);
  return !!m?.grants.some((g) => g.permission === perm && (!g.issue_type || g.issue_type === issue.type));
}

function adminCanManage(v: Viewer, branchId?: string | null) {
  return isSuper(v) || isAdminOf(v, branchId);
}

const isOpen = (issue: IssueDetail) => issue.state === "open";

/** Open and current: not an event that has ended, not work past its
 * deadline. Senders change, resend and delete their own items only then. */
export function senderMayChange(issue: IssueDetail, now = Date.now()) {
  if (!isOpen(issue)) return false;
  if (issue.event && Date.parse(issue.event.ends_at) < now) return false;
  return !issue.work_items.some((w) => w.sla_due_at && Date.parse(w.sla_due_at) < now);
}

/** The sender, while they may still change it. */
const ownAndCurrent = (v: Viewer, issue: IssueDetail) => issue.created_by === v.me.user.id && senderMayChange(issue);

/** A school-wide item (sent to other branches): run by its sender. */
const sentAcross = (issue: IssueDetail) => !issue.branch_id;

/** Edit or close the item itself, beyond the sender's own rights. A
 * school-wide item belongs to its sender, under the rules of the sender's own
 * branches; the receiving branches' admins don't manage it. */
function itemRule(v: Viewer, issue: IssueDetail, perm: Permission) {
  if (!sentAcross(issue)) return adminCanManage(v, issue.branch_id) || grantApplies(v, issue, perm);
  if (isSuper(v)) return true;
  if (issue.created_by !== v.me.user.id) return false;
  return v.me.memberships.some((m) => m.is_admin || grantApplies(v, issue, perm, m.branch.id));
}

export function canEdit(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  return ownAndCurrent(v, issue) || itemRule(v, issue, "issue.edit");
}

export function canClose(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  // Heads close the questions sent to their department.
  const headClose = issue.type === "ticket" && !!issue.branch_id && issue.targets.some((t) => headsDepartment(v, t.department_id));
  return issue.created_by === v.me.user.id || headClose || itemRule(v, issue, "issue.close");
}

/** Soft delete: the sender while open and current; the branch's admins any time. */
export function canDelete(v: Viewer, issue: IssueDetail) {
  if (ownAndCurrent(v, issue) || isSuper(v)) return true;
  return !sentAcross(issue) && isAdminOf(v, issue.branch_id);
}

export function canTarget(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  if (sentAcross(issue)) return isSuper(v) || ownAndCurrent(v, issue);
  return ownAndCurrent(v, issue) || adminCanManage(v, issue.branch_id) || grantApplies(v, issue, "issue.edit");
}

/** The branch the viewer acts in for this item. School-wide items have no
 * branch of their own, so it's the first branch they were sent to that the
 * viewer belongs to. */
export function issueBranch(v: Viewer, issue: IssueDetail): string | undefined {
  if (issue.branch_id) return issue.branch_id;
  const sentTo = [...issue.targets.map((t) => t.branch_id), ...issue.work_items.map((w) => w.branch_id)];
  return sentTo.find((b) => membership(v, b)) ?? sentTo[0];
}

export function canComment(v: Viewer, issue: IssueDetail) {
  const branchId = issueBranch(v, issue);
  const rel = relation(v, issue);
  return isAdminOf(v, branchId) || rel.createdByMe || rel.targetedMe || grantApplies(v, issue, "comment.create", branchId);
}

// Not used while staff-only comments are switched off in the UI.
export function canStaffOnly(v: Viewer, issue: IssueDetail) {
  const branchId = issueBranch(v, issue);
  return isAdminOf(v, branchId) || grantApplies(v, issue, "comment.internal", branchId);
}

export function canModerate(v: Viewer, issue: IssueDetail) {
  const branchId = issueBranch(v, issue);
  return isAdminOf(v, branchId) || grantApplies(v, issue, "comment.moderate", branchId);
}

/** The viewer heads the department: they run what's sent to it. */
export function headsDepartment(v: Viewer, departmentId?: string | null) {
  return !!departmentId && v.me.memberships.some((m) => m.heads.includes(departmentId));
}

/** Work sent to a department the viewer heads. */
function headsWork(v: Viewer, issue: IssueDetail, w: WorkItem) {
  return headsDepartment(v, issue.targets.find((t) => t.id === w.target_id)?.department_id);
}

/** May create, rename and archive the branch's departments and choose heads. */
export function canManageDepartments(v: Viewer, branchId?: string | null) {
  return isAdminOf(v, branchId) || hasGrant(v, branchId, "department.manage");
}

/** May choose who's in the department called `name`. */
export function canChooseMembers(v: Viewer, branchId: string, name: string) {
  if (canManageDepartments(v, branchId)) return true;
  const lower = name.toLowerCase();
  return !!membership(v, branchId)?.manages_members_of.some((d) => d === "*" || d === lower);
}

/** May choose the members of some department of the branch. */
export function choosesMembersSomewhere(v: Viewer, branchId?: string | null) {
  return canManageDepartments(v, branchId) || !!membership(v, branchId)?.manages_members_of.length;
}

export function canApprove(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.status !== "pending_approval") return false;
  if (w.assignee_id === v.me.user.id) return false;
  if (isSuper(v)) return true;
  // Passed along: reviewed one level up the chain first (or by the branch's admins).
  if (w.reviewer_id) return w.reviewer_id === v.me.user.id || isAdminOf(v, w.branch_id);
  // The sender approves what they sent, and so do the branch's approvers.
  if (issue.created_by === v.me.user.id || headsWork(v, issue, w)) return true;
  return isAdminOf(v, w.branch_id) || grantApplies(v, issue, "work_item.approve", w.branch_id);
}

/** Approvable work shown while in a branch: the branch's own, plus what
 *  waits for you personally from elsewhere (items you sent, school-wide
 *  items, work passed on by you). `branchId` null: everything. */
export function waitsHere(v: Viewer, issue: IssueDetail, w: WorkItem, branchId: string | null | undefined) {
  if (!canApprove(v, issue, w)) return false;
  if (!branchId) return true;
  return w.branch_id === branchId || issue.branch_id === branchId || !issue.branch_id || issue.created_by === v.me.user.id || w.reviewer_id === v.me.user.id;
}

/** Approve without the item loaded (approvals queue), used before the issue arrives. */
export function mayApproveIn(v: Viewer, branchId: string) {
  return isAdminOf(v, branchId) || hasGrant(v, branchId, "work_item.approve") || !!membership(v, branchId)?.heads.length;
}

export function canAssign(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.status === "approved" || w.status === "cancelled" || !isOpen(issue)) return false;
  return isAdminOf(v, w.branch_id) || headsWork(v, issue, w) || grantApplies(v, issue, "work_item.assign", w.branch_id);
}

export function canCancelWork(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.status === "approved" || w.status === "cancelled" || !isOpen(issue)) return false;
  return adminCanManage(v, w.branch_id) || issue.created_by === v.me.user.id || headsWork(v, issue, w);
}

export function canClaim(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.assignee_id || w.status !== "open" || issue.completion_mode !== "shared" || !isOpen(issue)) return false;
  const target = issue.targets.find((t) => t.id === w.target_id);
  return target?.kind === "department" && inDepartment(v, target.branch_id, target.department_id);
}

/** Pass work you hold on to someone else in its branch. */
export function canPass(v: Viewer, issue: IssueDetail, w: WorkItem) {
  return isOpen(issue) && w.assignee_id === v.me.user.id && ["open", "in_progress", "blocked"].includes(w.status);
}

/** Pass a question you were asked on to someone else. */
export function canPassTicket(v: Viewer, issue: IssueDetail) {
  return isOpen(issue) && issue.type === "ticket" && issue.targets.some((t) => t.kind === "user" && t.user_id === v.me.user.id);
}

export function isMine(v: Viewer, w: WorkItem) {
  return w.assignee_id === v.me.user.id;
}

/** Kinds the viewer may create in a branch (`null` = school-wide): every
 * kind, for anyone in the branch (or in any branch). */
export function creatableTypes(v: Viewer, branchId: string | null): IssueType[] {
  const all: IssueType[] = ["ticket", "action", "event"];
  if (isSuper(v)) return all;
  if (branchId === null) return v.me.memberships.length ? all : [];
  return membership(v, branchId) ? all : [];
}

/** May send this kind to other people: anyone who may create it. */
export function canSendType(v: Viewer, branchId: string | null, type: IssueType) {
  return creatableTypes(v, branchId).includes(type);
}

/** May send items to people and departments in other branches: everyone. */
export function canSendAcross(v: Viewer) {
  return isSuper(v) || v.me.memberships.length > 0;
}

/** May send an item to the whole of this branch: its admins (and root users). */
export function canTargetWholeBranch(v: Viewer, branchId: string) {
  return isSuper(v) || !!membership(v, branchId)?.is_admin;
}
