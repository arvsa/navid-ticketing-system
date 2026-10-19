// History entries → a readable timeline (UX_SPEC §4.5.5). The vocabulary is
// undocumented (gap G-9), so unknown entries get a plain fallback.
//
// The backend writes one entry per row it touches, so creating a school-wide
// action produces an "issue create", then a "target add" and "work item
// create" per branch. Those are folded into one line here.
import type { HistoryEntry, IssueDetail } from "@/api/types";
import { joinList, quote, t, tn } from "@/i18n";
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
  const another = t("another branch");
  const known = names.filter((n) => n !== another);
  const others = names.length - known.length;
  if (others) known.push(tn(others, "{n} other branch", "{n} other branches"));
  return joinList(known);
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
      if (b) return t("{name}'s part", { name: b });
    }
    return who ? t("{name}'s part", { name: l.person(who) }) : t("an unassigned part");
  };

  const out: HistoryLine[] = [];
  for (let i = 0; i < entries.length; i++) {
    const h = entries[i];
    const actor = h.actor_id ? l.person(h.actor_id) : t("Automatically");
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
      out.push({
        id: h.id,
        at: h.created_at,
        text: recipients.length ? t("{actor} created this and sent it to {names}", { actor, names: list(recipients) }) : t("{actor} created this", { actor }),
      });
      i = j - 1;
      continue;
    }

    const text = describe();
    if (text) out.push({ id: h.id, at: h.created_at, text });

    function describe(): string | null {
      if (h.action === "auto_close") return t("Closed automatically when all the work was approved");
      switch (h.entity_type) {
        case "issue": {
          if (h.action === "cancel") return t("{actor} cancelled this", { actor });
          if (h.action === "close") return t("{actor} closed this", { actor });
          if (!nv) return t("{actor} changed the details", { actor });
          const parts = Object.keys(nv)
            .filter((k) => k !== "version" && k !== "updated_at")
            .map((k) => {
              if (k === "priority") return t("priority to {value}", { value: priorityLabel[nv[k] as keyof typeof priorityLabel] ?? String(nv[k]) });
              if (k === "is_private") return nv[k] ? t("it to private") : t("it to visible");
              if (k === "title") return t("the title to {title}", { title: quote(String(nv[k])) });
              if (k === "state") return nv[k] === "closed" ? t("it to closed") : t("it to {value}", { value: String(nv[k]) });
              if (k === "event") return t("the time or place");
              if (k === "description") return t("the details");
              return k.replace(/_/g, " ");
            });
          return t("{actor} changed {what}", { actor, what: parts.join(t(", ")) || t("the details") });
        }
        case "issue_target":
          return h.action === "remove"
            ? t("{actor} stopped sending this to {name}", { actor, name: l.target(ov ?? nv) })
            : t("{actor} also sent this to {name}", { actor, name: l.target(nv) });
        case "work_item": {
          const assignee = (nv?.assignee_id ?? ov?.assignee_id) as string | undefined;
          const note = typeof nv?.decision_note === "string" ? `: ${quote(nv.decision_note)}` : "";
          const thePart = (a?: unknown) => (schoolWide ? part(h.entity_id, a) : t("the work"));
          switch (h.action) {
            case "create":
              return t("Work added for {who}", { who: assignee ? l.person(assignee) : part(h.entity_id) });
            case "assign":
              return t("{actor} gave {what} to {who}", { actor, what: thePart(), who: l.person(nv?.assignee_id as string) });
            case "claim":
              return t("{actor} picked up {what}", { actor, what: thePart() });
            case "unassign":
              return t("{actor} took the work off {who}", { actor, who: l.person(ov?.assignee_id as string) });
            case "start":
              return actor === l.person(assignee) || !assignee
                ? t("{actor} started their part", { actor })
                : t("{actor} started {what}", { actor, what: part(h.entity_id, assignee) });
            case "block":
              return t("{actor} is blocked on {what}", { actor, what: part(h.entity_id, assignee) });
            case "unblock":
              return t("{actor} is working on {what} again", { actor, what: part(h.entity_id, assignee) });
            case "submit":
              return schoolWide
                ? t("{actor} sent {what} for approval", { actor, what: part(h.entity_id, assignee) })
                : t("{actor} sent their part for approval", { actor });
            case "approve":
              return t("{actor} approved {what}", { actor, what: part(h.entity_id, assignee) });
            case "reject":
              return t("{actor} sent {what} back", { actor, what: part(h.entity_id, assignee) }) + note;
            case "cancel":
              return t("{actor} cancelled {what}", { actor, what: part(h.entity_id, assignee) });
            default:
              return t("{actor} updated {what}", { actor, what: part(h.entity_id, assignee) });
          }
        }
        case "comment":
          if (h.action === "delete") return t("{actor} removed a comment", { actor });
          return h.action === "update" ? t("{actor} edited a comment", { actor }) : t("{actor} commented", { actor });
        case "report":
          if (nv?.submitted_at) return t("{actor} handed in a written report", { actor });
          return h.action === "create" ? t("{actor} started a written report", { actor }) : null; // draft saves are noise
        case "attachment":
          return t("{actor} attached {file}", { actor, file: nv?.file_name ? quote(String(nv.file_name)) : t("a file") });
        case "rsvp":
          return t("{actor} replied to the invitation", { actor });
        default:
          return t("{actor} made a change ({action})", { actor, action: h.action });
      }
    }
  }
  return out;
}
