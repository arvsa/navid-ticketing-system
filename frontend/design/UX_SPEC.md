# UX specification: school ticketing and work-coordination app

Version 0.2 · 17 Oct 2026 · Companion prototype: `prototype.html` (same folder)
Previous version: `frontend/archive/UX_SPEC.2026-10-16.md` (see §13 Changelog)

**Sources, in order of authority**

1. `presentation/product-overview.html` — what the product is and what v1 includes. Everything
   under "Included" is designed here; nothing under "Not yet" is (no email/SMS, no self-service
   password reset, no recurring items, no term-based reporting, no advanced search, no calendar
   sync, no native app).
2. `backend/docs/api.html` — the **latest API** (66 endpoints). Every screen, field, status,
   filter and action below maps to an endpoint listed there. Where a design needs something
   the API does not provide, it is listed in §12 as a **backend gap (G-n)** and the screen
   describes the v1 workaround or leaves the feature out.
3. `presentation/permissions.html`, `presentation/data-model.html` — plain-language rules.

Working product name in the UI: **Staffroom** (placeholder, Q1). Sample data: "Navid School",
branches **North Campus (NTH)**, **South Campus (STH)**, **Riverside (RVS)**; people Leila
Ahmadi (school admin), Omar Rahimi (admin at North, teacher at South), Sara Karimi (science
teacher, North), Daniel Price, Nadia Hosseini, Tom Becker (site manager), Priya Shah (lab
technician).

Markers: **[D-n]** decision log (in §13), **[G-n]** backend gap (§12.1), **[Q-n]** open question (§12.2).

---

## Contents

1. Design principles
2. Vocabulary: API values → words on screen
3. Information architecture and navigation
4. Screen specifications
5. Key user flows ("A week in the app")
6. Status visual language
7. Real-time behaviour
8. Design tokens
9. Component inventory
10. Responsive and accessibility rules
11. Microcopy (errors, empty states, confirmations)
12. Backend gaps and open questions
13. Changelog vs. the 2026-10-16 draft, and decision log

---

## 1. Design principles

1. **"What do I need to do?" first.** Home answers, in order: what is waiting for me, what is
   due, what changed. Branch overviews come after a person's own work, never instead of it.
2. **Talk like a colleague.** Plain words, no system terms: "Waiting for approval", not
   `pending_approval`; "Due Friday", not "SLA"; "Send back", not "reject" (§2).
3. **Show only what you can do.** Controls the person can't use are hidden. When hiding would
   confuse (a branch admin looking at school-wide work), show a one-line reason instead. The
   server checks every action anyway; its 403/404 is always handled gracefully.
4. **One obvious next step.** Each screen and each item has exactly one primary button,
   chosen from type + status + the viewer's relationship to the item (§4.6 matrix).
5. **Live but calm.** Things update themselves without moving what you're reading or typing.
   New things announce themselves with a highlight or a "new updates" pill; toasts are only
   for things addressed to you (§7).
6. **Always know which branch.** Branch context is visible on every screen and one tap away.
   Items show their branch whenever more than one branch is in view.
7. **Nothing disappears.** The backend never deletes: people are deactivated, members leave,
   recipients are removed, items close or cancel. The UI never says "delete" where the
   effect is "archive" or "remove", and explains consequences in plain words.
8. **Built on what exists.** No screen shows data the API can't return. Gaps are listed, not
   faked.

---

## 2. Vocabulary: API values → words on screen

The left column never appears in the UI. The right column is used verbatim.

### 2.1 Core objects

| API / data model | On screen | Notes |
|---|---|---|
| issue | **item** | Nav "Items". Never "issue". |
| `key` `ISS-1042` / `number` | **#1042** | Search accepts `1042`, `#1042`, `ISS-1042` → `GET /issues/by-number/{n}`. [D-02] |
| issue_target | **Sent to** | Events: "Invited". Tickets: "Asked". |
| work_item | **assignment** ("someone's part of the work") | Panel "Assignments". |
| report (issue_report) | **written report** | Button copy uses "report". |
| comment `is_internal_only` | **Staff-only comment** | |
| watch / `watching` | **Follow / Following** | |
| `unread` / `last_read_at` | blue dot + bold title, "Unread" for screen readers | |
| `requires_super_admin_approval` | **School-wide** tag; "Only school admins approve this work." | |
| `branch_id = null` | "All branches" or the list of branch names from targets | |
| user_group | **Group** | |
| group `is_default` | **All members** (lock icon, "Everyone in North Campus") | |
| group `archived_at` | **Archived** | |
| group_permission / grant | "**What this group can do**" | |
| branch_membership `is_admin` | **Admin** (of that branch) | |
| `is_super_admin` | **School admin** | "Super admin" only in docs. [D-06, Q2] |
| member `left_at` | **Left the branch** (date) | |
| user / member `is_active=false` | **Deactivated** | |
| `must_change_password` | Forced "Choose your own password" screen | |
| audit_log / history | **History** | |
| notification | **Inbox**, an "update" | |
| `temporary_password` | **Temporary password** | Shown once. |
| sla_due_at | **Due** "Due Fri 24 Oct, 16:00" | |
| `is_overdue` | **Overdue** "Overdue by 2 days" | |
| `decision_note` | "Note from {approver}" | |
| `decided_by` / `decided_at` | "Approved by Omar · 2 h ago" / "Sent back by Omar" | |

### 2.2 Enums (every value the API defines)

**IssueType** (`ticket, action, report, event`)

| Value | Label | Picker description |
|---|---|---|
| `ticket` | **Ticket** ("Ticket — ask a question") | Ask a question or make a request. Someone answers in the comments. |
| `action` | **Action** | Give someone a task. They do it and send it for approval. |
| `report` | **Report** | Ask for a written report, or file your own. |
| `event` | **Event** | Put something on the calendar and invite people. |

**IssueState** (`open, closed, cancelled`) → **Open / Closed / Cancelled**.

**WorkStatus**

| Value | Label | Helper |
|---|---|---|
| `open` | **Not started** [D-03] | (avoids clashing with item state "Open") |
| `in_progress` | **In progress** | |
| `blocked` | **Blocked** | "Waiting on something before I can continue." |
| `pending_approval` | **Waiting for approval** | |
| `approved` | **Approved** | |
| `cancelled` | **Cancelled** | |

Derived (not statuses): **Sent back** (`in_progress` + `decision_note` + `decided_at`, not
approved), **Not picked up yet** (`assignee_id = null`), **Overdue**, **Due soon** (≤ 24 h).

**Transition** (`POST /work-items/{id}/{transition}`)

| Value | Button | Who sees it |
|---|---|---|
| `start` | **Start** | Assignee |
| `block` | **I'm blocked** | Assignee |
| `unblock` | **Continue** | Assignee |
| `submit` | **Send for approval** (Reports: **Hand in report**) | Assignee |
| `approve` | **Approve** | Approver, never own work |
| `reject` | **Send back** (note required) | Approver |
| `claim` | **I'll take it** | Members of the target group, shared work |
| `assign` | **Assign…** / **Reassign…** | Admins, `work_item.assign` |
| `cancel` | **Cancel this assignment** | Admins only |

