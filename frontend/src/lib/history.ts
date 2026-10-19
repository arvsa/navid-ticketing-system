// History entries → a readable timeline (UX_SPEC §4.5.5). The vocabulary is
// undocumented (gap G-9), so unknown entries get a plain fallback.
//
// The backend writes one entry per row it touches, so creating a school-wide
// action produces an "issue create", then a "target add" and "work item
// create" per branch. Those are folded into one line here.
import type { HistoryEntry, IssueDetail } from "@/api/types";
import { priorityLabel } from "./labels";

type V = Record<string, unknown> | null | undefined;

export type HistoryLabels = {
  person: (id?: string | null) => string;
  branchName: (id?: string | null) => string | null;
  /** Name for a recipient in a target row ({kind, user_id, group_id, branch_id}). */
  target: (v: V) => string;
};

export type HistoryLine = { id: number; text: string; at: string };

function list(names: string[]) {
  const known = names.filter((n) => n !== "another branch");
  const others = names.length - known.length;
  if (others) known.push(`${others} other branch${others === 1 ? "" : "es"}`);
  if (known.length <= 1) return known.join("");
  return `${known.slice(0, -1).join(", ")} and ${known[known.length - 1]}`;
}

export function historyLines(entries: HistoryEntry[], issue: IssueDetail, l: HistoryLabels): HistoryLine[] {
  const work = new Map(issue.work_items.map((w) => [w.id, w]));
  const schoolWide = issue.branch_id === null;
  /** "Ben S.'s part", or "East Campus's part" on school-wide items. */
  const part = (workId: string, assignee?: unknown) => {
    const w = work.get(workId);
    const who = (assignee as string | undefined) ?? w?.assignee_id;
    if (schoolWide && w) {
      const b = l.branchName(w.branch_id);
      if (b) return `${b}'s part`;
    }
    return who ? `${l.person(who)}'s part` : "an unassigned part";
  };

  const out: HistoryLine[] = [];
  for (let i = 0; i < entries.length; i++) {
    const h = entries[i];
    const actor = h.actor_id ? l.person(h.actor_id) : "Automatically";
    const nv = (h.new_value ?? null) as V;
    const ov = (h.old_value ?? null) as V;

    // Creation burst: the item, its recipients and their work, all at once.
    if (h.entity_type === "issue" && h.action === "create") {
      const recipients: string[] = [];
      let j = i + 1;
      while (j < entries.length && entries[j].created_at === h.created_at && entries[j].actor_id === h.actor_id && entries[j].action !== "update") {
        const e = entries[j];
        if (e.entity_type === "issue_target" && e.action === "add") recipients.push(l.target(e.new_value as V));
        else if (!(e.entity_type === "work_item" && e.action === "create")) break;
        j++;
      }
      out.push({ id: h.id, at: h.created_at, text: recipients.length ? `${actor} created this and sent it to ${list(recipients)}` : `${actor} created this` });
      i = j - 1;
      continue;
    }

    const text = describe();
    if (text) out.push({ id: h.id, at: h.created_at, text });

    function describe(): string | null {
      if (h.action === "auto_close") return "Closed automatically when all the work was approved";
      switch (h.entity_type) {
        case "issue": {
          if (h.action === "cancel") return `${actor} cancelled this`;
          if (h.action === "close") return `${actor} closed this`;
          if (!nv) return `${actor} changed the details`;
          const parts = Object.keys(nv)
            .filter((k) => k !== "version" && k !== "updated_at")
            .map((k) => {
              if (k === "priority") return `priority to ${priorityLabel[nv[k] as keyof typeof priorityLabel] ?? nv[k]}`;
              if (k === "is_private") return nv[k] ? "it to private" : "it to visible";
              if (k === "title") return `the title to “${nv[k]}”`;
              if (k === "state") return nv[k] === "closed" ? "it to closed" : `it to ${String(nv[k])}`;
              if (k === "event") return "the time or place";
              if (k === "description") return "the details";
              return k.replace(/_/g, " ");
            });
          return `${actor} changed ${parts.join(", ") || "the details"}`;
        }
        case "issue_target":
          return h.action === "remove" ? `${actor} stopped sending this to ${l.target(ov ?? nv)}` : `${actor} also sent this to ${l.target(nv)}`;
        case "work_item": {
          const assignee = (nv?.assignee_id ?? ov?.assignee_id) as string | undefined;
          const note = typeof nv?.decision_note === "string" ? `: “${nv.decision_note}”` : "";
          switch (h.action) {
            case "create":
              return assignee ? `Work added for ${l.person(assignee)}` : `Work added for ${part(h.entity_id)}`;
            case "assign":
              return `${actor} gave ${schoolWide ? part(h.entity_id) : "the work"} to ${l.person(nv?.assignee_id as string)}`;
            case "claim":
              return `${actor} picked up ${schoolWide ? part(h.entity_id) : "the work"}`;
            case "unassign":
              return `${actor} took the work off ${l.person(ov?.assignee_id as string)}`;
            case "start":
              return `${actor} started ${actor === l.person(assignee) || !assignee ? "their part" : part(h.entity_id, assignee)}`;
            case "block":
              return `${actor} is blocked on ${part(h.entity_id, assignee)}`;
            case "unblock":
              return `${actor} is working on ${part(h.entity_id, assignee)} again`;
            case "submit":
              return `${actor} sent ${schoolWide ? part(h.entity_id, assignee) : "their part"} for approval`;
            case "approve":
              return `${actor} approved ${part(h.entity_id, assignee)}`;
            case "reject":
              return `${actor} sent ${part(h.entity_id, assignee)} back${note}`;
            case "cancel":
              return `${actor} cancelled ${part(h.entity_id, assignee)}`;
            default:
              return `${actor} updated ${part(h.entity_id, assignee)}`;
          }
        }
        case "comment":
          if (h.action === "delete") return `${actor} removed a comment`;
          return h.action === "update" ? `${actor} edited a comment` : `${actor} commented`;
        case "report":
          if (nv?.submitted_at) return `${actor} handed in a written report`;
          return h.action === "create" ? `${actor} started a written report` : null; // draft saves are noise
        case "attachment":
          return `${actor} attached ${nv?.file_name ? `“${nv.file_name}”` : "a file"}`;
        case "rsvp":
          return `${actor} replied to the invitation`;
        default:
          return `${actor} made a change (${h.action})`;
      }
    }
  }
  return out;
}
