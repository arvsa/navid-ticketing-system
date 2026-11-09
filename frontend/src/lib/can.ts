// What the viewer may do, for hiding controls (gap G-20: the API has no per-item
// `can`). The server checks everything; when unsure, these return true and the
// server answers. Rules follow UX_SPEC §3.6 and FRONTEND_PLAN §4.3.
import type { IssueDetail, IssueType, MeResponse, Permission, WorkItem } from "@/api/types";

export type Viewer = {
  me: MeResponse;
  /** Group ids I'm in, per branch id (gap G-4). Missing = unknown. */
  myGroups?: Record<string, string[] | undefined>;
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

/** Holds the permission in the branch at any reach. Used for navigation. */
export function hasGrant(v: Viewer, branchId: string | undefined | null, perm: Permission, type?: IssueType) {
  if (isAdminOf(v, branchId)) return true;
  const m = membership(v, branchId);
  return !!m?.grants.some((g) => g.permission === perm && (!type || !g.issue_type || g.issue_type === type));
}

export function hasGrantAnywhere(v: Viewer, perm: Permission) {
  return isSuper(v) || v.me.memberships.some((m) => m.is_admin || m.grants.some((g) => g.permission === perm));
}

/** How the viewer relates to an item, for grant reach. */
export function relation(v: Viewer, issue: IssueDetail) {
  const myId = v.me.user.id;
  const createdByMe = issue.created_by === myId;
  const targetedMe = issue.targets.some((t) => {
    if (t.kind === "user") return t.user_id === myId;
    if (t.kind === "branch") return !!membership(v, t.branch_id);
    const groups = v.myGroups?.[t.branch_id];
    return groups ? groups.includes(t.group_id ?? "") : false;
  }) || issue.work_items.some((w) => w.assignee_id === myId);
  return { createdByMe, targetedMe };
}

function grantApplies(v: Viewer, issue: IssueDetail, perm: Permission, branchId = issue.branch_id) {
  const m = membership(v, branchId);
  if (!m) return false;
  const rel = relation(v, issue);
  return m.grants.some(
    (g) =>
      g.permission === perm &&
      (!g.issue_type || g.issue_type === issue.type) &&
      (g.scope === "branch" || (g.scope === "own" && rel.createdByMe) || (g.scope === "targeted" && rel.targetedMe)),
  );
}

function adminCanManage(v: Viewer, branchId?: string | null) {
  return isSuper(v) || isAdminOf(v, branchId);
}

const isOpen = (issue: IssueDetail) => issue.state === "open";

/** A school-wide item (sent to other branches): run by its sender. */
const sentAcross = (issue: IssueDetail) => !issue.branch_id;

/** Edit, close or hide the item itself. A school-wide item sent below super
 * admin belongs to its sender, under the rules of the sender's own branches;
 * the receiving branches' admins don't manage it. */
function itemRule(v: Viewer, issue: IssueDetail, perm: Permission) {
  if (!sentAcross(issue)) return adminCanManage(v, issue.branch_id) || grantApplies(v, issue, perm);
  if (isSuper(v)) return true;
  if (issue.created_by !== v.me.user.id) return false;
  return v.me.memberships.some((m) => m.is_admin || grantApplies(v, issue, perm, m.branch.id));
}

/** Everyone runs what they created: edits, closes or cancels it while it's open. */
const createdByMe = (v: Viewer, issue: IssueDetail) => issue.created_by === v.me.user.id;

export function canEdit(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  return createdByMe(v, issue) || itemRule(v, issue, "issue.edit");
}

export function canClose(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  return createdByMe(v, issue) || itemRule(v, issue, "issue.close");
}

export function canTarget(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  if (sentAcross(issue)) return isSuper(v) || (issue.created_by === v.me.user.id && canSendAcross(v, issue.type));
  return adminCanManage(v, issue.branch_id) || grantApplies(v, issue, "issue.target");
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
  return isAdminOf(v, branchId) || isSuper(v) || grantApplies(v, issue, "comment.create", branchId) || issue.created_by === v.me.user.id;
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

export function canApprove(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.status !== "pending_approval") return false;
  if (w.assignee_id === v.me.user.id) return false;
  if (isSuper(v)) return true;
  // Passed along: reviewed one level up the chain first (or by the branch's admins).
  if (w.reviewer_id) return w.reviewer_id === v.me.user.id || isAdminOf(v, w.branch_id);
  // The sender approves what they sent, and so do the branch's approvers.
  if (issue.created_by === v.me.user.id) return true;
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
  return isAdminOf(v, branchId) || hasGrant(v, branchId, "work_item.approve");
}

export function canAssign(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.status === "approved" || w.status === "cancelled" || !isOpen(issue)) return false;
  return isAdminOf(v, w.branch_id) || grantApplies(v, issue, "work_item.assign", w.branch_id);
}

export function canCancelWork(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.status === "approved" || w.status === "cancelled" || !isOpen(issue)) return false;
  return adminCanManage(v, w.branch_id) || issue.created_by === v.me.user.id;
}

export function canClaim(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.assignee_id || w.status !== "open" || issue.completion_mode !== "shared" || !isOpen(issue)) return false;
  const target = issue.targets.find((t) => t.id === w.target_id);
  if (!target || target.kind !== "group") return false;
  const groups = v.myGroups?.[target.branch_id];
  return groups ? groups.includes(target.group_id ?? "") : false;
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

/** Kinds the viewer may create in a branch (`null` = school-wide). */
export function creatableTypes(v: Viewer, branchId: string | null): IssueType[] {
  const all: IssueType[] = ["ticket", "action", "event"];
  if (isSuper(v)) return all;
  if (branchId === null) return all.filter((t) => canSendAcross(v, t));
  return all.filter((t) => hasGrant(v, branchId, "issue.create", t));
}

/** May send this kind to other people (staff can send their own tickets and events). */
export function canSendType(v: Viewer, branchId: string | null, type: IssueType) {
  if (branchId === null) return canSendAcross(v, type);
  if (isSuper(v) || isAdminOf(v, branchId)) return true;
  return hasGrant(v, branchId, "issue.target", type);
}

type Membership = MeResponse["memberships"][number];
const holdsForType = (m: Membership, perm: Permission, type: IssueType) =>
  m.grants.some((g) => g.permission === perm && g.scope === "branch" && (!g.issue_type || g.issue_type === type));

/** May send to other branches or to whole branches from this membership:
 * branch admins always; others with `issue.target_other_branches`. */
function sendsAcrossFrom(m: Membership, type: IssueType) {
  return m.is_admin || holdsForType(m, "issue.target_other_branches", type);
}

/** May send a school-wide item of this kind, to people or whole branches
 * anywhere. Mirrors the server: the cross-branch permission plus the right to
 * create the kind, both in one branch. */
export function canSendAcross(v: Viewer, type: IssueType) {
  if (isSuper(v)) return true;
  return v.me.memberships.some((m) => sendsAcrossFrom(m, type) && (m.is_admin || holdsForType(m, "issue.create", type)));
}

/** May send an item of this kind to the whole of this branch. */
export function canTargetWholeBranch(v: Viewer, branchId: string, type: IssueType) {
  if (isSuper(v)) return true;
  const m = membership(v, branchId);
  return !!m && sendsAcrossFrom(m, type);
}