**CompletionMode**: `shared` → **One person handles it** ("Anyone in the group can pick it
up."); `per_member` → **Everyone does their own** ("Each person gets their own copy.").

**Priority**: `low` → **Low**, `medium` → **Normal**, `high` → **High**, `critical` →
**Urgent** [D-04]. Low/Normal are not shown in lists.

**RsvpResponse**: `pending` → **Not replied** ("Reply needed" on my own), `going` →
**Going**, `maybe` → **Maybe**, `declined` → **Not going** (button "Can't go").

**TargetKind**: `user` → person chip, `group` → group chip "Science · 8", `branch` → branch
chip "North Campus (whole branch)".

**Scope** (grant reach): `own` → **Their own**, `targeted` → **Sent to them**, `branch` →
**Whole branch**.

**NumbersScope** (dashboard): `branch` → tiles titled with the branch name; `personal` →
tiles titled "Your numbers at North Campus".

**Permission** (catalog keys, `GET /permissions`) — used in the Permission editor and in
"What can I do?" lists.

| Key | Sentence on screen | Reach offered (allowed_scopes) | Per kind? |
|---|---|---|---|
| `issue.read` | See items | Their own · Sent to them · Whole branch | yes |
| `issue.read_private` | See private items | Whole branch | yes |
| `issue.create` | Create items | Whole branch | yes |
| `issue.edit` | Edit title, description, priority and event details | Their own · Whole branch | yes |
| `issue.close` | Close or cancel items | Their own · Whole branch | yes |
| `issue.set_private` | Mark items private or public | Their own · Whole branch | yes |
| `issue.target` | Send items to people and groups | Their own · Whole branch | yes |
| `work_item.update` | Update progress and send work for approval | Sent to them · Whole branch | yes |
| `work_item.assign` | Pick up, assign or reassign work | Sent to them · Whole branch | yes |
| `work_item.approve` | Approve or send back work | Whole branch | yes |
| `comment.create` | Comment | Sent to them · Whole branch | no |
| `comment.internal` | See and write staff-only comments | Whole branch | no |
| `comment.moderate` | Remove other people's comments | Whole branch | no |
| `member.view` | See the member directory | Whole branch | no |
| `member.manage` | Add and remove members, reset passwords (not admins) | Whole branch | no |
| `dashboard.branch` | See branch-wide dashboard numbers | Whole branch | no |
| `export.run` | Export this branch to Excel | Whole branch | no |

Labels are the UI's own; the catalog `description` is shown only as a tooltip fallback if a
new key appears that the UI doesn't know.

**Notification `kind`** (18 values; defined in the database schema, not yet documented in
api.html [G-8]) — wording in §4.9.

`assigned, unassigned, mentioned, commented, status_changed, submitted_for_approval,
approved, rejected, changed_by_admin, ticket_created, event_invited, event_updated,
event_cancelled, event_reminder, sla_due_soon, sla_breached, added_to_group,
permissions_changed`

**Live stream event kinds** (`GET /stream`): `ready, issue_created, issue_updated,
work_item_updated, comment_*, report_*, rsvp_changed, notification, permissions_changed,
member_changed, group_changed, branch_changed, resync, session_ended` — never shown; behaviour
in §7.

**History `action`** (observed values; undocumented [G-9]): `create` "created", `update`
"changed", `cancel` "cancelled", `auto_close` "closed automatically when all work was
approved", `add` "added", `remove` "removed", `unassign` "unassigned", `delete` "deleted"
(comments only: "removed a comment"), `grant` "allowed", `revoke` "stopped allowing",
`export` "exported", `reset_password` "reset the password of". Unknown actions fall back to
"{actor} made a change ({action})".

---

## 3. Information architecture and navigation

### 3.1 App shell (desktop ≥ 1024 px)

```
┌───────────────┬───────────────────────────────────────────────────────────┐
│ [S] Staffroom │ Search items or #number…      ● Live   [🔔 3]  [+ New]   │ top bar 56
│ ┌───────────┐ ├───────────────────────────────────────────────────────────┤
│ │North Camp.▾│ │ Page title                          page actions          │
│ │Admin       │ │                                                           │
│ └───────────┘ │ content (max 1200; detail = main 1fr + side 320)          │
│ Home          │                                                           │
│ My work     4 │                                                           │
│ Approvals   5 │                                                           │
│ Inbox       3 │                                                           │
│ Items         │                                                           │
│ Calendar      │                                                           │
│ ── Manage ──  │                                                           │
│ Members       │                                                           │
│ Groups        │                                                           │
│ Export        │                                                           │
│ ── School ──  │                                                           │
│ Branches      │                                                           │
│ (SK) Sara K. ▴│                                                           │
└───────────────┴───────────────────────────────────────────────────────────┘
```

- **Sidebar** 248 px, collapsible to a 64 px icon rail. Top: logo + name, then the branch
  switcher, then nav, then the account button (Profile, Theme, Sign out).
- **Top bar**: search (`GET /issues?q=`; a number jumps via `/issues/by-number/{n}`), live
  indicator, bell with `GET /notifications/unread-count` (opens a 400 px popover with the 8
  latest + "Open Inbox"), **+ New** (primary).
- Keyboard: `/` search, `n` new, `g h/w/a/i/c` Home/My work/Approvals/Inbox/Calendar, `?`
  shortcut sheet. Disabled while typing.

### 3.2 Phone shell (< 640 px)

```
┌──────────────────────────────┐
│ ☰  North Campus ▾     🔔3    │ top bar 56
├──────────────────────────────┤
│                              │
│  content, single column,     │
│  16 px gutters               │
│                              │
├──────────────────────────────┤
│ Home  My work  (+)  Cal  Inbox│ bottom nav 64 + safe area
└──────────────────────────────┘
```

Bottom nav: **Home · My work · + New · Calendar · Inbox** [D-15]. ☰ opens a drawer: branch
switcher, Approvals (with count), Items, Members, Groups, Export, Branches, Profile, Sign out.
Admins with approvals waiting also see an "Approvals 5" chip on Home (one tap).

Tablet (640–1023): 64 px icon rail + top bar; detail side column moves below main.

### 3.3 Branch context

The switcher shows the current context: branch name, code, and the viewer's role there.

| Person | Switcher | Options |
|---|---|---|
| One branch, not super admin | Static label ("North Campus · Member"), no menu | — |
| Several branches (e.g. Omar: Admin at North, Member at South) | Menu | **All my branches** · North Campus `Admin` · South Campus `Member` |
| School admin | Menu | **Whole school (3 branches)** · each active branch · footer "Manage branches" |

Behaviour
- Source: `GET /me` → `memberships[]` (branch, `is_admin`, `grants`). School admins: `GET /branches`.
- Choice persists in localStorage and in the URL (`?branch=NTH` or `?branch=all`). Item URLs
  (`/items/1042`) don't need it; the item shows its own branch.
- Switching recomputes capabilities for that branch and redraws the nav. Omar at North sees
  Manage; switching to South removes it. No page reload; the page refetches with the new
  `branch_id`.
- In **All / Whole school** context: list endpoints are called without `branch_id`; rows get
  a branch tag; Home shows per-branch rows (§4.3). **Manage** pages are always single-branch:
  opened from "All", they show an in-page branch picker defaulting to the first branch the
  person may manage [D-07].
- Create flow in "All" asks "Create in: North Campus ▾" first.

### 3.4 Navigation per role

"Grant" = the person holds that permission in the current branch (any group, any scope).

| Entry | Route | Staff (All members defaults) | Member with grant | Branch admin | School admin |
|---|---|---|---|---|---|
| Home | `/` | ✓ (own numbers) | ✓ (`dashboard.branch` → branch numbers) | ✓ | ✓ |
| My work | `/my-work` | ✓ | ✓ | ✓ | ✓ |
| Approvals | `/approvals` | – | `work_item.approve` | ✓ | ✓ |
| Inbox | `/inbox` | ✓ | ✓ | ✓ | ✓ |
| Items | `/items` | ✓ | ✓ | ✓ | ✓ |
| Calendar | `/calendar` | ✓ | ✓ | ✓ | ✓ |
| Members | `/members` | read-only directory (`member.view`) | + add/remove if `member.manage` | ✓ | ✓ |
| Groups | `/groups` | read-only list (names, counts) | read-only | ✓ edit | ✓ edit |
| Export | `/export` | – | `export.run` | ✓ own branch | ✓ any / all |
| Branches & admins | `/branches` | – | – | – | ✓ |
| Profile | `/profile` | ✓ | ✓ | ✓ | ✓ |

Counts: My work = `mine.open_work_items`; Approvals = `mine.awaiting_my_approval`; Inbox =
unread count. The "Manage" heading appears only if something under it is editable.

### 3.5 Route map

| Route | Screen |
|---|---|
| `/sign-in`, `/change-password` | 4.1 |
| `/` | 4.2 Home |
| `/my-work` (`?tab=todo|waiting|done&view=list|board`) | 4.3 |
| `/items` (`?type&state&assignee=me&q&view=list|board`) | 4.4 |
| `/items/:number` (`?tab=conversation|history`) | 4.5 Item detail |
| `/items/:number/assignments/:workItemId` | Assignment drawer (4.5.6) |
| `/items/:number/report` | Report editor (4.5.7) |
| `/new?type=&date=&group=` | 4.6 Create |
| `/approvals` | 4.7 |
| `/calendar?view=month|week|agenda&date=` | 4.8 |
| `/inbox?filter=unread` | 4.9 |
| `/members`, `/members/:userId` | 4.10 |
| `/groups`, `/groups/:id/(members|permissions|settings)` | 4.11, 4.12 |
| `/branches`, `/branches/:id` | 4.13 |
| `/export` | 4.14 (dialog over current page) |
| `/items/:number?tab=history`, `/history` (gap) | 4.15 |
| `/profile` | 4.16 |

### 3.6 How the client decides what to show

`GET /me` returns `user` (incl. `is_super_admin`, `must_change_password`) and per-branch
`memberships[]` with `is_admin` and effective `grants` (permission, issue_type or null,
scope). A helper `can(branch, permission, {type, item})` mirrors the server for UI purposes:

1. School admin → yes, except approving own work.
2. Branch admin of that branch → yes, except school-only actions, and edit / close /
   approve / cancel-assignment on items with `requires_super_admin_approval`.
3. Otherwise: any grant with the key, matching `issue_type` (or null) and a scope that
   applies: `own` = I created it; `targeted` = sent to me, to a group I'm in, or assigned to
   me; `branch` = anything in the branch.
4. "Always allowed" rules from the permissions doc: creators may close their own tickets,
   reports and events; invitees may RSVP; everyone sees the branch's groups.

**All members defaults** (from the schema trigger; used for copy and the "Everyday member"
preset): see items (whole branch, non-private) · create Tickets, Reports, Events · edit and
close own items · send own Tickets and Events · update and pick up work sent to them ·
comment (whole branch) · see the member directory.

---

## 4. Screen specifications

Each screen: **Purpose · Data · Layout · Primary action · States · Phone.** Common states:

- **Loading**: skeletons shaped like the content; after 8 s "Still loading… check your
  connection" + Retry. Buttons that wait show a spinner + verb ("Sending…").
- **Error**: inline panel "We couldn't load this. [Try again]" + request id (`x-request-id`)
  in small text. Never a blank page.
- **No access** (404, or 403 on read): "You don't have access to this, or it no longer
  exists." + Go to Home. Never reveals whether a private item exists.

### 4.1 Sign in and forced password change

**Sign in** `/sign-in` — `POST /auth/login`.

```
┌──────────── 400 ────────────┐
│ [S] Staffroom               │
│ Sign in                     │
│ Email      [              ] │
│ Password   [          ] 👁  │
│ [        Sign in          ] │
│ Forgot your password?       │
│ Ask your branch admin to    │
│ reset it.                   │
└─────────────────────────────┘
```

- Primary: **Sign in** (Enter submits). Loading: "Signing in…", fields disabled.
- `401 invalid_credentials` → "That email and password don't match, or the account is
  paused. After 5 wrong tries, sign-in pauses for 15 minutes." (Same text in every case; the
  API never says which.)
- On success: `must_change_password` → `/change-password`; else return URL or Home.
- Phone: full-width card, 16 px gutters; inputs 16 px font.

**Choose your own password** `/change-password` — `POST /me/password`.

- Title "Choose your own password"; body "You signed in with a temporary password. Pick a new
  one that only you know."
- Fields: **New password**, **Confirm new password**. Rule hint: "8 to 128 characters."
  The temporary password typed at sign-in is held in memory (never stored) and sent as
  `current_password`; if the page was reloaded, a third field "Temporary password" appears.
- Primary **Save and continue** → Home. Secondary link **Sign out**.
- Errors: `weak_password` "Use 8 to 128 characters." · `password_unchanged` "Pick a password
  different from the temporary one." · `invalid_current_password` "The temporary password
  isn't right. Ask your admin for a new one."
- Every other API call returns `403 password_change_required` until done; the client
  redirects here on that code.
- From Profile the same form shows "Current password" and notes "This signs you out on
  your other devices."

### 4.2 Home dashboard (live)

**Purpose**: what needs me, what's coming, what changed, for the current context.

**Data**: `GET /dashboard?branch_id=` (omit in All) → `branches[]` (BranchNumbers) +
`mine` (MyNumbers) + `generated_at`; `GET /work-items?assignee=me` (top of My work);
`GET /notifications?limit=6` ("What's new"); `GET /calendar?from=now&to=+14d` (Coming up).
Refetch on `issue_*`, `work_item_updated`, `rsvp_changed`, `notification` (debounced 2 s).

**Tiles** (StatTile; each opens a filtered screen)

| # | Staff (scope `personal`) | Admin / `dashboard.branch` (scope `branch`) | Source |
|---|---|---|---|
| 1 | **My open work** → My work | **Open items** (sum of `open_issues_by_type`, mini split by type) → Items | `mine.open_work_items` / `branches[].open_issues_by_type` |
| 2 | **Overdue** (hidden when 0) | **Overdue** (red edge when > 0) → Items board filtered Overdue | `overdue_work_items` |
| 3 | **Due in the next 7 days** | **Waiting for my approval** → Approvals | `due_next_7_days` / `mine.awaiting_my_approval` |
| 4 | **Events coming up** ("2 need a reply") | **Due in the next 7 days** | `mine.upcoming_events` (count + `my_rsvp = pending`) |
| 5 | — | **Events coming up** | `mine.upcoming_events` |

Nullable numbers (`open_issues_by_type`, `overdue_work_items`, `due_next_7_days`,
`work_items_by_status`) hide their tile when null; `open_public_tickets` is always present
and is used for a staff line "12 open questions in North Campus" [Q8, G-14].

**Layout — admin, desktop**

```
Good morning, Omar                                     ● Live · updated just now
Friday 17 October · North Campus

┌ Open items ┐┌ Overdue ┐┌ Waiting for my ┐┌ Due in next ┐┌ Events in ┐
│ 24         ││ 3   ⚠   ││ approval  5    ││ 7 days  9   ││ 14 days 2 │
│ ▮▮▮▯ by type││         ││ Review →       ││             ││ 1 to reply│
└────────────┘└─────────┘└────────────────┘└─────────────┘└───────────┘
┌ Waiting for your approval (5) ─────────┐ ┌ Coming up ──────────────┐
│ Sara K. · Term 1 science report  [Review]│ │ Thu 23 Oct 18:00        │
│ Daniel P. · Term 1 science report[Review]│ │ Parent evening          │
│ …                         See all 5 →  │ │ 12 going · [Going][Maybe]│
├ Work by status ────────────────────────┤ ├ What's new ─────────────┤
│ ▮▮▮▮▮▮▮▮▮▯▯▯▯ stacked bar + legend     │ │ ● Sara K. sent "Term 1… │
│ Not started 6 · In progress 9 · …      │ │ ● Omar R. mentioned you │
├ Your work (2) ─────────────────────────┤ │ Open Inbox →            │
│ Fire drill · North   Not started [Start]│ └─────────────────────────┘
└────────────────────────────────────────┘
```

- **Main column (admin)**: Waiting for your approval (top 5, Review opens the drawer) → Work
  by status (`work_items_by_status`, stacked bar whose legend links to the board filtered by
  status) → Your work (my assignments, top 5 by due).
