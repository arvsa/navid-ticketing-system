// The only place API values are turned into words on screen (UX_SPEC §2, §11).
import type {
  CompletionMode,
  IssueState,
  IssueType,
  Permission,
  Priority,
  RsvpResponse,
  Scope,
  WorkStatus,
} from "@/api/types";
import { t } from "@/i18n";

export const APP_NAME = t("School Ticketing");

export const typeLabel: Record<IssueType, string> = {
  ticket: t("Ticket"),
  action: t("Action"),
  report: t("Report"),
  event: t("Event"),
};

export const typePlural: Record<IssueType, string> = {
  ticket: t("Tickets"),
  action: t("Actions"),
  report: t("Reports"),
  event: t("Events"),
};

export const typePitch: Record<IssueType, string> = {
  ticket: t("Ask a question or make a request"),
  action: t("A task that gets done, then signed off"),
  report: t("Ask for a written report, then approve it"),
  event: t("A date with invitations and replies"),
};

export const stateLabel: Record<IssueState, string> = {
  open: t("Open"),
  closed: t("Closed"),
  cancelled: t("Cancelled"),
};

export const workStatusLabel: Record<WorkStatus, string> = {
  open: t("Not started"),
  in_progress: t("In progress"),
  blocked: t("Blocked"),
  pending_approval: t("Waiting for approval"),
  approved: t("Approved"),
  cancelled: t("Cancelled"),
};

export const priorityLabel: Record<Priority, string> = {
  low: t("Low"),
  medium: t("Medium"),
  high: t("High"),
  critical: t("Critical"),
};

export const modeLabel: Record<CompletionMode, string> = {
  shared: t("one person picks it up"),
  per_member: t("everyone writes their own"),
};

export const modeTitle: Record<CompletionMode, { title: string; help: string }> = {
  per_member: {
    title: t("Everyone gets their own"),
    help: t("Each person gets their own copy to do and submit."),
  },
  shared: {
    title: t("One person picks it up"),
    help: t("One shared task. Whoever claims it first does it for the group."),
  },
};

export const rsvpLabel: Record<RsvpResponse, string> = {
  pending: t("No reply yet"),
  going: t("Going"),
  maybe: t("Maybe"),
  declined: t("Can't go"),
};

export const scopeLabel: Record<Scope, string> = {
  own: t("Their own"),
  targeted: t("Sent to them"),
  branch: t("Whole branch"),
};

/** What a grant's reach means for one permission, in plain words. */
export function reachLabel(perm: Permission, scope: Scope): string {
  if (perm.startsWith("work_item.")) return scope === "branch" ? t("Any work in the branch") : scope === "targeted" ? t("Work sent to them") : t("Their own work");
  if (perm.startsWith("issue.") || perm.startsWith("comment.")) {
    if (scope === "own") return t("Items they created");
    if (scope === "targeted") return t("Items sent to them");
    return t("Any item in the branch");
  }
  return scopeLabel[scope];
}

export const permissionInfo: Record<
  Permission,
  { title: string; help: string; section: PermissionSection }
> = {
  "issue.read": { title: t("See items"), help: t("Items that aren't private. Everyone always sees what they created."), section: "seeing" },
  "issue.read_private": {
    title: t("See private items"),
    help: t("Including ones not sent to them"),
    section: "seeing",
  },
  "comment.internal": {
    title: t("Read and write staff-only comments"),
    help: t("Hidden from everyone without this"),
    section: "seeing",
  },
  "issue.create": { title: t("Create items"), help: t("Start new items of these kinds"), section: "creating" },
  "issue.edit": { title: t("Edit items"), help: t("Title, details, priority and event times"), section: "creating" },
  "issue.target": {
    title: t("Give tasks to others"),
    help: t("Choose who an item goes to, and add people later"),
    section: "creating",
  },
  "issue.close": {
    title: t("Close or cancel items"),
    help: t("Everyone can already close what they created"),
    section: "creating",
  },
  "issue.set_private": { title: t("Mark items private or public"), help: t("Hide items from people they aren't sent to"), section: "creating" },
  "work_item.update": {
    title: t("Update progress"),
    help: t("Start, block and send work for approval"),
    section: "work",
  },
  "work_item.approve": {
    title: t("Approve or send back work"),
    help: t("Never work a super admin sent out, and never their own"),
    section: "work",
  },
  "work_item.assign": {
    title: t("Assign or reassign work"),
    help: t("Hand work to someone, including unassigned work"),
    section: "work",
  },
  "comment.create": { title: t("Comment"), help: t("Join the discussion on items"), section: "work" },
  "comment.moderate": { title: t("Remove other people's comments"), help: t("For keeping discussions tidy"), section: "work" },
  "member.view": { title: t("See the member directory"), help: t("Names and emails of the branch"), section: "people" },
  "member.manage": {
    title: t("Add and remove members, reset passwords"),
    help: t("Not for admins' accounts"),
    section: "people",
  },
  "dashboard.branch": { title: t("See branch-wide numbers"), help: t("On the Home dashboard"), section: "people" },
  "export.run": { title: t("Export the branch to Excel"), help: t("Every export is recorded"), section: "people" },
};

