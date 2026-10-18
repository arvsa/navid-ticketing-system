// Types used by feature code. They come from the generated schema, with fixes
// where the backend's OpenAPI document is too loose (gap G-21): page items are
// untyped, and several enum fields are plain strings.
import type { components } from "./schema";

type S = components["schemas"];

export type IssueType = S["IssueType"];
export type IssueState = S["IssueState"];
export type WorkStatus = S["WorkStatus"];
export type Priority = S["Priority"];
export type CompletionMode = S["CompletionMode"];
export type RsvpResponse = S["RsvpResponse"];
export type TargetKind = S["TargetKind"];
export type Scope = S["Scope"];
export type Permission = S["Permission"];
export type Transition =
  | "start"
  | "block"
  | "unblock"
  | "submit"
  | "approve"
  | "reject"
  | "claim"
  | "assign"
  | "cancel";

export type Page<T> = { items: T[]; next_cursor?: string | null };

export type UserProfile = S["UserProfile"];
export type BranchRef = S["BranchRef"];
export type Grant = S["Grant"];
export type MembershipView = S["MembershipView"];
export type MeResponse = S["MeResponse"];
export type Branch = S["Branch"];
export type Member = S["Member"];
export type AddedMember = S["AddedMember"];
export type Group = S["Group"];
export type GroupGrant = Omit<S["GroupGrant"], "permission" | "issue_type"> & {
  permission: Permission;
  issue_type?: IssueType | null;
};
export type CatalogEntry = Omit<S["CatalogEntry"], "key" | "allowed_scopes"> & {
  key: Permission;
  allowed_scopes: Scope[];
};
export type SourcedGrant = Omit<S["SourcedGrant"], "permission" | "issue_type"> & {
  permission: Permission;
  issue_type?: IssueType | null;
};
export type EffectivePermissions = Omit<S["EffectivePermissions"], "grants"> & {
  grants: SourcedGrant[];
};

export type Target = S["Target"];
export type TargetInput = S["TargetInput"];
export type WorkItem = S["WorkItem"];
export type AttachmentMeta = S["AttachmentMeta"];
export type RsvpCounts = S["RsvpCounts"];
export type EventView = S["EventDetails"] & {
  my_rsvp?: RsvpResponse | null;
  reminders: number[];
  rsvp_counts: RsvpCounts;
};
export type IssueSummary = Omit<S["IssueSummary"], "type"> & { type: IssueType };
export type IssueDetail = Omit<S["IssueDetail"], "type" | "event"> & {
  type: IssueType;
  event?: EventView | null;
};
export type NewIssue = Omit<S["NewIssue"], "type" | "event"> & {
  type: IssueType;
  event?: (S["EventDetails"] & { reminders?: number[] | null }) | null;
};
export type IssuePatch = S["IssuePatch"];
export type Comment = S["Comment"];
export type Report = S["Report"];
export type Rsvp = S["Rsvp"];
export type RsvpPage = Page<Rsvp> & { counts: RsvpCounts };
export type CalendarEntry = S["CalendarEntry"];
export type HistoryEntry = S["HistoryEntry"];
export type Notification = S["Notification"] & { payload?: Record<string, unknown> | null };
export type Dashboard = S["Dashboard"];
export type BranchNumbers = S["BranchNumbers"];
export type DeleteOutcome = S["DeleteOutcome"];

export const ISSUE_TYPES: IssueType[] = ["ticket", "action", "report", "event"];
export const ISSUE_STATES: IssueState[] = ["open", "closed", "cancelled"];
export const WORK_STATUSES: WorkStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "pending_approval",
  "approved",
  "cancelled",
];
export const PRIORITIES: Priority[] = ["low", "medium", "high", "critical"];
export const RSVP_RESPONSES: RsvpResponse[] = ["pending", "going", "maybe", "declined"];
export const SCOPES: Scope[] = ["own", "targeted", "branch"];