- **Main column (staff)**: Your work (next 5 by due: overdue first; each row has its own
  inline primary: Start / Continue / Write report / I'll take it) → "Questions" line with
  `open_public_tickets` linking to Items filtered Tickets.
- **School admin, Whole school**: **Branches at a glance** table built from `branches[]`:
  Branch · Open · Overdue · Due 7 days · Not started / In progress / Waiting. Row click
  switches context to that branch. Then **School-wide work**: open items with `branch_id =
  null` (`GET /issues?state=open` filtered client-side) with "2 of 3 branches approved"
  from `done_count/work_item_count`; expanding fetches `GET /issues/{id}` to show per-branch
  status. Awaiting-approval is only available for the school admin personally
  (`mine.awaiting_my_approval`), not per branch [G-14].
- **Side column**: Coming up (events with inline RSVP for "Not replied") and What's new (6
  latest notifications, unread dots, "Open Inbox"). The overview's activity lines ("Sara K.
  submitted…") are notifications; there is no branch-wide activity feed in the API [G-7].
- **Live**: numbers cross-fade and the tile gets a 1.5 s soft highlight; "Updated just now"
  uses `generated_at`.
- **Empty**: staff with no work: "You're all caught up. Nothing is waiting for you." Admin
  with nothing to approve: tile shows 0 in neutral and the list section is hidden.
- **Error**: tiles show "—" with a single "Couldn't load numbers. Retry" line; lists load
  independently.
- **Phone**: tiles in a 2-column grid (5th tile spans 2); sections stacked: Waiting for your
  approval (admins) → Your work → Coming up → What's new. Work by status collapses to a
  single bar + legend list.

### 4.3 My work

**Purpose**: everything assigned to me, plus shared work I can pick up.

**Data**: `GET /work-items?assignee=me&branch_id=&status=` (one status per call; the To do
tab calls `open`, `in_progress`, `blocked` or loads all and filters client-side). Each row
needs its item's title/type/key: fetched with `GET /issues/{id}` and cached per issue id
[G-1].

**Layout**

```
My work                                         [List | Board]
[ To do 4 ] [ Waiting for approval 1 ] [ Done ]

▸ Up for grabs (1)  — shared work for your groups
  ACTION  Lab inventory check · Lab technicians         [I'll take it]

Overdue
  REPORT  Term 1 science report  #1042   In progress · Sent back   Overdue by 1 day  [Continue report]
This week
  ACTION  Fire drill: North       #1039   Not started     Due Fri 24 Oct          [Start]
Later / No due date …
```

- Tabs: **To do** (Not started, In progress, Blocked) · **Waiting for approval** · **Done**
  (Approved, Cancelled; newest first, paged).
- Row: TypeTile · title · #number · branch tag (All) · StatusBadge · Sent back tag · DueText
  · inline primary button (the same matrix as item detail, §4.6). Row click → item detail,
  scrolled to my assignment.
- **Up for grabs**: shared (`completion_mode = shared`) work with `assignee_id = null` on items
  sent to a group I'm in. v1 workaround: `GET /work-items?status=open&branch_id=` filtered to
  unassigned rows whose issue is shared and targeted at one of my groups (my groups come from
  `GET /branches/{id}/members?group_id=` per group, cached). If the server answers
  `409 not_claimable`/`already_assigned` the row disappears with "Someone else picked this up."
  [G-4].
- **Board** view: columns Not started · In progress · Blocked · Waiting for approval ·
  Approved. Drag allowed only for start/block/unblock. Dropping on "Waiting for approval"
  opens the Send-for-approval dialog; approval columns refuse drops with "Your approver
  decides this." Keyboard: card menu "Move to…".
- **Empty** (To do): "Nothing on your plate. New work appears here the moment it's sent."
  Waiting: "Nothing is waiting for approval." Done: "Finished work will show here."
- **Phone**: list only (board becomes a status segmented control showing one column);
  rows become two-line cards; inline primary becomes a small button on the card's right.

### 4.4 Items list (list / board)

**Purpose**: browse and find items in the current context.

**Data**: `GET /issues?branch_id&type&state&assignee=me&q&limit=50&after`. Returns
IssueSummary: key, title, type, state, priority, is_private, is_overdue, unread,
done_count / work_item_count, last_activity_at, created_by, branch_id.

```
Items  (24)                                   [List | Board]  [Export]  [+ New]
[Open] [Assigned to me] [Tickets] [Actions] [Reports] [Events] [Closed] [Cancelled]
Search titles…           Type ▾   State ▾   ☐ Assigned to me   Branch ▾ (All only)

● TICKET  Where do I order lab supplies?  #1047          North · 2 h ago
  ACTION  Fire drill  #1039  School-wide  High   ▮▮▯▯ 1 of 3   Overdue   1 d ago
  REPORT  Term 1 science report  #1042   ▮▮▮▮▮▯▯▯ 5 of 8 approved      3 h ago
  EVENT   Parent evening  #1050                                   just now
  …                                              [Load more]
```

- **Quick views** (chips, URL-backed; one active): Open (default) · Assigned to me
  (`assignee=me`) · Tickets / Actions / Reports / Events (`type=`, `state=open`) · Closed ·
  Cancelled. The API accepts one `type` and one `state` per call, so chips are
  single-select [G-6].
- **Filters**: Search (title, 300 ms debounce, `q`), Type (single), State (single),
  Assigned to me (toggle), Branch (All context only). "Clear filters". No creator, priority,
  overdue or sort filters in v1 [G-6]. Order: newest first (API order).
- **Row** (desktop table / phone card): unread dot · TypeTile · title (bold if unread) ·
  #number · Private / School-wide / Urgent markers · progress (Actions/Reports:
  mini bar + "5 of 8 approved" from `done_count/work_item_count`) · Overdue tag
  (`is_overdue`) · branch tag (All) · last activity (relative). Rows are real links.
  No "Due" or "Sent to" column: IssueSummary doesn't carry them [G-5].
- **Board** [D-09]: assignments by status from `GET /work-items?branch_id=` (Actions and
  Reports only; note above board: "Tickets and events don't have assignments."). Columns as
  in My work; cards: item title (via issue cache, [G-1]), assignee, due, Sent back tag.
  Admins: card menu Reassign / Cancel assignment.
- **Live**: §7.
- **Empty**: no items at all: "No items yet. Ask a question, send a task or add an event."
  + New. With filters: "Nothing matches these filters." + Clear filters. Search no result:
  "No titles match '{q}'. Try a number like #1042."
- **Phone**: chips scroll horizontally (only horizontal scroller besides board); filter row
  collapses into a "Filters (2)" button opening a bottom sheet; rows are cards (title on
  line 1, type/number/marker on line 2, progress/overdue on line 3).

### 4.5 Item detail (shared layout, adapts per kind)

**Data**: `GET /issues/by-number/{n}` → IssueDetail (targets, work_items, event view,
attachments, `last_read_at`, `watching`, `version`); `GET /issues/{id}/comments`;
`GET /issues/{id}/reports` (reports); `GET /events/{id}/rsvps` (events); on open
`POST /issues/{id}/read`.

```
Items › #1042
REPORT  #1042  ● Open   High   🔒 Private?
Term 1 science report
Created by Omar Rahimi · North Campus · 3 days ago
[ Primary ]  [☆ Follow]  [⋯]
┌ main ─────────────────────────────────┐ ┌ side 320 ─────────────┐
│ Description                           │ │ Details               │
│ Type block (per kind, below)          │ │ Sent to  [Science ·8] │
│ [Conversation] [History]              │ │ Due      Fri 24 Oct   │
│  comments…                            │ │ Priority High         │
│  composer                             │ │ Mode  Everyone own    │
└───────────────────────────────────────┘ │ Files (2)  + Add file │
                                          │ Following  ○○○        │
                                          └───────────────────────┘
```

**Header**: TypeBadge · #number (click copies link) · StateBadge · Priority (High/Urgent) ·
Private · School-wide · Title (24 px; edit via ⋯ → Edit details) · "Created by … · branch ·
time".

**Overflow menu (⋯)** — only allowed entries: Edit details (`PATCH /issues/{id}`), Make
private / public (`issue.set_private`), Send to more people (`POST /issues/{id}/targets`),
Close (`/close`), Cancel (`/cancel`), Copy link. Branch admins on school-wide items see only
Copy link plus the line "Sent by school leadership. You can comment and assign your branch's
part."

**Side column**: Details (Branch · Sent to chips with × for `issue.target` holders: confirm
"Removing Science cancels 3 unfinished assignments. They'll be told." · Due (Actions/
Reports: earliest open work item `sla_due_at`) · Priority · Completion mode · Created ·
Updated) · Files (`attachments`, download `GET /attachments/{id}`, "Add file" →
`POST /issues/{id}/attachments`, 25 MB, accepted types listed in §11) · Follow toggle.

**Main column** = Description (plain text, line breaks, auto-linked URLs, "Show more" after
12 lines) → Type block → Tabs Conversation / History.

#### 4.5.1 Ticket

- Type block: "Asked to: [Lab technicians]" (or "Asked the branch admins" when no
  recipients). Closed: green banner "Answered and closed by Sara Karimi · Tue 21 Oct".