export type PermissionSection = "seeing" | "creating" | "work" | "people";
export const permissionSections: { key: PermissionSection; title: string }[] = [
  { key: "seeing", title: t("Seeing things") },
  { key: "creating", title: t("Creating and managing") },
  { key: "work", title: t("Doing and approving work") },
  { key: "people", title: t("People and data") },
];

const errorCopy: Record<string, string> = {
  unauthenticated: t("You were signed out. Please sign in again."),
  invalid_credentials:
    t("That email and password don't match, or the account is paused. After 5 wrong tries, sign-in pauses for 15 minutes."),
  forbidden: t("You can't do that here. Your permissions may have changed."),
  password_change_required: t("Choose your own password first."),
  origin_mismatch: t("Something's wrong with this browser session. Reload the page."),
  not_invited: t("You're not on the invite list for this event."),
  not_found: t("You don't have access to this, or it no longer exists."),
  version_conflict: t("Someone else changed this while you were editing. Reload it, then try again."),
  already_exists: t("That already exists."),
  email_taken: t("There's already an account with this email."),
  branch_code_taken: t("That code is already used."),
  branch_name_taken: t("That name is already used."),
  group_name_taken: t("That name is already used."),
  grant_exists: t("That's already allowed."),
  target_exists: t("It's already sent to them."),
  already_assigned: t("Someone else picked this up a moment ago."),
  already_member: t("They're already a member here."),
  member_is_admin: t("Remove their admin role first. Super admins can do this."),
  last_admin: t("A branch must always have an admin. Appoint another admin first."),
  last_super_admin: t("There must always be at least one super admin."),
  default_group: t("'All members' can't be renamed, archived or changed by hand."),
  not_a_member: t("They aren't a member of this branch."),
  group_archived: t("This group is archived. Restore it first."),
  issue_not_open: t("This item is closed, so it can't be changed."),
  event_not_open: t("This event is over or cancelled, so replies are closed."),
  invalid_transition: t("This work has moved on. Here's where it stands now."),
  not_assigned: t("Pick this up first, then you can work on it."),
  not_claimable: t("This can't be picked up. It's assigned directly."),
  comment_deleted: t("That comment was removed."),
  report_exists: t("There's already a report for this."),
  report_locked: t("This report was approved, so it can't be changed."),
  not_empty: t("Demo data only loads into an empty database."),
  payload_too_large: t("That file is too big. The limit is 25 MB."),
  invalid_body: t("Something in this form isn't right."),
  invalid_query: t("Something in this filter isn't right."),
  invalid_cursor: t("That page is no longer available. Start again from the top."),
  invalid_limit: t("Something in this filter isn't right."),
  invalid_reference: t("Something this refers to no longer exists."),
  invalid_value: t("One of the values isn't allowed."),
  weak_password: t("Use 8 to 128 characters."),
  password_unchanged: t("Pick a password different from the current one."),
  invalid_current_password: t("The current password isn't right."),
  invalid_email: t("Enter a valid email address."),
  invalid_name: t("Enter a name (it can't be empty)."),
  invalid_timezone: t("Pick a time zone from the list."),
  invalid_branch_code: t("Use 2 to 10 capital letters or digits."),
  invalid_admin: t("The first admin must be an active person."),
  user_inactive: t("A deactivated person can't be made an admin."),
  unknown_permission: t("That permission doesn't exist any more. Reload the page."),
  invalid_scope: t("That reach isn't allowed for this permission."),
  invalid_issue_type: t("That kind can't be chosen for this permission."),
  invalid_title: t("Give it a title (up to 200 characters)."),
  invalid_target:
    t("One of the recipients can't receive this. They may have left, or the group is archived."),
  event_required: t("Events need a date and time."),
  invalid_event: t("Only events have dates and times."),
  invalid_event_range: t("The end must be after the start."),
  invalid_completion_mode: t("Only Actions and Reports can go to everyone separately."),
  invalid_sla: t("Only Actions and Reports have a due date."),
  invalid_reminders: t("Up to 10 reminders, between 1 minute and 4 weeks before."),
  invalid_assignee: t("Pick someone who is an active member of this branch."),
  assignee_required: t("Pick someone to give it to."),
  note_required: t("Add a note so they know what to change."),
  report_required: t("Write and hand in your report first."),
  invalid_work_item: t("That assignment isn't part of this item."),
  invalid_comment: t("Comments can be up to 20,000 characters."),
  too_many_mentions: t("You can mention up to 50 people at once."),
  not_a_report: t("Reports go on Report items."),
  invalid_report: t("Reports can be up to 100,000 characters, and can't be empty."),
  invalid_parent: t("That comment or report can't take files any more."),
  invalid_upload: t("That upload didn't work. Try again."),
  unsupported_type:
    t("That kind of file can't be attached. Use PDF, images, Word, Excel, PowerPoint, OpenDocument, CSV or text."),
  empty_file: t("That file is empty."),
  invalid_response: t("Reply with Going, Maybe or Can't go."),
  invalid_note: t("Notes can be up to 500 characters."),
  invalid_range: t("The end date must be after the start date."),
  export_too_large: t("That's more than 50,000 rows. Try a shorter date range."),
  internal_error: t("Something went wrong on our side. Try again in a moment."),
  network_error: t("Can't reach the server. Check your connection and try again."),
};

export function errorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code && errorCopy[code]) return errorCopy[code];
  return errorCopy.internal_error;
}

export const ERROR_CODES = Object.keys(errorCopy);
