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

/** Branch admins can't edit, close, approve or cancel work on school-wide items. */
function adminCanManage(v: Viewer, issue: IssueDetail, branchId = issue.branch_id) {
  if (isSuper(v)) return true;
  return isAdminOf(v, branchId) && !issue.requires_super_admin_approval;
}

const isOpen = (issue: IssueDetail) => issue.state === "open";

export function canEdit(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  return adminCanManage(v, issue) || grantApplies(v, issue, "issue.edit");
}

export function canClose(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  const ownerClose = issue.created_by === v.me.user.id && issue.type !== "action";
  return ownerClose || adminCanManage(v, issue) || grantApplies(v, issue, "issue.close");
}

export function canSetPrivate(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  return adminCanManage(v, issue) || grantApplies(v, issue, "issue.set_private");
}

export function canTarget(v: Viewer, issue: IssueDetail) {
  if (!isOpen(issue)) return false;
  return adminCanManage(v, issue) || grantApplies(v, issue, "issue.target");
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
  if (issue.requires_super_admin_approval) return isSuper(v);
  return isAdminOf(v, w.branch_id) || grantApplies(v, issue, "work_item.approve", w.branch_id);
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
  return adminCanManage(v, issue, w.branch_id);
}

export function canClaim(v: Viewer, issue: IssueDetail, w: WorkItem) {
  if (w.assignee_id || w.status !== "open" || issue.completion_mode !== "shared" || !isOpen(issue)) return false;
  const target = issue.targets.find((t) => t.id === w.target_id);
  if (!target || target.kind !== "group") return false;
  const groups = v.myGroups?.[target.branch_id];
  return groups ? groups.includes(target.group_id ?? "") : false;
}

export function isMine(v: Viewer, w: WorkItem) {
  return w.assignee_id === v.me.user.id;
}

/** Kinds the viewer may create in a branch ("" = school-wide, super admins only). */
export function creatableTypes(v: Viewer, branchId: string | null): IssueType[] {
  const all: IssueType[] = ["ticket", "action", "report", "event"];
  if (isSuper(v) || branchId === null) return isSuper(v) ? all : [];
  return all.filter((t) => hasGrant(v, branchId, "issue.create", t));
}

/** May send this kind to other people (staff can send their own tickets and events). */
export function canSendType(v: Viewer, branchId: string | null, type: IssueType) {
  if (isSuper(v) || isAdminOf(v, branchId)) return true;
  return hasGrant(v, branchId, "issue.target", type);
}
