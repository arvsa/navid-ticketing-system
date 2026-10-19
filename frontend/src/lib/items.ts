// Helpers shared by item screens.
import { useQuery } from "@tanstack/react-query";
import { getAll } from "@/api/client";
import type { Group, IssueDetail, Target, WorkItem } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { UNKNOWN_PERSON, usePeople, type Directory } from "@/people/usePeople";
import { canApprove, canClaim, canComment, isMine, type Viewer } from "./can";

export const numberOf = (key: string) => key.replace(/^ISS-/, "");

/** Groups of every branch in view, by id (for "Sent to Science"). */
export function useGroupDirectory() {
  const { options } = useBranch();
  const ids = options.map((o) => o.id).sort();
  const { data } = useQuery({
    queryKey: ["groups", "directory", ids],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const lists = await Promise.all(
        ids.map((id) => getAll<Group>(`/branches/${id}/groups`, { include_archived: true }).catch(() => [] as Group[])),
      );
      return new Map(lists.flat().map((g) => [g.id, g]));
    },
  });
  return data ?? new Map<string, Group>();
}

export function targetName(t: Target, people: Directory, groups: Map<string, Group>, branchName: (id: string) => string) {
  if (t.kind === "user") return people.short(t.user_id);
  if (t.kind === "group") return groups.get(t.group_id ?? "")?.name ?? "A group";
  return branchName(t.branch_id);
}

/** Mine first, then by status order. */
export function sortWork(items: WorkItem[], myId: string) {
  const order: Record<string, number> = { pending_approval: 0, in_progress: 1, blocked: 2, open: 3, approved: 4, cancelled: 5 };
  return [...items].sort((a, b) => {
    if ((a.assignee_id === myId) !== (b.assignee_id === myId)) return a.assignee_id === myId ? -1 : 1;
    return order[a.status] - order[b.status];
  });
}

export const isSentBack = (w: WorkItem) =>
  (w.status === "in_progress" || w.status === "blocked") && !!w.decided_at && !!w.decision_note;

export const isDone = (w: WorkItem) => w.status === "approved" || w.status === "cancelled";

export type PrimaryAction =
  | { kind: "none" }
  | { kind: "close-question" }
  | { kind: "reply" }
  | { kind: "start"; work: WorkItem }
  | { kind: "claim"; work: WorkItem }
  | { kind: "submit"; work: WorkItem }
  | { kind: "continue"; work: WorkItem }
  | { kind: "write-report"; work: WorkItem }
  | { kind: "review"; count: number; first: WorkItem }
  | { kind: "assign"; work: WorkItem }
  | { kind: "rsvp" }
  | { kind: "edit-event" }
  | { kind: "close-event" }
  | { kind: "comment" };

/** One primary button per item view (UX_SPEC §4.6 matrix; first matching row wins). */
export function primaryAction(issue: IssueDetail, v: Viewer): PrimaryAction {
  if (issue.state !== "open") return { kind: "none" };
  const myId = v.me.user.id;
  if (issue.type === "ticket") return issue.created_by === myId ? { kind: "close-question" } : canComment(v, issue) ? { kind: "reply" } : { kind: "none" };
  if (issue.type === "event") {
    const ended = issue.event ? new Date(issue.event.ends_at).getTime() < Date.now() : false;
    if (issue.event?.my_rsvp != null && !ended) return { kind: "rsvp" };
    if (issue.created_by === myId) return ended ? { kind: "close-event" } : { kind: "edit-event" };
    return { kind: "comment" };
  }
  const mine = issue.work_items.find((w) => isMine(v, w) && !isDone(w));
  if (mine?.status === "open") return { kind: "start", work: mine };
  const claimable = issue.work_items.find((w) => canClaim(v, issue, w));
  if (claimable) return { kind: "claim", work: claimable };
  if (mine?.status === "blocked") return { kind: "continue", work: mine };
  if (mine?.status === "in_progress") return issue.type === "report" ? { kind: "write-report", work: mine } : { kind: "submit", work: mine };
  const waiting = issue.work_items.filter((w) => canApprove(v, issue, w));
  if (waiting.length) return { kind: "review", count: waiting.length, first: waiting[0] };
  if (issue.requires_super_admin_approval && !v.me.user.is_super_admin) {
    const ours = issue.work_items.find((w) => !w.assignee_id && !isDone(w) && v.me.memberships.some((m) => m.is_admin && m.branch.id === w.branch_id));
    if (ours) return { kind: "assign", work: ours };
  }
  return { kind: "comment" };
}

/** Names for one item's people and branches, using what the item tells us
 * when the directory can't (gap G-2): only super admins create school-wide
 * items or approve work that needs a super admin, so those are the School
 * office. Branches outside the viewer's own are counted, not named. */
export function useItemLabels(issue: IssueDetail) {
  const people = usePeople();
  const groups = useGroupDirectory();
  const { branchById, options } = useBranch();
  const branchName = (id?: string | null) =>
    (id && (branchById.get(id)?.name ?? options.find((o) => o.id === id)?.name)) || null;
  const person = (id?: string | null, short = true) => {
    const p = people.get(id);
    if (p) return short ? people.short(id) : people.name(id);
    if (!id) return "Nobody";
    // The backend sets requires_super_admin_approval exactly when a super admin
    // created the item, and only super admins create school-wide items.
    if (id === issue.created_by && (issue.branch_id === null || issue.requires_super_admin_approval)) return SCHOOL_OFFICE;
    if (issue.requires_super_admin_approval && issue.work_items.some((w) => w.decided_by === id)) return SCHOOL_OFFICE;
    return UNKNOWN_PERSON;
  };
  const known: string[] = [];
  let otherBranches = 0;
  for (const t of issue.targets) {
    if (t.kind === "branch") {
      const n = branchName(t.branch_id);
      if (n) known.push(n);
      else otherBranches++;
    } else known.push(targetName(t, people, groups, (id) => branchName(id) ?? "another branch"));
  }
  if (otherBranches) known.push(`${otherBranches} other branch${otherBranches === 1 ? "" : "es"}`);
  const sentTo = known.length <= 1 ? known.join("") : `${known.slice(0, -1).join(", ")} and ${known[known.length - 1]}`;
  return { person, branchName, sentTo };
}

export const SCHOOL_OFFICE = "School office";
