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

export const APP_NAME = "School Ticketing";

export const typeLabel: Record<IssueType, string> = {
  ticket: "Ticket",
  action: "Action",
  report: "Report",
  event: "Event",
};

export const typePlural: Record<IssueType, string> = {
  ticket: "Tickets",
  action: "Actions",
  report: "Reports",
  event: "Events",
};

export const typePitch: Record<IssueType, string> = {
  ticket: "Ask a question or make a request",
  action: "A task that gets done, then signed off",
  report: "Ask for a written report, then approve it",
  event: "A date with invitations and replies",
};

export const stateLabel: Record<IssueState, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const workStatusLabel: Record<WorkStatus, string> = {
  open: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  pending_approval: "Waiting for approval",
  approved: "Approved",
  cancelled: "Cancelled",
};

export const priorityLabel: Record<Priority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const modeLabel: Record<CompletionMode, string> = {
  shared: "one person picks it up",
  per_member: "everyone writes their own",
};

export const modeTitle: Record<CompletionMode, { title: string; help: string }> = {
  per_member: {
    title: "Everyone gets their own",
    help: "Each person gets their own copy to do and submit.",
  },
  shared: {
    title: "One person picks it up",
    help: "One shared task. Whoever claims it first does it for the group.",
  },
};

export const rsvpLabel: Record<RsvpResponse, string> = {
  pending: "No reply yet",
  going: "Going",
  maybe: "Maybe",
  declined: "Can't go",
};

export const scopeLabel: Record<Scope, string> = {
  own: "Their own",
  targeted: "Sent to them",
  branch: "Whole branch",
};

/** What a grant's reach means for one permission, in plain words. */
export function reachLabel(perm: Permission, scope: Scope): string {
  if (perm.startsWith("work_item.")) return scope === "branch" ? "Any work in the branch" : scope === "targeted" ? "Work sent to them" : "Their own work";
  if (perm.startsWith("issue.") || perm.startsWith("comment.")) {
    if (scope === "own") return "Items they created";
    if (scope === "targeted") return "Items sent to them";
    return "Any item in the branch";
  }
  return scopeLabel[scope];
}

export const permissionInfo: Record<
  Permission,
  { title: string; help: string; section: PermissionSection }
> = {
  "issue.read": { title: "See items", help: "Items that aren't private. Everyone always sees what they created.", section: "seeing" },
  "issue.read_private": {
    title: "See private items",
    help: "Including ones not sent to them",
    section: "seeing",
  },
  "comment.internal": {
    title: "Read and write staff-only comments",
    help: "Hidden from everyone without this",
    section: "seeing",
  },
  "issue.create": { title: "Create items", help: "Start new items of these kinds", section: "creating" },
  "issue.edit": { title: "Edit items", help: "Title, details, priority and event times", section: "creating" },
  "issue.target": {
    title: "Give tasks to others",
    help: "Choose who an item goes to, and add people later",
    section: "creating",
  },
  "issue.close": {
    title: "Close or cancel items",
    help: "Everyone can already close what they created",
    section: "creating",
  },
  "issue.set_private": { title: "Mark items private or public", help: "Hide items from people they aren't sent to", section: "creating" },
  "work_item.update": {
    title: "Update progress",
    help: "Start, block and send work for approval",
    section: "work",
  },
  "work_item.approve": {
    title: "Approve or send back work",
    help: "Never work a super admin sent out, and never their own",
    section: "work",
  },
  "work_item.assign": {
    title: "Assign or reassign work",
    help: "Hand work to someone, including unassigned work",
    section: "work",
  },
  "comment.create": { title: "Comment", help: "Join the discussion on items", section: "work" },
  "comment.moderate": { title: "Remove other people's comments", help: "For keeping discussions tidy", section: "work" },
  "member.view": { title: "See the member directory", help: "Names and emails of the branch", section: "people" },
  "member.manage": {
    title: "Add and remove members, reset passwords",
    help: "Not for admins' accounts",
    section: "people",
  },
  "dashboard.branch": { title: "See branch-wide numbers", help: "On the Home dashboard", section: "people" },
  "export.run": { title: "Export the branch to Excel", help: "Every export is recorded", section: "people" },
};

export type PermissionSection = "seeing" | "creating" | "work" | "people";
export const permissionSections: { key: PermissionSection; title: string }[] = [
  { key: "seeing", title: "Seeing things" },
  { key: "creating", title: "Creating and managing" },
  { key: "work", title: "Doing and approving work" },
  { key: "people", title: "People and data" },
];

