import { describe, expect, it } from "vitest";
import { ISSUE_STATES, ISSUE_TYPES, PRIORITIES, RSVP_RESPONSES, SCOPES, WORK_STATUSES } from "@/api/types";
import type { IssueDetail, MeResponse, WorkItem } from "@/api/types";
import { permissionInfo, priorityLabel, rsvpLabel, scopeLabel, stateLabel, typeLabel, workStatusLabel } from "../labels";
import { primaryAction } from "../items";

describe("labels", () => {
  it("has a word for every API value", () => {
    for (const v of ISSUE_TYPES) expect(typeLabel[v]).toBeTruthy();
    for (const v of ISSUE_STATES) expect(stateLabel[v]).toBeTruthy();
    for (const v of WORK_STATUSES) expect(workStatusLabel[v]).toBeTruthy();
    for (const v of PRIORITIES) expect(priorityLabel[v]).toBeTruthy();
    for (const v of RSVP_RESPONSES) expect(rsvpLabel[v]).toBeTruthy();
    for (const v of SCOPES) expect(scopeLabel[v]).toBeTruthy();
    expect(Object.keys(permissionInfo)).toHaveLength(16);
  });
});

const me = (id = "me"): MeResponse => ({
  user: { id, email: "a@b.c", first_name: "A", last_name: "B", is_super_admin: false, must_change_password: false },
  memberships: [{ branch: { id: "br", code: "BR", name: "Branch" }, is_admin: false, joined_at: "", grants: [], heads: [] }],
});
const work = (patch: Partial<WorkItem>): WorkItem => ({
  id: "w", issue_id: "i", target_id: "t", branch_id: "br", assignee_id: "me", status: "open",
  is_overdue: false, handoff_chain: [], version: 1, created_at: "", updated_at: "", ...patch,
});
const issue = (patch: Partial<IssueDetail>): IssueDetail => ({
  id: "i", key: "ISS-1", number: 1, branch_id: "br", type: "action", title: "T", priority: "medium",
  completion_mode: "per_member", state: "open", tags: [], requires_report: false,
  created_by: "boss", created_by_name: "The Boss", version: 1, created_at: "", updated_at: "", targets: [], work_items: [], attachments: [],
  watching: false, muted: false, ...patch,
});

describe("primaryAction", () => {
  const v = { me: me() };
  it("closed items have no primary", () => expect(primaryAction(issue({ state: "closed" }), v).kind).toBe("none"));
  it("ticket creator closes the question", () => expect(primaryAction(issue({ type: "ticket", created_by: "me" }), v).kind).toBe("close-question"));
  it("members who may comment reply to tickets", () => {
    const member = me();
    member.memberships[0].grants = [{ permission: "comment.create", issue_type: null, scope: "branch" }];
    expect(primaryAction(issue({ type: "ticket" }), { me: member }).kind).toBe("reply");
  });
  it("no Reply without permission to comment", () => expect(primaryAction(issue({ type: "ticket" }), v).kind).toBe("none"));
  it("members can reply to a school-wide ticket sent to their branch", () => {
    const member = me();
    member.memberships[0].grants = [{ permission: "comment.create", issue_type: null, scope: "branch" }];
    const ticket = issue({
      type: "ticket",
      branch_id: null,
      targets: [{ id: "t", kind: "branch", branch_id: "br", name: "Branch", branch_name: "Branch", created_at: "" }],
    });
    expect(primaryAction(ticket, { me: member }).kind).toBe("reply");
  });
  it("my unstarted work starts", () => expect(primaryAction(issue({ work_items: [work({})] }), v).kind).toBe("start"));
  it("my action in progress is sent for approval", () =>
    expect(primaryAction(issue({ work_items: [work({ status: "in_progress" })] }), v).kind).toBe("submit"));
  it("my report in progress continues the report", () =>
    expect(primaryAction(issue({ type: "action", requires_report: true, tags: ["report"], work_items: [work({ status: "in_progress" })] }), v).kind).toBe("write-report"));
  it("blocked work continues", () => expect(primaryAction(issue({ work_items: [work({ status: "blocked" })] }), v).kind).toBe("continue"));
  it("approvers review waiting work", () => {
    const admin = me();
    admin.memberships[0].is_admin = true;
    const p = primaryAction(issue({ work_items: [work({ assignee_id: "x", status: "pending_approval" })] }), { me: admin });
    expect(p.kind).toBe("review");
  });
  it("work passed along is reviewed by whoever passed it on", () => {
    const head = me("head");
    const passed = work({ assignee_id: "emp", status: "pending_approval", handoff_chain: ["head", "emp"], reviewer_id: "head" });
    expect(primaryAction(issue({ work_items: [passed] }), { me: head }).kind).toBe("review");
    // The sender waits for the head.
    const sender = me("boss");
    expect(primaryAction(issue({ work_items: [passed] }), { me: sender }).kind).not.toBe("review");
  });
  it("never review your own work", () => {
    const admin = me();
    admin.memberships[0].is_admin = true;
    expect(primaryAction(issue({ work_items: [work({ status: "pending_approval" })] }), { me: admin }).kind).toBe("comment");
  });
});
