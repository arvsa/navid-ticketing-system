// Sentences for inbox entries (UX_SPEC §4.10). Unknown kinds fall back to
// "Update on ISS-12". Payload fields are undocumented (gap G-8), so clauses
// that need them are dropped when missing.
//
// Each kind is one translatable sentence with {actor} and {item} slots, so
// languages can order the words their own way; the text around the slots
// becomes `before` and `after`.
import type { Notification } from "@/api/types";
import { quote, t } from "@/i18n";
import { UNKNOWN_PERSON } from "@/people/usePeople";
import { formatWhen } from "./dates";
import { SCHOOL_OFFICE } from "./items";
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
  let actor = n.actor_id ? nameOf(n.actor_id) : undefined;
  // Someone the directory doesn't list (another branch, a root user, someone
  // who left): the notification carries their name.
  if (actor === UNKNOWN_PERSON && n.actor_name) actor = n.actor_name;
  // Departments and permissions are run by your branch's admins (whom you know) or super admins.
  if (actor === UNKNOWN_PERSON && (n.kind === "added_to_department" || n.kind === "permissions_changed")) actor = SCHOOL_OFFICE;
  const item = n.issue_title ? quote(n.issue_title) : n.issue_key ?? t("an item");
  const p = (n.payload ?? {}) as Record<string, unknown>;
  const dueWhen = typeof p.sla_due_at === "string" ? formatWhen(p.sla_due_at) : null;
  const startWhen = typeof p.starts_at === "string" ? formatWhen(p.starts_at) : null;
  const due = dueWhen ? t(" · due {when}", { when: dueWhen }) : "";
  const starts = startWhen ? ` · ${startWhen}` : "";
  const status = typeof p.status === "string" ? workStatusLabel[p.status as keyof typeof workStatusLabel] : undefined;
  const group = typeof p.group_name === "string" ? quote(p.group_name) : undefined;
  const department = typeof p.department_name === "string" ? quote(p.department_name) : undefined;

  let sentence: string;
  let suffix = "";
  let tone: NotificationText["tone"] = "info";
  switch (n.kind) {
    case "assigned":
      sentence = p.passed_by ? t("{actor} passed {item} on to you") : t("{actor} gave you {item}");
      suffix = due;
      break;
    case "unassigned":
      sentence = t("You're no longer assigned to {item}");
      break;
    case "mentioned":
      sentence = t("{actor} mentioned you on {item}");
      break;
    case "commented":
      sentence = t("{actor} commented on {item}");
      break;
    case "status_changed":
      sentence = status ? t("{item} is now {status}", { status: status.toLowerCase() }) : t("{item} changed");
      break;
    case "submitted_for_approval":
      sentence = t("{actor} submitted {item} for approval");
      break;
    case "approved":
      sentence = t("{actor} approved your work on {item}");
      tone = "success";
      break;
    case "rejected":
      sentence = t("{actor} sent {item} back to you");
      tone = "danger";
      break;
    case "changed_by_admin":
      sentence = t("{actor} changed your item {item}");
      break;
    case "ticket_created":
      sentence = t("{actor} asked a question: {item}");
      break;
    case "event_invited":
      sentence = t("{actor} invited you to {item}");
      suffix = starts;
      break;
    case "event_updated":
      sentence = t("{item} has a new time or place");
      break;
    case "event_cancelled":
      sentence = t("{item} was cancelled");
      tone = "danger";
      break;
    case "event_reminder":
      sentence = startWhen ? t("Reminder: {item} starts {when}", { when: startWhen }) : t("Reminder: {item} is coming up");
      break;
    case "sla_due_soon":
      sentence = dueWhen ? t("{item} is due {when}", { when: dueWhen }) : t("{item} is due soon");
      break;
    case "sla_breached":
      sentence = t("{item} is now overdue");
      tone = "danger";
      break;
    case "added_to_department":
      sentence = department
        ? actor
          ? t("{actor} added you to {department}", { department })
          : t("You were added to {department}", { department })
        : actor
          ? t("{actor} added you to a department")
          : t("Added you to a department");
      break;
    case "permissions_changed":
      // Sent to branch admins (one notice per save): someone joined or left a
      // department with permissions, a permission group was attached to or
      // detached from a department, its grants changed, or a file was loaded.
      if (typeof p.user_id === "string" && department) {
        sentence = p.removed
          ? t("{actor} removed {person} from {department}", { person: nameOf(p.user_id), department })
          : t("{actor} added {person} to {department}", { person: nameOf(p.user_id), department });
      } else if (group && department) {
        sentence = p.removed
          ? t("{actor} took {group} away from {department}", { group, department })
          : t("{actor} gave {department} the permissions of {group}", { group, department });
      } else if (p.config_import) sentence = t("{actor} loaded a permissions file");
      else sentence = group ? t("{actor} changed what {group} allows", { group }) : t("{actor} changed permissions");
      break;
    default:
      sentence = t("Update on {item}");
  }
  return finish(sentence + suffix);

  function finish(text: string): NotificationText {
    const hasActor = text.includes("{actor}");
    const a = hasActor ? actor ?? t("Someone") : undefined;
    const rest = hasActor ? text.slice(text.indexOf("{actor}") + "{actor}".length) : text;
    const at = rest.indexOf("{item}");
    const before = at < 0 ? rest : rest.slice(0, at);
    const after = at < 0 ? "" : rest.slice(at + "{item}".length);
    const itemText = at < 0 ? undefined : item;
    const plain = `${a ?? ""}${before}${itemText ?? ""}${after}`;
    return {
      actor: a,
      before,
      after,
      item: itemText,
      plain: plain.charAt(0).toUpperCase() + plain.slice(1),
      tone,
    };
  }
}