const errorCopy: Record<string, string> = {
  unauthenticated: "You were signed out. Please sign in again.",
  invalid_credentials:
    "That email and password don't match, or the account is paused. After 5 wrong tries, sign-in pauses for 15 minutes.",
  forbidden: "You can't do that here. Your permissions may have changed.",
  password_change_required: "Choose your own password first.",
  origin_mismatch: "Something's wrong with this browser session. Reload the page.",
  not_invited: "You're not on the invite list for this event.",
  not_found: "You don't have access to this, or it no longer exists.",
  version_conflict: "Someone else changed this while you were editing. Reload it, then try again.",
  already_exists: "That already exists.",
  email_taken: "There's already an account with this email.",
  branch_code_taken: "That code is already used.",
  branch_name_taken: "That name is already used.",
  group_name_taken: "That name is already used.",
  grant_exists: "That's already allowed.",
  target_exists: "It's already sent to them.",
  already_assigned: "Someone else picked this up a moment ago.",
  already_member: "They're already a member here.",
  member_is_admin: "Remove their admin role first. Super admins can do this.",
  last_admin: "A branch must always have an admin. Appoint another admin first.",
  last_super_admin: "There must always be at least one super admin.",
  default_group: "'All members' can't be renamed, archived or changed by hand.",
  not_a_member: "They aren't a member of this branch.",
  group_archived: "This group is archived. Restore it first.",
  issue_not_open: "This item is closed, so it can't be changed.",
  event_not_open: "This event is over or cancelled, so replies are closed.",
  invalid_transition: "This work has moved on. Here's where it stands now.",
  not_assigned: "Pick this up first, then you can work on it.",
  not_claimable: "This can't be picked up. It's assigned directly.",
  comment_deleted: "That comment was removed.",
  report_exists: "There's already a report for this.",
  report_locked: "This report was approved, so it can't be changed.",
  not_empty: "Demo data only loads into an empty database.",
  payload_too_large: "That file is too big. The limit is 25 MB.",
  invalid_body: "Something in this form isn't right.",
  invalid_query: "Something in this filter isn't right.",
  invalid_cursor: "That page is no longer available. Start again from the top.",
  invalid_limit: "Something in this filter isn't right.",
  invalid_reference: "Something this refers to no longer exists.",
  invalid_value: "One of the values isn't allowed.",
  weak_password: "Use 8 to 128 characters.",
  password_unchanged: "Pick a password different from the current one.",
  invalid_current_password: "The current password isn't right.",
  invalid_email: "Enter a valid email address.",
  invalid_name: "Enter a name (it can't be empty).",
  invalid_timezone: "Pick a time zone from the list.",
  invalid_branch_code: "Use 2 to 10 capital letters or digits.",
  invalid_admin: "The first admin must be an active person.",
  user_inactive: "A deactivated person can't be made an admin.",
  unknown_permission: "That permission doesn't exist any more. Reload the page.",
  invalid_scope: "That reach isn't allowed for this permission.",
  invalid_issue_type: "That kind can't be chosen for this permission.",
  invalid_title: "Give it a title (up to 200 characters).",
  invalid_target:
    "One of the recipients can't receive this. They may have left, or the group is archived.",
  event_required: "Events need a date and time.",
  invalid_event: "Only events have dates and times.",
  invalid_event_range: "The end must be after the start.",
  invalid_completion_mode: "Only Actions and Reports can go to everyone separately.",
  invalid_sla: "Only Actions and Reports have a due date.",
  invalid_reminders: "Up to 10 reminders, between 1 minute and 4 weeks before.",
  invalid_assignee: "Pick someone who is an active member of this branch.",
  assignee_required: "Pick someone to give it to.",
  note_required: "Add a note so they know what to change.",
  report_required: "Write and hand in your report first.",
  invalid_work_item: "That assignment isn't part of this item.",
  invalid_comment: "Comments can be up to 20,000 characters.",
  too_many_mentions: "You can mention up to 50 people at once.",
  not_a_report: "Reports go on Report items.",
  invalid_report: "Reports can be up to 100,000 characters, and can't be empty.",
  invalid_parent: "That comment or report can't take files any more.",
  invalid_upload: "That upload didn't work. Try again.",
  unsupported_type:
    "That kind of file can't be attached. Use PDF, images, Word, Excel, PowerPoint, OpenDocument, CSV or text.",
  empty_file: "That file is empty.",
  invalid_response: "Reply with Going, Maybe or Can't go.",
  invalid_note: "Notes can be up to 500 characters.",
  invalid_range: "The end date must be after the start date.",
  export_too_large: "That's more than 50,000 rows. Try a shorter date range.",
  internal_error: "Something went wrong on our side. Try again in a moment.",
  network_error: "Can't reach the server. Check your connection and try again.",
};

export function errorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code && errorCopy[code]) return errorCopy[code];
  return errorCopy.internal_error;
}

export const ERROR_CODES = Object.keys(errorCopy);
