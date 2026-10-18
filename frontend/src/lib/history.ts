// History entries → sentences (UX_SPEC §2.2; vocabulary undocumented, gap G-9).
import type { HistoryEntry } from "@/api/types";
import { priorityLabel, workStatusLabel } from "./labels";

type V = Record<string, unknown> | null | undefined;

export function describeHistory(h: HistoryEntry, name: (id?: string | null) => string): string {
  const actor = h.actor_id ? name(h.actor_id) : "Automatically";
  const nv = (h.new_value ?? null) as V;
  const ov = (h.old_value ?? null) as V;
  const ent = h.entity_type;
  if (h.action === "auto_close") return "Closed automatically when all work was approved";
  if (ent === "issue") {
    if (h.action === "create") return `${actor} created this`;
    if (h.action === "cancel") return `${actor} cancelled this`;
    if (h.action === "close") return `${actor} closed this`;
    if (h.action === "update" && nv) {
      const changes = Object.keys(nv).filter((k) => k !== "version" && k !== "updated_at");
      const parts = changes.map((k) => {
        if (k === "priority") return `priority to ${priorityLabel[nv[k] as keyof typeof priorityLabel] ?? nv[k]}`;
        if (k === "is_private") return nv[k] ? "it to private" : "it to public";
        if (k === "title") return `the title to “${nv[k]}”`;
        if (k === "state") return `it to ${String(nv[k])}`;
        if (k === "event") return "the event time or place";
        return k.replace(/_/g, " ");
      });
      return `${actor} changed ${parts.join(", ") || "the details"}`;
    }
  }
  if (ent === "issue_target") {
    const kind = (nv ?? ov)?.kind;
    const what = kind === "group" ? "a group" : kind === "branch" ? "a branch" : "a person";
    return h.action === "remove" ? `${actor} stopped sending this to ${what}` : `${actor} sent this to ${what}`;
  }
  if (ent === "work_item") {
    const who = nv?.assignee_id ? name(nv.assignee_id as string) : null;
    if (h.action === "create") return who ? `Work created for ${who}` : "Work created, waiting for someone to pick it up";
    if (h.action === "unassign") return `${actor} unassigned some work`;
    if (h.action === "cancel") return `${actor} cancelled an assignment`;
    const status = nv?.status as keyof typeof workStatusLabel | undefined;
    if (status) {
      const s = workStatusLabel[status]?.toLowerCase();
      if (status === "approved") return `${actor} approved ${ov?.assignee_id ? `${name(ov.assignee_id as string)}'s` : "the"} work`;
      if (status === "pending_approval") return `${actor} sent work for approval`;
      if (status === "in_progress" && nv?.decision_note) return `${actor} sent work back: “${nv.decision_note}”`;
      return `${actor} moved work to ${s}`;
    }
    if (who) return `${actor} gave the work to ${who}`;
    return `${actor} updated an assignment`;
  }
  if (ent === "comment") {
    if (h.action === "delete") return `${actor} removed a comment`;
    return `${actor} ${h.action === "update" ? "edited" : "added"} a comment`;
  }
  if (ent === "report") {
    if (nv?.submitted_at) return `${actor} handed in a written report`;
    return `${actor} ${h.action === "create" ? "started" : "updated"} a written report`;
  }
  if (ent === "attachment") return `${actor} attached ${nv?.file_name ? `“${nv.file_name}”` : "a file"}`;
  if (ent === "rsvp") return `${actor} replied to the invitation`;
  return `${actor} made a change (${h.action})`;
}