- Primary: creator → **Close question** (confirm "Got your answer? Closing tells everyone
  it's done."); anyone else who may comment → **Reply** (focuses composer).

#### 4.5.2 Action

- Type block: **Assignments panel**: mode line ("Everyone does their own · sent to Science, 8
  people" / "One person handles it · Lab technicians"), segmented progress bar, status filter
  chips with counts, rows: avatar · name ("Not picked up yet" for null assignee) ·
  StatusBadge · Sent back · due/overdue · submitted time · inline Review / Approve for
  approvers. **My row is pinned first and labelled "You".** School-wide items: rows grouped by
  branch; a branch admin sees their branch row with **Assign…** when unassigned.
- Assignment-level comments live in the drawer (§4.5.6).

#### 4.5.3 Report

As Action, plus:
- My assignment: card "Your report" with state Not written / Draft saved {time} / Handed in
  {time} / Approved, and the button Write report / Continue report / View.
- Approvers: rows open the drawer showing the submitted written report.
- **Self-filed report** (no targets, no work items): the type block is the report itself
  (title, body, files) with "Filed by Sara Karimi · Tue 21 Oct" or "Draft — only you can see
  it" before submitting. Primary for the author: **Continue report** (draft) → after filing,
  **Close** (owner close is always allowed).

#### 4.5.4 Event

- **When & where** card: date, time range in the branch timezone (suffix "(UK time)" only if
  the device timezone differs), all-day, location, reminders ("Reminders: 1 day and 1 hour
  before"), organizer.
- **RSVP bar** (invitees: `event.my_rsvp != null`): segmented Going / Maybe / Can't go +
  "Add a note" (≤ 500 chars) → `PUT /events/{id}/rsvp`. Optimistic.
- **Responses** panel: counts from `rsvp_counts` (Going 12 · Maybe 3 · Not going 1 · Not
  replied 5) with avatar stacks; "See everyone" lists `GET /events/{id}/rsvps` (names and
  notes come with each RSVP).
- Cancelled: red banner "Cancelled by Omar Rahimi. Invitees were told." Over: "This event has
  ended." RSVP disabled (`409 event_not_open`).
- Primary: invitee → the RSVP control is the primary element (no button); organizer →
  **Edit event**; after it ends, organizer → **Close event**.

#### 4.5.5 Conversation and History tabs

- **Conversation**: oldest first, composer at the bottom (sticky on phone). Comment: avatar,
  name, time (absolute on hover), "edited", body with @mentions highlighted, attachment chips.
  Own comment: Edit (`PATCH /comments/{id}`) / Delete; moderators (`comment.moderate`, admins):
  Delete on any. Deleted comments keep their place: "This comment was removed."
  Staff-only comments: amber left edge + "Staff only" label.
- **Composer**: auto-grow textarea; `@` opens the mention picker (branch members; ids sent as
  `mention_user_ids`; non-readers are silently dropped by the server, so for private items the
  picker shows a hint "Daniel can't see this item and won't be notified"); attach (uploads
  after the comment is created, with `comment_id`); **Staff only** toggle (only with
  `comment.internal`) tints the whole composer amber; **Comment** (Ctrl/Cmd+Enter). A "New"
  divider marks comments that arrived after opening.
- **History**: `GET /issues/{id}/history` as a day-grouped timeline: icon · sentence built
  from action/entity/old→new (§2.2) · time. "System" as actor for automatic events (e.g.
  `auto_close`). Footer "History can't be edited or deleted."

#### 4.5.6 Assignment drawer (submit / approve / send back)

Route `/items/:n/assignments/:id`, 480 px right drawer (phone: full-screen sheet).
Data: `GET /work-items/{id}`, `GET /issues/{id}/comments?work_item_id=`, the linked report.

```
┌ Sara Karimi · Term 1 science report ─── × ┐
│ ⧗ Waiting for approval · handed in 2 h ago │
│ Due Fri 24 Oct                             │
│ ┌ Written report ───────────────────────┐  │
│ │ Term 1 science report — Year 9        │  │
│ │ Body text…                            │  │
│ │ 📎 results.xlsx                        │  │
│ └───────────────────────────────────────┘  │
│ Timeline: Started · Handed in · …          │
│ Comments on this assignment …              │
│ [composer]                                 │
├────────────────────────────────────────────┤
│ [Send back]                    [ Approve ] │
└────────────────────────────────────────────┘
```

- Assignee: Not started → **Start**; In progress → **Send for approval** (Reports: **Hand in
  report**) + secondary "I'm blocked" (dialog "What's holding you up?" posts an optional
  comment then `block`); Blocked → **Continue** (`unblock`); Waiting → read-only "Sent for
  approval {time}. You'll be told when it's approved."; Unassigned shared → **I'll take it**.
- Send for approval dialog: optional note (posted as assignment comment) + files → `submit`.
  `422 report_required` → "Write and hand in your report first."
- Approver (never the assignee; not branch admins on school-wide items): **Approve**
  (primary, success style; optional note; 5 s Undo toast before the call [D-10]); **Send back**
  (dialog with required note, "Tell Sara what to change" → `reject`). After deciding, "Next
  waiting: Daniel Price →" moves through the queue.
- Admin overflow: **Reassign…** (`assign`, member picker limited to the branch),
  **Cancel this assignment** (`cancel`; confirm "Sara won't need to do this any more.").
- Branch admin on a school-wide item: approve area replaced by "Only school admins approve
  this work."

#### 4.5.7 Report editor

Route `/items/:n/report`. Focused full page.

- Top bar: back "Back to item" · title · autosave status ("Saving…" / "Draft saved 10:42" /
  "Couldn't save — retrying") · **Hand in report** (primary).
- Body: Title (prefilled with the item title), body textarea (plain text, 680 px reading
  width, 17/27), word count, attachments (`report_id`).
- Autosave: `POST /issues/{id}/reports` (with `work_item_id`) on first pause, then
  `PATCH /reports/{id}` after 1.5 s idle and on blur, with `version`.
- **Hand in report**: confirm "Hand in your report? Your approver will be told." →
  `POST /reports/{id}/submit` then `POST /work-items/{id}/submit` [D-12]. Self-filed: only
  the first call; dialog "File this report? Everyone who can see this item can read it."
- Sent back: amber banner with the approver's note at the top; editing stays possible until
  approval (`409 report_locked` afterwards: "This report was approved, so it can't be changed.").
- Conflict: "This report was changed in another window. [Load latest] [Keep mine]".
- Phone: same, sticky top bar; Hand in report as full-width sticky bottom button.

#### 4.5.8 Item detail states

Loading skeleton · no access page · closed/cancelled banners · "This item changed while you
were editing" banner (§7.5) · lost access mid-view: "You no longer have access to this item."

### 4.6 Primary action matrix (one primary per item view)

First matching row wins.

| Kind | Situation | Primary |
|---|---|---|
| any | state closed / cancelled | none (banner) |
| Ticket | I created it | **Close question** |
| Ticket | otherwise, may comment | **Reply** |
| Action / Report | my assignment Not started | **Start** |
| Action / Report | shared, unassigned, I'm in the target group | **I'll take it** |
| Action | mine, In progress | **Send for approval** |
| Action / Report | mine, Blocked | **Continue** |
| Report | mine, no report yet | **Write report** |
| Report | mine, draft | **Continue report** |
| Report | mine, report handed in but work not yet submitted (edge) | **Send for approval** |
| Action / Report | I may approve and N are waiting (not mine) | **Review N waiting** |
| Action / Report | branch admin on school-wide item, my branch's row unassigned | **Assign our part** |
| Report (self-filed) | I'm the author, draft | **Continue report** |
| Report (self-filed) | I'm the author, filed | **Close** |
| Event | invited, not over | RSVP control (no button) |
| Event | I'm the organizer, upcoming | **Edit event** |
| Event | I'm the organizer, ended | **Close event** |
| any | otherwise | **Comment** |

### 4.7 Create flow

Side sheet 720 px (desktop) / full screen (phone). Steps: **Kind → Details → Send to →
Review**. Draft kept in sessionStorage; Esc asks "Discard this draft?".

**Step 0 (inline)**: "Create in: North Campus ▾" when context is All and the person can
create in 2+ branches. School admins also get **"Several branches (school-wide)"** — sets
`branch_id = null`; recipients then must be whole branches (API rule).

**Step 1 — Kind**: 2×2 cards, only kinds allowed by `issue.create` for that branch (staff by
default: Ticket, Report, Event). A staff Report card reads "File a report — write up something
you did or saw." Picking a card advances.

**Step 2 — Details**

| Field | Kinds | Rule / API |
|---|---|---|
| Title * | all | 1–200 chars, counter from 180 (`invalid_title`) |
| Description | all | plain text |
| Priority | all | Low / Normal / High / Urgent, default Normal |
| Due | Action, Report (when sent to others) | date + time; default shown from type: Action now + 3 days, Report now + 7 days ("default: 3 days"); `sla_due_at` |
| Starts *, Ends *, All day, Location | Event | `invalid_event_range` "The end must be after the start." |
| Reminders | Event | chips 1 week / 1 day / 1 hour / 15 min before; default 1 day + 1 hour; max 10 (`invalid_reminders`) |
| Private | all, if `issue.set_private` | "Only the people it's sent to and admins can see it." |
| Files | all | uploaded after creation to the new item |

**Step 3 — Send to** (skipped for self-filed reports and for kinds the person can't send:
staff can send Tickets and Events only)

- Label: "Who should answer?" (Ticket), "Who is this for?" (Action/Report), "Who's invited?"
  (Event).
- RecipientPicker: search + tabs **People · Groups · Branches** (Branches: school admins).
  Groups show member counts; "All members" listed first as "Everyone at North Campus";
  archived groups hidden.
- **How should groups do this?** (Action/Report, when a group/branch is picked): radio cards
  One person handles it (1 assignment per group) / Everyone does their own (N assignments, from
  `member_count`). Note: "People who join the group later won't get one."
- Ticket with nobody: allowed — "Leave empty to ask the branch admins." (Admins always get
  `ticket_created`.) Event with nobody: "Just for my calendar."
- Action/Report sent by an admin need ≥ 1 recipient.

**Step 4 — Review**: plain sentence summary, e.g. "You're sending a **Report** to **Science**
(8 people, everyone does their own). It's due **Fri 24 Oct, 16:00**. 8 people will be
told." Edit links per section. Primary **Send** / **Create event** / **Start writing**
(self-filed report → creates the item and opens the report editor).

On success: toast "Sent. #1063 is on its way." and navigate to the item. 422 codes return to
the step owning the field (`invalid_target` → Send to; `invalid_sla`, `invalid_event_range`
→ Details).

```
Phone, step 3
┌──────────────────────────────┐
│ ×  New report      Step 3/4  │
│ Who is this for?             │
│ [Science ·8 ×]               │
│ Search people or groups…     │
│ [People][Groups]             │
│ ☐ Lab technicians · 3        │
│ ☑ Science · 8                │
│ How should groups do this?   │
│ ○ One person handles it      │
│ ● Everyone does their own (8)│
├──────────────────────────────┤
│ [Back]            [ Next ]   │
└──────────────────────────────┘
```

### 4.8 Approvals queue

Visible with `work_item.approve`, admins, school admins.

**Data**: `GET /work-items?status=pending_approval&branch_id=`; client removes my own work
and, for non-school-admins, items with `requires_super_admin_approval` (needs the issue,
[G-1, G-3]). Count reconciles with `mine.awaiting_my_approval`.

```
Waiting for your approval (5)                       North Campus
▾ REPORT Term 1 science report · 3 waiting
   (SK) Sara Karimi    handed in 2 h ago   "Year 9 results…"   [Review] [Approve]
   (DP) Daniel Price   handed in 5 h ago                       [Review] [Approve]
▾ ACTION Fire drill · 1 waiting   School-wide
   (TB) Tom Becker     sent 1 d ago                            [Review] [Approve]
```

- Grouped by item, oldest submission first. Approve inline with 5 s undo; Review opens the
  drawer. Bulk: checkboxes + "Approve selected (3)" with a confirm listing names. No bulk
  send-back (each needs a note).
- Empty: "No work is waiting for your approval."
- Phone: groups as cards; Approve/Review side by side, full width.

### 4.9 Calendar and event RSVP

**Data**: `GET /calendar?from&to&branch_id` (≤ 366 days) → CalendarEntry with `my_rsvp`,
`organizer_id`, state, location, all_day. Optional overlay of my due dates from
`GET /work-items?assignee=me` [D-13].

- Header: Calendar · Today · ‹ › · range label · **Month / Week / Agenda** · + New event.
- Filter chips: **Needs a reply (n)** (`my_rsvp = pending`) · Going · All · "Show my due
  dates" toggle.
- Month grid (weeks start Monday): up to 3 chips per day then "+2 more". Chip style by my
  response (§6.4). Click empty day → New event with the date prefilled.
- Week: 07:00–19:00 time grid, all-day row; Agenda: next 60 days by day, inline RSVP.
- **Event popover** (phone: bottom sheet): title, time, location, organizer, counts (fetched
  `GET /events/{id}/rsvps` on open [G-15]), RSVP segmented control + note, "Open event".
- Cancelled events: struck through with "Cancelled".
- Empty range: "Nothing on the calendar this month."
- Phone: Agenda is default; Month shows dots per day and a day list below.

```
October 2026                 [Month|Week|Agenda]  [+ New event]
Needs a reply (1)  Going  All      ☑ Show my due dates
 Mon  Tue  Wed  Thu  Fri  Sat  Sun
 …    21   22   23   24
           ┆Parent┆ ⏰Due:
           ┆evening┆ Fire drill
```

### 4.10 Inbox (notifications)

**Data**: `GET /notifications?unread=&after=`, `POST /notifications/{id}/read`,
`POST /notifications/read-all`, `GET /notifications/unread-count`.

- Header: Inbox · tabs All / Unread (n) · **Mark all as read**.
- Grouped Today / Yesterday / This week / Earlier; infinite scroll.
- Row: kind icon in a 32 px circle · sentence (actor bold, item `issue_key` + `issue_title`
  link) · branch tag (All) · time · unread dot. Click → marks read (optimistic) → opens the
  item (`issue_id`), the assignment drawer (`work_item_id`), or the group page.
- Footer: "Read updates are kept for 90 days."
- Empty: All "No updates yet. New work, mentions and reminders will show here." · Unread
  "You've read everything."

| kind | Icon | Sentence (`{actor}` bold, `{item}` link) |
|---|---|---|
| `assigned` | user-plus | {actor} gave you {item} · due {date} |
| `unassigned` | user-minus | You're no longer assigned to {item} (admin variant: "{item} needs a new assignee") |
| `mentioned` | at-sign | {actor} mentioned you on {item} |
| `commented` | message | {actor} commented on {item} |
| `status_changed` | refresh | {item} is now {status} |
| `submitted_for_approval` | hourglass | {actor} sent {item} for your approval |
| `approved` | check-circle | {actor} approved your work on {item} |
| `rejected` | undo | {actor} sent {item} back to you |
| `changed_by_admin` | pencil | {actor} changed your item {item} |
| `ticket_created` | question | {actor} asked a question: {item} |
| `event_invited` | calendar-plus | {actor} invited you to {item} · {when} **[Going] [Maybe] [Can't go]** |
| `event_updated` | calendar-clock | {item} has a new time or place |
| `event_cancelled` | calendar-x | {item} was cancelled |
| `event_reminder` | alarm | Reminder: {item} starts {when} |
| `sla_due_soon` | clock | {item} is due {tomorrow / at 16:00} |
| `sla_breached` | alert | {item} is overdue (admin: "{person}'s work on {item} is overdue") |
| `added_to_group` | users | You were added to {group} |
| `permissions_changed` | shield | What {group} can do was changed by {actor} |

Values in `{}` beyond actor/item come from `payload`, whose shape is undocumented [G-8]; when
a field is missing the sentence drops that clause ("{actor} gave you {item}").
Actor names need the directory [G-2]; `actor_id = null` → "Staffroom".

### 4.11 Members

**Data**: `GET /branches/{id}/members?group_id=&include_left=`, `POST`, `PATCH`, `DELETE`
on members, `GET …/effective-permissions`, `PATCH /users/{id}/active`,
`POST /users/{id}/reset-password`.

- List: search (client-side), tabs **Current · Left the branch** (admins only), group filter.
  Columns: name + avatar, email, Admin badge, Deactivated tag, joined. Phone: cards.
- Staff see a read-only directory (name, email, role badge).
- **Add member** (admins, `member.manage`): Email → First / Last name (required for new
  accounts) → **Add member**. Result: existing account → "Sara Karimi was added to North
  Campus."; re-joined → "Welcome back — Jamie is a member again." (admins only); new →
  TempPasswordReveal "Give this to Jamie in person. They'll choose their own password when
  they first sign in. It won't be shown again." [Copy].
- **Member page** `/members/:id`: header (name, email, role here); **Groups** (from member
  lists per group); **What can they do here?** — effective permissions in sentences with
  source group chips ("from Science, All members"; admins: "Admin of North Campus — can do
  everything here except school-level tasks"); actions: Edit name/email · Reset password ·
  Remove from branch ("Jamie's unfinished work here becomes unassigned and you'll be asked to
  hand it on.") · Deactivate account (single-branch non-admins; school admins for others) ·
  Reactivate.
- Reasons instead of buttons: managers on admins "Admins are managed by school admins.";
  removing an admin → "Remove their admin role first (school admins can do this)."
  (`409 member_is_admin`).
- Empty search: "No one matches '{q}'."

### 4.12 Groups and the permission editor

**Data**: `GET /branches/{id}/groups?include_archived`, `POST`, `PATCH /groups/{id}`,
`DELETE /groups/{id}` (→ DeleteOutcome deleted/archived), members via
`PUT/DELETE /groups/{id}/members/{user_id}` and `GET /branches/{id}/members?group_id=`,
grants via `GET/POST /groups/{id}/permissions`, `DELETE /group-permissions/{id}`, catalog
`GET /permissions`.

**Groups list**: cards (2 cols desktop / 1 phone): name, description, member count, capability
summary in words ("Can approve work · Can export"). All members pinned first with lock.
Archived under a collapsed section with Restore. **+ New group** (name, description, start
from a template). Staff see the list read-only (names, descriptions, counts).

**Group page** tabs: **Members · What they can do · Settings**. Header button "Send work to
this group" (→ /new?group=).
- Members: list + Add people (multi-select of branch members not in the group) + remove ×.
  All members: read-only "Everyone in the branch is in this group automatically."
- Settings: rename, description, **Delete group** — dialog: "If this group was ever sent work
  it will be archived instead, so its history stays." All members: no rename/delete
  (`409 default_group`).

**Permission editor ("What they can do")**

```
Coordinators · What they can do                         [Check a person ▾]
Start from: [Everyday member] [Approver] [Coordinator] [Office & data] [Empty]

Seeing things
 ● See items                    Reach [Their own|Sent to them|Whole branch]  Kinds: All ▾
 ○ See private items            Whole branch                                 Kinds: All ▾
 ● See staff-only comments …    Whole branch
Creating & managing
 ● Create items                 Whole branch                                 Kinds: Actions, Reports
 …
Doing & approving work
 ● Approve or send back work    Whole branch     Powerful                    Kinds: Reports
▸ Things only admins can do (locked)

┌ 2 changes · applies right away to 4 people     [Discard] [Save changes] ┐
```

- One row per catalog key (§2.2 table), grouped: Seeing things · Creating & managing · Doing &
  approving work · Conversation · People & data.
- Row controls: switch · Reach segmented control (only `allowed_scopes`; hidden when one) ·
  Kinds chips "All kinds" or any of Tickets / Actions / Reports / Events (only when
  `per_issue_type`) · ⓘ example.
- Mapping: on + All kinds + reach X → one grant `(key, null, X)`; specific kinds → one grant
  per kind. Existing grants that don't fit the simple form (different reach per kind) show
  a "Custom: Reports — Whole branch, Actions — Sent to them" line with an expand-to-grid.
- **Templates** preview their changes (not saved until Save). Everyday member = All members
  defaults; Approver = see private, staff-only comments, approve (Actions & Reports, whole
  branch); Coordinator = Approver + create Actions, send to anyone, edit/close any, assign,
  manage members, branch dashboard; Office & data = branch dashboard + export.
- **Save bar** (sticky) → confirm in sentences: "Coordinators will now be able to: approve
  or send back Reports. Will no longer be able to: export to Excel." Save = diff →
  sequential `POST`/`DELETE` calls; a partial failure shows which rows saved and which
  didn't, with Retry [G-13]. `409 grant_exists` is treated as success.
- **Locked** (collapsed): create/edit/delete groups; change group members; change what groups
  can do; appoint admins; manage branches; approve school-wide work; export several
  branches; cancel one person's assignment. Lock icon, no controls.
- **Check a person** (right column; phone: below): member picker →
  `effective-permissions` list with source group chips, rows coming from this group
  highlighted.
- All members: banner "These are the everyday permissions everyone in North Campus gets.
  Changes affect all 42 people." Only "Reset to recommended defaults" template.
- Phone: rows stack (name + switch on line 1, reach and kinds below); save bar sticks above
  the bottom nav.

### 4.13 Branches and admins (school admins)

**Data**: `GET/POST /branches`, `PATCH /branches/{id}`, `PUT/DELETE
/branches/{id}/admins/{user_id}`, `PUT/DELETE /users/{id}/super-admin`.

- **Branches list**: Code · Name · Timezone · Admins (from members with `is_admin`) · Status
  (Active / Closed). **+ New branch**.
- **New branch** dialog: Code (2–10 uppercase letters/digits, auto-uppercased), Name, Timezone
  (searchable IANA list, default Europe/London), Email (optional), **First admin** (required,
  existing active person; picker built from all branches' member lists [G-12, G-26]). Help:
  "Every branch needs an admin. You can add more later." Errors: `branch_code_taken`,
  `branch_name_taken`, `invalid_timezone`, `invalid_admin`, `user_inactive`.
- **Branch page**: Settings card (name, code, timezone, email, **Close branch** = `is_active
  false`, confirm: "People can't work in North Campus any more. History stays."), Admins card
  (list, **Appoint admin** from any person, **Remove admin role**; last admin → disabled with
  "A branch must always have an admin. Appoint another admin first."), quick links to that
  branch's Home, Members, Groups.
- **School admins** card (on `/branches`): **Make someone a school admin** (person picker) and
  **Remove school admin role**; listing current school admins needs [G-12] — v1 shows people
  found as `is_super_admin` among loaded directories, plus "you". Last one: `409
  last_super_admin` "There must always be at least one school admin."
- Phone: list as cards; dialogs full screen.

### 4.14 Export

Modal (phone: full screen). `GET /exports?branch_ids&types&from&to` → .xlsx download.

- **Branches**: branch admin / `export.run`: fixed text "North Campus". School admins:
  checkboxes per branch + "All branches" (omits `branch_ids`).
- **Include**: Tickets, Actions, Reports, Events (all on).
- **Dates**: chips This month · Last month · Last 3 months · Since 1 September · Custom
  (from/to). Exports use date ranges, not terms (overview "Not yet").
- Note: "Private items and staff-only comments are included only if you can see them. This
  export is recorded in the history."
- Primary **Download Excel file** → "Preparing your file…" → browser download → toast
  "Export downloaded". `422 export_too_large` "That's more than 50,000 rows. Try a shorter
  date range." `invalid_range` "The end date must be after the start date."

### 4.15 Activity history

- **Per item** (supported): History tab (§4.5.5).
- **Branch / school activity** (`/history`) — designed but **not built in v1**: needs
  `GET /audit` [G-7]. Planned layout: filters (who, what: items / groups & permissions /
  members & admins / exports, date range) and the same timeline component. Until then,
  admins learn of permission changes through `permissions_changed` notifications, and the
  nav entry is hidden.

### 4.16 Profile

- Name, email (read-only: "Ask your admin to change these."), last sign-in.
- **My branches**: role per branch.
- **What I can do**: per branch, sentences from `/me` grants; "Where does this come from?"
  opens `GET /branches/{id}/members/{me}/effective-permissions` with group chips.
- **Password**: change form (§4.1).
- **Appearance**: Theme System / Light / Dark; Text size Normal / Large (16 → 18 px root);
  Reduce motion (follows OS, override).
- **Sign out** (`POST /auth/logout`).

---

## 5. Key user flows — "A week in the app"

Each beat is walkable end to end in the designed screens.

### Monday (1): school admin sends a fire-drill Action to every branch

1. Leila (school admin) → switcher **Whole school** → **+ New** → Create in **Several
   branches (school-wide)** → **Action**.
2. Details: "Termly fire drill and evacuation log", due Fri 24 Oct 16:00, High.
3. Send to → **Branches** tab → North, South, Riverside → mode **One person handles it**
   (one assignment per branch).
4. Review: "Sent to 3 branches. Each branch admin assigns their part. Only school admins
   approve the results." → **Send** (`POST /issues`, `branch_id: null`, branch targets).
5. Each branch admin: toast + Inbox "Leila Ahmadi gave you Fire drill" (`assigned`), Home
   tile updates live.

### Monday (2): North admin assigns the drill and requests a term report

1. Omar opens Fire drill → banner "Sent by school leadership…" → primary **Assign our part**
   → picks Tom Becker (`POST /work-items/{id}/assign`). Tom is notified.
2. **+ New → Report** "Term 1 science report", due Fri 24 Oct → Send to **Science (8)** →
   **Everyone does their own (8 assignments)** → Send. Item shows 8 rows, Not started.

### Tuesday: a teacher's question to Lab technicians

1. Sara → **+ New → Ticket** "Where do I order lab supplies?" → Who should answer? **Lab
   technicians** → Send. Branch admins get `ticket_created`.
2. Priya (technician) opens it (Inbox/Items) → primary **Reply** → comment with @Sara.
3. Sara gets `mentioned` toast → reads → primary **Close question** → confirm → Closed banner.

### Wednesday: Parent evening event and RSVPs

1. Omar → Calendar → clicks Thu 23 Oct → **New event** prefilled → title "Parent evening",
   18:00–20:30, Main hall, reminders 1 day + 1 hour → Who's invited? **All members (42)** →
   **Create event**.
2. Staff get `event_invited` with inline **Going / Maybe / Can't go** in Inbox; Sara taps
   Going (optimistic). Responses panel and Home "12 of 15 going" update live (`rsvp_changed`).
3. Wed 18:00: `event_reminder` arrives for everyone who hasn't declined.

### Thursday: reports handed in, approved, one sent back

1. Sara → My work → Term 1 science report → **Write report** → editor autosaves → **Hand in
   report** → status Waiting for approval.
2. Omar → Home tile "Waiting for my approval 5" → Approvals → Review → **Approve** (undo 5 s)
   → "Next waiting →"; for Daniel → **Send back** with note "Please add the Year 9 results."
3. Daniel sees `rejected` → item banner with the note → Continue report → hands in again.
4. Home "Work by status" shows 2 Not started; those teachers receive `sla_due_soon` the day
   before the deadline (automatic; no UI action).

### Friday: drills approved, end-of-term export

1. Tom submits the drill (Send for approval + note + photo). Leila's Approvals shows one row
   per branch (school-wide group) → approves all three (bulk confirm). The item closes by
   itself (`auto_close` in History).
2. End of term: Omar → Export → North Campus · Reports only · "Since 1 September" →
   **Download Excel file**.

---

## 6. Status visual language

Colour is never the only signal: every badge = **icon + word** (+ shape for RSVP chips).
Icons are drawn as simple inline SVGs (names below refer to Lucide equivalents).

### 6.1 Item kinds

| Kind | Icon | Light fg / bg | Dark fg / bg |
|---|---|---|---|
| Ticket | message-circle-question | #0B6A9A / #E3F2FA | #7CC4EC / #13303F |
| Action | square-check | #6D3FC8 / #F0EAFC | #B9A0F5 / #2A2142 |
| Report | file-text | #9A5B00 / #FCF1DE | #F2C27A / #3A2B12 |
| Event | calendar | #1E7A4C / #E2F4EA | #7FD3A6 / #14321F |

### 6.2 Assignment status

| Status | Text | Icon | Light fg / bg | Dark fg / bg |
|---|---|---|---|---|
| open | Not started | circle (outline) | #4A505C / #EEEDEA | #B4BAC6 / #262B35 |
| in_progress | In progress | circle-half | #1F4FC4 / #E6EDFD | #9DB5FF / #1C2747 |
| blocked | Blocked | octagon-pause | #B42318 / #FDECEA | #FF9C92 / #3D1A17 |
| pending_approval | Waiting for approval | hourglass | #8A5300 / #FFF3D6 | #FFCB6B / #3A2C0C |
| approved | Approved | circle-check | #1B7A43 / #E3F5EA | #7FD3A6 / #14321F |
| cancelled | Cancelled | circle-x | #646A78 / #F0EFEC | #8D94A2 / #232831 |

Derived tags: **Sent back** (undo icon, danger outline), **Overdue** (alert-triangle, danger
text "Overdue by 2 days"), **Due soon** (clock, warning text "Due tomorrow"), **Not picked up
yet** (dashed outline, hand icon).

Progress bar: segments approved (green) · waiting (amber) · in progress (blue) · blocked
(red) · not started (grey track), 2 px gaps, plus text "5 of 8 approved · 2 waiting".

### 6.3 Item state and priority

| Value | Treatment |
|---|---|
| Open | green dot + "Open" (detail only) |
| Closed | check + "Closed", neutral; list row text-2 |
| Cancelled | ban + "Cancelled", neutral; title struck through in lists |
| High | arrow-up "High", orange #B54708 / #FEF0E1 |
| Urgent | alert-octagon "Urgent", white on #C4320A; row gets 3 px red left edge |

### 6.4 RSVP

| Response | Badge | Calendar chip |
|---|---|---|
| Not replied | dashed circle "Not replied" (mine: "Reply needed", primary) | dashed outline |
| Going | check "Going", event green | solid event colour |
| Maybe | help-circle "Maybe", amber | 45° stripes |
| Not going | x "Not going", neutral | 50 % opacity, time struck through |
| (organizer) | user-cog "Organizer" | solid + small dot |

### 6.5 Markers

Private (lock, slate), Staff only (eye-off, amber edge + tinted card), School-wide (building,
primary-soft), Unread (8 px primary dot + bold), Following (filled bell), Powerful
(warning tag on permission rows), Admin (shield, neutral), Deactivated (strikethrough
avatar, "Deactivated").

---

## 7. Real-time behaviour

Source: `GET /stream` (SSE). Events carry ids only; the client refetches via normal
endpoints (so nothing private can leak). Debounce refetches to once per 2 s per query;
refetch everything visible on (re)connect and on `resync`; ~60 s of silence = dead
connection → reconnect with backoff (1, 2, 5, 10, 30 s).

### 7.1 Connection indicator

**Live** (green dot) · **Reconnecting…** (amber, after 5 s disconnected) · **Offline** (grey,
banner after 30 s: "You're offline. Changes won't save until you reconnect.").

### 7.2 What updates how

| Surface | Silent update in place (with 1.5 s highlight) | "New updates" pill | Toast |
|---|---|---|---|
| Home tiles | always (number cross-fade) | — | — |
| Home lists | when at top and idle | when scrolled or focus inside | — |
| Items / My work / Approvals lists | changed rows update in place; new rows insert at top only when scrolled to top and no filter field focused | "3 new updates · Show" pinned at top otherwise; removed rows collapse | — |
| Item detail: status, progress, RSVP counts, targets | always | — | — |
| Item detail: comments | append below with "New" divider when the user is near the bottom | "2 new comments ↓" pill when reading higher up | — |
| Item detail while editing (composer has text, edit form open, report editor) | never touches the form | banner "This item was updated. [Show changes]" | — |
| Inbox / bell count | count always; new rows slide in at top when at top | "2 new" pill when scrolled | see 7.3 |
| Calendar | chips update in place | — | — |
| Nav / permissions (`permissions_changed`, `member_changed`, `group_changed`, `branch_changed`) | refetch `/me`; nav redraws silently | — | if the current page is no longer allowed: page message "Your permissions changed." + Go to Home |
| `session_ended` | — | — | redirect to sign-in "You were signed out. Please sign in again." (unsent comment text kept in sessionStorage) |

### 7.3 Toasts (only for things addressed to me)

A toast appears when a `notification` event brings a new unread notification of kind
`assigned, mentioned, submitted_for_approval, approved, rejected, event_invited,
event_cancelled, sla_breached` and I'm not already on that item. Max one visible; more
collapse into "+2 more updates → Inbox". Auto-dismiss 6 s, paused on hover/focus, never
takes focus, announced politely. Results of my own actions also toast ("Sent", "Approved ·
Undo", "You're going").

### 7.4 Optimistic vs. confirmed

Optimistic (revert + error toast on failure): RSVP, mark read, follow, claim,
start/block/unblock, approve (after undo window), posting a comment ("Sending…"). Wait for
server: create, submit/hand in, send back, assign, cancel, permission and member changes,
export, password.

### 7.5 Version conflicts (`409 version_conflict`)

Issues, work items and reports send their `version`. On conflict: amber banner "Someone else
changed this while you were editing. [Review changes] [Keep mine] [Use theirs]" — Review shows
old/new for title, description, priority, event times. For transitions (e.g. approving work
that was just reassigned): refetch, then "This work changed a moment ago. It's now {status}."
and the button set updates.

---

## 8. Design tokens

CSS custom properties on `:root`. Dark values under
`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {…} }` and
`:root[data-theme="dark"] {…}`. All text pairs meet WCAG AA (≥ 4.5:1; large/UI ≥ 3:1).

```css
:root {
  /* neutrals */
  --bg:#F6F5F2; --surface:#FFFFFF; --surface-2:#FBFAF8; --sunken:#EFEDE8;
  --border:#E3E0D9; --border-strong:#CFCBC2; --input-border:#8F8A7E;
  --text:#1D2129; --text-2:#4A505C; --text-3:#626877;
  /* brand */
  --primary:#2F55D4; --primary-hover:#2546B5; --primary-solid:#2F55D4; --on-primary:#FFFFFF;
  --primary-soft:#E8EDFC; --primary-on-soft:#2240A8; --focus:#2F55D4;
  /* semantic */
  --success:#1B7A43; --success-soft:#E3F5EA; --success-solid:#1B7A43;
  --warning:#8A5300; --warning-soft:#FFF3D6;
  --danger:#B42318;  --danger-soft:#FDECEA;  --danger-solid:#C4320A;
  /* kinds */
  --ticket:#0B6A9A; --ticket-soft:#E3F2FA; --action:#6D3FC8; --action-soft:#F0EAFC;
  --report:#9A5B00; --report-soft:#FCF1DE; --event:#1E7A4C;  --event-soft:#E2F4EA;
  /* statuses */
  --st-open:#4A505C;  --st-open-bg:#EEEDEA;   --st-prog:#1F4FC4; --st-prog-bg:#E6EDFD;
  --st-block:#B42318; --st-block-bg:#FDECEA;  --st-wait:#8A5300; --st-wait-bg:#FFF3D6;
  --st-ok:#1B7A43;    --st-ok-bg:#E3F5EA;     --st-cxl:#646A78;  --st-cxl-bg:#F0EFEC;
  --private:#3D4350;  --private-bg:#ECEDF1;   --staff-bg:#FFF8E6; --staff-edge:#D69E2E;
  /* type */
  --font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
          "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --fs-display:28px/34px; --fs-h1:24px/30px; --fs-h2:18px/26px; --fs-h3:15px/22px;
  --fs-body:15px/22px; --fs-small:13px/18px; --fs-tiny:12px/16px; --fs-stat:32px/36px;
  --fs-reading:17px/27px;
  --fw-regular:400; --fw-medium:500; --fw-semibold:600; --fw-bold:650;
  /* spacing (4 px base) */
  --s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px; --s-6:24px; --s-8:32px;
  --s-10:40px; --s-12:48px;
  /* radii */
  --r-sm:6px; --r-md:10px; --r-lg:14px; --r-xl:20px; --r-full:999px;
  /* elevation */
  --sh-1:0 1px 2px rgb(29 33 41/.06),0 1px 1px rgb(29 33 41/.04);
  --sh-2:0 4px 12px rgb(29 33 41/.08);
  --sh-3:0 16px 40px rgb(29 33 41/.16);
  /* motion */
  --dur-1:120ms; --dur-2:200ms; --dur-3:280ms; --dur-highlight:1500ms;
  --ease-out:cubic-bezier(.2,.8,.2,1); --ease-in:cubic-bezier(.4,0,1,1);
  --ease-std:cubic-bezier(.4,0,.2,1);
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg:#111419; --surface:#191D24; --surface-2:#1F242D; --sunken:#0D1014;
  --border:#2A303B; --border-strong:#3A4150; --input-border:#6B7383;
  --text:#E8EAEE; --text-2:#B4BAC6; --text-3:#959CAA;
  --primary:#8FA8FF; --primary-hover:#A9BCFF; --primary-solid:#4466E0; --on-primary:#FFFFFF;
  --primary-soft:#1E2847; --primary-on-soft:#B5C6FF; --focus:#8FA8FF;
  --success:#7FD3A6; --success-soft:#14321F; --success-solid:#1F8A4C;
  --warning:#FFCB6B; --warning-soft:#3A2C0C;
  --danger:#FF9C92;  --danger-soft:#3D1A17;  --danger-solid:#C4320A;
  --ticket:#7CC4EC; --ticket-soft:#13303F; --action:#B9A0F5; --action-soft:#2A2142;
  --report:#F2C27A; --report-soft:#3A2B12; --event:#7FD3A6;  --event-soft:#14321F;
  --st-open:#B4BAC6;  --st-open-bg:#262B35;  --st-prog:#9DB5FF; --st-prog-bg:#1C2747;
  --st-block:#FF9C92; --st-block-bg:#3D1A17; --st-wait:#FFCB6B; --st-wait-bg:#3A2C0C;
  --st-ok:#7FD3A6;    --st-ok-bg:#14321F;    --st-cxl:#8D94A2;  --st-cxl-bg:#232831;
  --private:#C6CBD6;  --private-bg:#2A2F3A;  --staff-bg:#2E2610; --staff-edge:#B8862A;
  --sh-1:none; --sh-2:0 4px 12px rgb(0 0 0/.4); --sh-3:0 16px 40px rgb(0 0 0/.5);
}}
/* :root[data-theme="dark"] repeats the dark block. */
@media (prefers-reduced-motion: reduce) { :root { --dur-1:1ms; --dur-2:1ms; --dur-3:1ms; --dur-highlight:1ms; } }
```

Notes: tabular numbers in tables and tiles; body 16 px on phones (no iOS zoom); hit
targets ≥ 40 px desktop, ≥ 44 px touch; page gutters 32 / 24 / 16; card padding 20 (16
phone). In dark mode shadows give way to borders and lighter surfaces.

---

## 9. Component inventory

| Component | Variants | States / notes |
|---|---|---|
| AppShell | sidebar / rail / phone (top + bottom nav) | |
| BranchSwitcher | static label / menu / school (Whole school) | open, keyboard (arrows, type-ahead) |
| NavItem | plain, with count, section heading | active, hover, focus |
| SearchBox | with number jump | loading, no results |
| LiveIndicator | live / reconnecting / offline | |
| Button | primary, secondary, ghost, danger, success, icon-only (aria-label) · sm 32 / md 40 / lg 48 | hover, active, focus, disabled, loading |
| SegmentedControl | 2–5 options | selected, arrow-key focus |
| Switch, Checkbox, Radio, RadioCard | | checked, disabled, focus, error |
| TextField, TextArea (auto-grow), Select, DateTimeField, TimezoneSelect | help, error, counter | |
| TypeTile / TypeBadge | ticket, action, report, event | |
| StatusBadge | 6 work statuses | |
| StateBadge | open, closed, cancelled | |
| PriorityBadge | low, normal (hidden in lists), high, urgent | |
| RsvpBadge / RsvpControl | 4 responses; control with note | optimistic, disabled (event over) |
| MarkerTag | Private, School-wide, Sent back, Not picked up yet, Staff only, Powerful, Admin, Deactivated | |
| DueText | normal, due soon, overdue, none | |
| ProgressBar | full, mini | role=img with label |
| Avatar / AvatarStack | 20/24/32/40, initials on hashed colour | deactivated |
| RecipientChip / RecipientPicker | person, group (count), branch | removable; tabs People/Groups/Branches |
| StatTile | neutral, alert, clickable | live highlight, null hidden, error "—" |
| ItemRow / ItemCard | list row, phone card | unread, closed, cancelled, urgent edge, highlight |
| WorkRow / BoardCard / BoardColumn | | draggable, drop refused, keyboard "Move to…" |
| AssignmentsPanel | per-member, shared, school-wide grouped | status filter chips, "You" pinned |
| AssignmentDrawer | assignee / approver / admin | |
| ReportEditor | assigned, self-filed | saving, saved, error, conflict, locked, sent back |
| CommentThread / Comment / Composer | normal, staff-only, removed, sending, failed, edited | mention picker, staff-only tint |
| MentionPicker | | hint for non-readers |
| AttachmentChip / DropZone | | uploading, too big, unsupported type |
| HistoryTimeline | | day groups |
| NotificationRow | per kind family; inline RSVP | unread, read |
| Toast | info, success, error, with action (Undo) | paused on hover |
| UpdatesPill | | |
| Banner | info, warning (conflict, sent back), danger (cancelled), success (closed) | |
| Dialog / ConfirmDialog / Sheet (side, bottom, full) | | focus trap, Esc, return focus |
| Popover / Menu | | |
| Tabs, Stepper | | aria-current |
| CalendarMonth / CalendarWeek / AgendaList / EventChip / EventPopover | chip by RSVP | |
| EmptyState, Skeleton, ErrorPanel | | |
| PermissionRow, ReachControl, KindChips, TemplatePicker, SaveBar, SourceChip, LockedList | | changed (left accent), powerful |
| TempPasswordReveal | | copy, shown once |
| ConflictBanner | | |

---

## 10. Responsive and accessibility rules

### 10.1 Responsive

| Breakpoint | Width | Shell |
|---|---|---|
| Phone | 375–639 (min supported 375; must not scroll horizontally at 375) | top bar + bottom nav, ☰ drawer |
| Tablet | 640–1023 | icon rail + top bar; side columns move below |
| Desktop | 1024–1439 | full sidebar |
| Wide | ≥ 1440 | content max 1200 (lists 1320) |

Phone rules: tables become cards; dialogs and sheets go full screen with sticky header and
footer; item detail primary action sits in a sticky bar above the bottom nav; the composer
is sticky on Conversation (bottom nav hides while it's focused); only quick-view chips and
board columns may scroll horizontally, inside their own container; long titles wrap
(`overflow-wrap:anywhere`); inputs 16 px.

### 10.2 Accessibility (WCAG 2.2 AA)

- Landmarks `header`, `nav[aria-label=Main]`, `main`, `aside`; skip link first.
- Full keyboard path; visible 2 px focus ring + 2 px offset (2.4.7, 2.4.11 not obscured by
  sticky bars: sticky elements get `scroll-padding`); roving tabindex in menus, tabs,
  segmented controls; dialogs trap focus and restore it.
- Drag-and-drop always has a menu alternative (2.5.7 Dragging movements).
- Targets ≥ 24×24 CSS px minimum (2.5.8), our standard is 40/44.
- Badges are text; icons beside text are `aria-hidden`; icon-only buttons have labels
  ("Notifications, 3 unread").
- Item row accessible name: "Report #1042, Term 1 science report, 5 of 8 approved, unread".
- One polite live region for toasts and "new updates"; assertive only for submit errors;
  list changes aren't announced one by one.
- Forms: visible labels, errors tied with `aria-describedby`, error summary focused on
  submit; no placeholder-only labels; Redundant entry avoided (3.3.7: create flow keeps
  answers across steps); Accessible authentication (3.3.8): password fields allow paste and
  password managers.
- Reduced motion honoured; layout works at 200 % zoom and Large text.
- Undo windows and toasts pause on hover/focus; no other time limits.
- Dates via `Intl` in the branch timezone; `lang` set.

---

## 11. Microcopy

Voice: a helpful colleague. Short sentences, active voice, first names. Buttons are verbs
("Send", "Hand in report", "Approve", "Send back", "I'll take it", "Close question",
"Download Excel file"), never "OK/Submit/Confirm". Dates: "Today 14:00", "Tomorrow", "Fri
24 Oct", 24-hour time, weeks start Monday [Q10].

Never show: issue, work item, SLA, scope, grant, target, payload, null, pending_approval,
per_member, error codes (codes only in the small "details" line).

### 11.1 Errors

| Code | Message |
|---|---|
| 401 `unauthenticated` (session expired) | "You were signed out. Please sign in again." (return URL kept) |
| 401 `invalid_credentials` | §4.1 |
| 403 `password_change_required` | redirect to Choose your own password |
| 403 `forbidden` | "You can't do that here. Your permissions may have changed." (+ refetch `/me`) |
| 403 `not_invited` | "You're not on the invite list for this event." |
| 403 `origin_mismatch` | "Something's wrong with this browser session. Reload the page." |
| 404 `not_found` | "You don't have access to this, or it no longer exists." |
| 409 `version_conflict` | "Someone else changed this while you were editing. Review their changes, then try again." |
| 409 `already_assigned` | "Someone else picked this up a moment ago." |
| 409 `invalid_transition` | "This work has moved on. It's now {status}." (after refetch) |
| 409 `not_assigned` | "Pick this up first, then you can work on it." |
| 409 `not_claimable` | "This can't be picked up. It's assigned directly." |
| 409 `issue_not_open` | "This item is closed, so it can't be changed." |
| 409 `event_not_open` | "This event is over or cancelled, so replies are closed." |
| 409 `report_exists` | (silently switch to editing the existing report) |
| 409 `report_locked` | "This report was approved, so it can't be changed." |
| 409 `comment_deleted` | "That comment was removed." |
| 409 `target_exists` | "{name} already has this." |
| 409 `email_taken` / `already_member` | "There's already an account with this email." / "{name} is already a member here." |
| 409 `member_is_admin` | "Remove their admin role first. School admins can do this." |
| 409 `last_admin` | "A branch must always have an admin. Appoint another admin first." |
| 409 `last_super_admin` | "There must always be at least one school admin." |
| 409 `default_group` | "'All members' can't be renamed, archived or changed by hand." |
| 409 `group_archived` | "This group is archived. Restore it first." |
| 409 `group_name_taken` / `branch_code_taken` / `branch_name_taken` | "That name is already used." / "That code is already used." |
| 409 `grant_exists` | treated as saved |
| 409 `not_a_member` | "{name} isn't a member of this branch." |
| 413 `payload_too_large` | "That file is too big. The limit is 25 MB." |
| 422 `unsupported_type` | "That kind of file can't be attached. Use PDF, images (PNG, JPG, GIF, WebP), Word, Excel, PowerPoint, OpenDocument, CSV or text." |
| 422 `empty_file` | "That file is empty." |
| 422 `invalid_title` | "Give it a title (up to 200 characters)." |
| 422 `invalid_target` | "One of the recipients can't receive this. They may have left, or the group is archived." |
| 422 `invalid_event_range` | "The end must be after the start." |
| 422 `invalid_reminders` | "Up to 10 reminders, between 1 minute and 4 weeks before." |
| 422 `note_required` | "Add a note so {name} knows what to change." |
| 422 `report_required` | "Write and hand in your report first." |
| 422 `invalid_comment` / `too_many_mentions` | "Comments can be up to 20,000 characters." / "You can mention up to 50 people at once." |
| 422 `invalid_note` | "Notes can be up to 500 characters." |
| 422 `invalid_assignee` | "Pick someone who is an active member of this branch." |
| 422 `weak_password` / `password_unchanged` / `invalid_current_password` | §4.1 |
| 422 `invalid_email` / `invalid_name` | "Enter a valid email address." / "Enter a name (it can't be empty)." |
| 422 `invalid_branch_code` / `invalid_timezone` | "Use 2 to 10 capital letters or digits." / "Pick a time zone from the list." |
| 422 `export_too_large` / `invalid_range` | §4.14 |
| 422 other (`invalid_body`, `invalid_query`, `invalid_value`…) | "Something in this form isn't right. Check the highlighted fields." (+ server message per field) |
| 5xx / network | "Something went wrong on our side. Try again in a moment." [Try again] |

### 11.2 Empty states

| Where | Copy |
|---|---|
| Home (staff, nothing) | "You're all caught up. Nothing is waiting for you." |
| My work · To do | "Nothing on your plate. New work appears here the moment it's sent." |
| Approvals | "No work is waiting for your approval." |
| Items | "No items yet. Ask a question, send a task or add an event." |
| Items (filtered) | "Nothing matches these filters." [Clear filters] |
| Inbox / Unread | "No updates yet…" / "You've read everything." |
| Calendar | "Nothing on the calendar this month." |
| Comments | "No comments yet. Ask or answer here." |
| Files | "No files yet." |
| Group members | "No one is in this group yet. Add people to give them its permissions." |
| History | "Nothing has changed since this was created." |

### 11.3 Confirmations

| Action | Dialog |
|---|---|
| Close question | "Got your answer? Closing tells everyone it's done." [Close question] |
| Close item (with open work) | "Close '{title}'? 3 unfinished assignments will be cancelled and those people told." |
| Cancel event | "Cancel Parent evening? Everyone who hasn't declined will be told." [Cancel event] [Keep event] |
| Remove recipient | "Stop sending this to Science? 3 unfinished assignments will be cancelled." |
| Send back | "Send back to Sara" + required note [Send back] |
| Approve (bulk) | "Approve 3 pieces of work? Sara Karimi, Daniel Price, Nadia Hosseini." |
| Hand in report | "Hand in your report? Your approver will be told." |
| Cancel assignment | "Sara won't need to do this any more. She'll be told." |
| Remove member | "Remove Jamie from North Campus? Their unfinished work here becomes unassigned." |
| Deactivate | "Jamie won't be able to sign in. Their history stays. You can reactivate later." |
| Reset password | "Jamie gets a new temporary password and is signed out everywhere." |
| Save permissions | sentence diff (§4.12) |
| Delete group | "Delete Coordinators? If it was ever sent work, it will be archived instead." |
| Remove admin role | "Omar will stay a member of North Campus but won't be an admin." |
| Close branch | "People can't work in Riverside any more. Its history stays." |
| Discard create draft | "Discard this draft?" [Discard] [Keep editing] |

---

## 12. Backend gaps and open questions

### 12.1 Backend gaps (design needs something api.html doesn't provide)

| # | Gap | Impact / v1 workaround | Ask |
|---|---|---|---|
| G-1 | `WorkItem` has no item context (key, title, type, priority, completion mode, `requires_super_admin_approval`) | My work, Approvals, Board need one `GET /issues/{id}` per distinct item (cached) | Embed `issue: {id,key,title,type,priority,completion_mode,requires_super_admin_approval}` |
| G-2 | No names anywhere: `created_by`, `author_id`, `assignee_id`, `actor_id`, `decided_by`, `organizer_id` are bare ids | Client loads member directories of every visible branch; people who left are unresolvable for non-admins ("Former member") | Embed `UserRef {id, first_name, last_name, is_active}` |
| G-3 | No "approvable by me" filter on `/work-items` (and `status` takes one value) | Approvals filters out own work and school-wide items client-side (needs G-1); counts may briefly disagree with `awaiting_my_approval` | `?approvable=me`, multi-value `status` |
| G-4 | `/me` doesn't list my groups; no "claimable by me" filter | Up for grabs derived from per-group member lists + open unassigned work | Add `groups: GroupRef[]` to `MembershipView`; `/work-items?claimable=me` |
| G-5 | `IssueSummary` lacks next due date, recipients preview, comment count, event start / my RSVP | Items list shows no Due or Sent-to column; can't sort by due | Add `next_due_at`, `targets_preview`, `starts_at`, `my_rsvp` |
| G-6 | `/issues` filters: single `type`, single `state`, `assignee=me`, `q` only; no "sent to me / my groups", "created by me", overdue, priority, sort | "Questions sent to my group" can't be listed (technicians rely on notifications); quick views are single-select | `targeted=me`, `created_by=me`, `overdue=true`, `priority`, `sort=due|activity`, multi-value type/state |
| G-7 | No branch/school activity log endpoint (permissions, groups, admins, members, exports) | Only per-item History is built; `/history` screen deferred | `GET /audit?branch_id&entity_type&actor_id&from&to` (admins) |
| G-8 | Notification `kind` values and `payload` shapes are not documented in api.html (18 kinds exist in the schema) | Sentences drop clauses when payload fields are missing | Document kinds + payload per kind (due date, note excerpt, new time, group name, status) |
| G-9 | `HistoryEntry.action`, `entity_type`, `old_value/new_value` not documented | Generic fallback sentence for unknown entries | Document the vocabulary |
| G-10 | No way to change a deadline after sending (`IssuePatch` has no `sla_due_at`; no work-item patch) | "Extend deadline" not offered | `PATCH /work-items/{id}` `{sla_due_at, version}` or issue-level due change |
| G-11 | No attachment delete | Files attached by mistake stay; UI warns before upload on private items | `DELETE /attachments/{id}` (uploader/admin, audited) |
| G-12 | No school-wide user search or list of school admins | First-admin / appoint-admin / make-school-admin pickers are built by merging every branch's member list; school-admins card is incomplete | `GET /users?q=&super_admin=true` (school admins) |
| G-13 | Permission changes are one grant per call; no atomic replace | Multi-row saves can partially fail and send one admin notification per change | `PUT /groups/{id}/permissions` replace-set, one audit/notification |
| G-14 | Dashboard: `upcoming_events` window/limit undefined; awaiting-approval only for "me", not per branch; `personal` scope semantics undocumented | Whole-school table omits a per-branch "waiting" column | Document; optionally add `awaiting_approval` per BranchNumbers |
| G-15 | `CalendarEntry` has no RSVP counts | Counts fetched on popover open, not shown on chips | Add `rsvp_counts` |
| G-16 | `/exports` param formats undocumented (`branch_ids` list format, `types` format, `from/to` date or date-time, which date the range filters on) | Spec assumes comma lists and created date | Document |
| G-17 | `/branches/{id}/members` has no `q` search | Client-side filtering (fine at ~100 staff) | `?q=` when schools grow |
| G-18 | No endpoint to list who follows an item | "Following" shows only my own state; no avatar stack of followers | Optional `watchers_count` on IssueDetail |
| G-19 | Creating a branch needs an existing active user as first admin | A brand-new head must first be added to another branch | Allow `NewBranch` with `first_admin: {email, first_name, last_name}` |

### 12.2 Open questions for the product owner

1. **Product name** — "Staffroom" is a placeholder.
2. **"School admin" vs "Super admin"** — the UI says "School admin"; the product documents say
   "Super admin". Which word should staff see?
3. **Tickets sent to a group** — what do the group's members receive? Admins get
   `ticket_created`; is there a notification for the addressed people/groups, and should
   they be able to list "questions for my group" (needs G-6)?
4. **Event changes and replies** — when an event's time changes, are existing replies reset
   to "Not replied"? The design asks people to reply again if so.
5. **Export date range** — does it filter on created date, closed date, or activity? An
   item created in August and closed in October: in or out of "Since 1 September"?
6. **Withdraw a submission** — may someone pull back work waiting for approval? Not in the
   state machine today; not designed.
7. **Approval undo** — is a 5-second client-side undo before approving acceptable?
8. **Staff dashboard** — with `personal` scope, are overdue / due-soon numbers the person's
   own work? Should staff see `open_public_tickets` at all?
9. **Board visibility** — staff can read every non-private item in their branch and
   therefore every colleague's assignment status. Show the board to everyone, or only to
   admins / `dashboard.branch`?
10. **Locale** — 24-hour time, weeks starting Monday, UK date order: confirm for all branches.
11. **Self-filed reports** — who should be told when someone files a report for themselves
    (nobody is notified today), and should admins be able to "acknowledge" it?
12. **Deadline changes** — needed in v1 (G-10), or acceptable to remove and re-send?

---

## 13. Changelog vs. the 2026-10-16 draft, and decision log

### 13.1 Changelog

- **Grounded on the latest api.html** instead of the backend plan; every screen now lists its
  endpoints. New §12 lists 19 gaps.
- **Items list**: removed the "Due" and "Sent to" columns and the `next_sla_due_at` field
  (not in `IssueSummary`, G-5); quick-view chips are single-select (API takes one type/state);
  dropped client-side custom saved views (scope cut).
- **Notification kinds** confirmed against the database (18 kinds; draft's list matched) but
  flagged as undocumented in the API (G-8); sentences degrade gracefully.
- **School admin management added**: `PUT/DELETE /users/{id}/super-admin` now exist →
  "School admins" card on Branches (draft Q3 resolved). Branch close via `is_active`.
- **Password rules known** (8–128 chars, current password required) → forced-change screen
  silently reuses the temporary password (draft Q4 resolved).
- **Cross-branch items**: the API allows any kind with `branch_id = null` and branch
  targets → school admins can send Tickets and Events school-wide too (draft Q8 resolved).
- **Approvals and Up for grabs** now describe the client-side derivation and its gaps (G-1,
  G-3, G-4) instead of assuming filters.
- **Activity history**: branch-wide history screen deferred (no endpoint, G-7); per-item
  History documented with the observed action vocabulary.
- **Home**: tiles mapped field by field to `Dashboard` (nullable numbers hide); "What's new"
  uses notifications because there is no activity feed; school-wide work progress from
  `done_count/work_item_count`.
- **Members**: renamed "People" → "Members" (matches product docs); add-member results cover
  created / reactivated / existing.
- **Groups**: delete → archive outcome handled; archived groups + Restore; staff get a
  read-only list (permissions doc: everyone sees the branch's groups).
- **Permission editor**: reach options now exactly match the catalog (e.g. `issue.edit`
  own/branch; `comment.create` targeted/branch); save is a sequence of calls with
  partial-failure handling (G-13); `grant_exists` treated as success.
- **Self-filed reports** specified (no recipients, author closes).
- **Events**: "Close event" for organizers after the event; `event_not_open` handling.
- **Error table** now covers every API error code.
- **Removed**: "sign out everywhere" (no endpoint), mark-as-unread, Q about bulk send-back.

### 13.2 Decision log

| ID | Decision |
|---|---|
| D-01 | Ticket is introduced as "Ticket — ask a question"; creator's button is "Close question". |
| D-02 | Numbers shown as `#1042`; search accepts `ISS-1042`, `#1042`, `1042`. |
| D-03 | Work status `open` = "Not started" to avoid clashing with item state "Open". |
| D-04 | Priority medium = "Normal", critical = "Urgent"; Low/Normal hidden in lists. |
| D-05 | Internal comments are "Staff only", amber edge, tinted composer. |
| D-06 | Super admin shown as "School admin" (Q2). |
| D-07 | Manage pages are single-branch; from "All" they open with an in-page branch picker. |
| D-09 | Board shows assignments (Actions/Reports); drag only for start/block/unblock. |
| D-10 | Approve has a 5 s client-side undo before the API call. |
| D-11 | Reports and descriptions are plain text with paragraphs; no rich text in v1. |
| D-12 | "Hand in report" = report submit + work-item submit in one step. |
| D-13 | Calendar can overlay my due dates from `/work-items?assignee=me`. |
| D-14 | System font stack, no web fonts. |
| D-15 | Phone bottom nav: Home · My work · + · Calendar · Inbox. |
| D-16 | Brand "schoolhouse blue" #2F55D4 on warm paper neutrals; kind colours sky / violet / amber / green. |
| D-17 | Toasts only for 8 notification kinds addressed to me. |
| D-18 | A ticket with no recipients is allowed: "asks the branch admins" (they always get `ticket_created`). |
| D-19 | Approve from lists allowed (with undo); bulk approve needs a confirm; no bulk send-back. |
| D-20 | No feature is shown whose data the API can't return; gaps are tracked in §12. |
| D-21 | Up for grabs and Approvals are derived client-side in v1 until G-3/G-4 land. |
