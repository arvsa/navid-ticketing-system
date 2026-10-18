// Sentences for inbox entries (UX_SPEC §4.10). Unknown kinds fall back to
// "Update on ISS-12". Payload fields are undocumented (gap G-8), so clauses
// that need them are dropped when missing.
import type { Notification } from "@/api/types";
import { formatWhen } from "./dates";
import { workStatusLabel } from "./labels";

export type NotificationText = {
  actor?: string;
  /** Text before and after the item title. */
  before: string;
  after: string;
  item?: string;
  plain: string;
  tone: "info" | "danger" | "success";
};

export function describeNotification(n: Notification, nameOf: (id?: string | null) => string): NotificationText {
  const actor = n.actor_id ? nameOf(n.actor_id) : undefined;
  const item = n.issue_title ? `“${n.issue_title}”` : n.issue_key ?? "an item";
  const p = (n.payload ?? {}) as Record<string, unknown>;
  const due = typeof p.sla_due_at === "string" ? ` · due ${formatWhen(p.sla_due_at)}` : "";
  const starts = typeof p.starts_at === "string" ? ` · ${formatWhen(p.starts_at)}` : "";
  const status = typeof p.status === "string" ? workStatusLabel[p.status as keyof typeof workStatusLabel] : undefined;
  let before = "";
  let after = "";
  let tone: NotificationText["tone"] = "info";
  let withActor = true;
  switch (n.kind) {
    case "assigned":
      before = "gave you ";
      after = due;
      break;
    case "unassigned":
      withActor = false;
      before = "You're no longer assigned to ";
      break;
    case "mentioned":
      before = "mentioned you on ";
      break;
    case "commented":
      before = "commented on ";
      break;
    case "status_changed":
      withActor = false;
      after = status ? ` is now ${status.toLowerCase()}` : " changed";
      break;
    case "submitted_for_approval":
      before = "submitted ";
      after = " for approval";
      break;
    case "approved":
      before = "approved your work on ";
      tone = "success";
      break;
    case "rejected":
      before = "sent ";
      after = " back to you";
      tone = "danger";
      break;
    case "changed_by_admin":
      before = "changed your item ";
      break;
    case "ticket_created":
      before = "asked a question: ";
      break;
    case "event_invited":
      before = "invited you to ";
      after = starts;
      break;
    case "event_updated":
      withActor = false;
      after = " has a new time or place";
      break;
    case "event_cancelled":
      withActor = false;
      after = " was cancelled";
      tone = "danger";
      break;
    case "event_reminder":
      withActor = false;
      before = "Reminder: ";
      after = starts ? ` starts ${starts.slice(3)}` : " is coming up";
      break;
    case "sla_due_soon":
      withActor = false;
      after = due ? ` is${due.replace(" · ", " ")}` : " is due soon";
      break;
    case "sla_breached":
      withActor = false;
      after = " is now overdue";
      tone = "danger";
      break;
    case "added_to_group":
      before = "added you to a group";
      withActor = !!actor;
      return finish();
    case "permissions_changed":
      before = "changed what a group you're in can do";
      return finish();
    default:
      withActor = false;
      before = "Update on ";
  }
  return finish(true);

  function finish(hasItem = false): NotificationText {
    const a = withActor ? actor ?? "Someone" : undefined;
    const itemText = hasItem ? item : undefined;
    const lead = a ? `${a} ` : "";
    const plain = `${lead}${before}${itemText ?? ""}${after}`;
    return {
      actor: a,
      before: a ? ` ${before}` : before,
      after,
      item: itemText,
      plain: plain.charAt(0).toUpperCase() + plain.slice(1),
      tone,
    };
  }
}
