# UX specification: school ticketing and work-coordination app

Version 0.1 · 16 Oct 2026 · Companion prototype: `prototype.html` (same folder)

This is the design specification the frontend is built from. It is grounded in
`presentation/product-overview.html`, `presentation/permissions.html`,
`presentation/data-model.html` and `backend/BACKEND_PLAN.md` (§1, §5–§10, §12).
Where this document and the backend plan disagree, **the backend plan wins**: raise it
as a question, never paper over it in the UI.

Working product name in the UI: **Staffroom** (a placeholder; see Open questions). The
school in sample data is "Navid School" with branches North Campus (NTH), South
Campus (STH), Riverside (RVS) and Junior School (JNR).

Section markers like **[D-12]** point to the decision log (§15).

---

## Contents

1. Design principles
2. Vocabulary: API terms → words on screen
3. Information architecture and navigation
4. Visual language: types, statuses, markers
5. Screen specifications
6. Key user flows
7. Real-time behaviour, optimistic UI and conflicts
8. Design tokens
9. Component inventory
10. Responsive rules
11. Accessibility
12. Microcopy guidelines
13. Error code → message mapping
14. How the client decides what to show (permissions in the UI)
15. Design decision log
16. Open questions for the product owner

---

## 1. Design principles

1. **"What do I need to do?" comes first.** Every person lands on a Home that answers,
   in order: what is waiting for me, what is due soon, what changed. Admin overviews come
   after, never instead of, a person's own work.
2. **Say it like a colleague would.** Plain words, full sentences, no system terms. "Sent
   back to you with a note", not "rejected"; "Waiting for approval", not
   "pending_approval"; "Due Friday", not "SLA". (§2, §12)
3. **Show only what you can do.** Controls the person cannot use are hidden, not greyed
   out, unless hiding them would be confusing; in that case, show a short reason ("Only
   school leadership can approve this"). The server still checks every action.
4. **One obvious next step.** Each screen and each item has exactly one primary button,
   chosen from the item's type, status and the viewer's role (§5.6 table). Everything
   else lives in a secondary row or an overflow menu.
5. **Calm, live, never jumpy.** The app updates itself, but it never moves the thing you
   are reading or typing in. New things announce themselves with a pill or a soft
   highlight; toasts are reserved for things addressed to you. (§7)
6. **Where am I? Which branch?** Branch context is always visible, always one tap away,
   and every item shows its branch when you are looking at more than one.
7. **Forgiving by default.** Drafts save themselves, approvals have a 5-second undo,
   destructive actions explain their consequences in plain words, and nothing is ever
   permanently deleted (the backend never deletes; the UI must not imply that it does).

---

## 2. Vocabulary: API terms → words on screen

The UI must never show the left column. Use the right column verbatim.

| API / data model | On screen | Notes |
|---|---|---|
| issue | **item** | "Items" in nav. Never "issue" or "ticket" as a generic word. |
| issue type `ticket` | **Question** (type name "Ticket" in filters/exports) | [D-01] The type picker says "Ticket — ask a question". Lists show "Ticket". |
| `action` | **Action** ("a task with sign-off") | |
| `report` | **Report** | |
| `event` | **Event** | |
| issue.number | **#1042** | Search also accepts `1042`, `#1042`, `ISS-1042`. [D-02] |
| issue_target | **Sent to** / recipients | "Invited" for events, "Asked" for tickets. |
| work_item | **assignment** (someone's part of the work) | "Assignments" panel on an item. |
| completion_mode `shared` | **One person handles it** | Helper: "Anyone in the group can pick it up." |
| completion_mode `per_member` | **Everyone does their own** | Helper: "Each person gets their own copy to complete." |
| work_status `open` | **Not started** | [D-03] avoids clashing with item state "Open". |
| `in_progress` | **In progress** | |
| `blocked` | **Blocked** | Helper text: "Waiting on something before I can continue." |
| `pending_approval` | **Waiting for approval** | |
| `approved` | **Approved** | |
| `cancelled` | **Cancelled** | |
| reject (action) | **Send back** | Result shown as status "In progress" + a **Sent back** tag with the note. |
| claim (action) | **I'll take it** | |
| assignee null on shared item | **Not picked up yet** | |
| issue_state `open/closed/cancelled` | **Open / Closed / Cancelled** | |
| priority `low/medium/high/critical` | **Low / Normal / High / Urgent** | [D-04] |
| sla_due_at | **Due** ("Due Fri 17 Oct", "Due tomorrow") | |
| is_overdue | **Overdue** ("Overdue by 2 days") | Only for Not started / In progress / Blocked. |
| rsvp `pending/going/maybe/declined` | **Not replied / Going / Maybe / Not going** | Buttons: "Going", "Maybe", "Can't go". |
| is_private | **Private** | Helper: "Only the people it's sent to and admins can see it." |
| is_internal_only comment | **Staff-only comment** | Helper: "Hidden from people without staff-only access." [D-05] |
| issue_watcher | **Follow** / "Following" | |
| issue_read / unread | bold title + blue dot, "Unread" | |
| requires_super_admin_approval | **School-wide** tag; detail line "Signed off by school leadership" | |
| branch_id NULL (cross-branch) | "All branches" or the list of branch names | |
| user_group | **Group** | |
| group "All members" | **All members** (lock icon, "Everyone in this branch") | |
| group_permission / grant | **What this group can do** | |
| scope `own/targeted/branch` | **Their own / Sent to them / Whole branch** | |
| branch_membership.is_admin | **Admin** (of that branch) | |
| is_super_admin | **School admin** (badge "School admin") | [D-06] "Super admin" is used only in docs. |
| left_at | **Left the branch** | |
| is_active=false | **Deactivated** | |
| must_change_password | (forced password screen) | |
| audit_log / history | **History** | |
| notification | **Inbox** / "update" | |

---

## 3. Information architecture and navigation

### 3.1 App shell (desktop ≥ 1024px)

```
┌───────────────┬──────────────────────────────────────────────────────────┐
│ [S] Staffroom │  [≡]  Search items or #number…   ● Live   [🔔3] [+ New] (SK)│ ← top bar 56px
│ ┌───────────┐ ├──────────────────────────────────────────────────────────┤
│ │North Camp.▾│ │                                                          │
│ └───────────┘ │   Page header: title · subtitle · page actions           │
│  Home         │                                                          │
│  My work   4  │   Page content (max 1200px, centred; detail pages use     │
│  Approvals 5  │   main 1fr + side 320px)                                 │
│  Inbox     3  │                                                          │
│  Items        │                                                          │
│  Calendar     │                                                          │
│  ── Manage ── │                                                          │
│  People       │                                                          │
│  Groups       │                                                          │
│  Export       │                                                          │
│  ── School ── │                                                          │
│  Branches     │                                                          │
│               │                                                          │
│  (SK) Sara K. │                                                          │
└───────────────┴──────────────────────────────────────────────────────────┘
  sidebar 248px
```

- **Sidebar** (248px, collapsible to a 64px icon rail via the `[≡]` button; state kept in
  localStorage). Top: logo + product name. Then the **branch switcher**. Then nav. Bottom:
  the person's avatar, name and role in the current branch; click opens the account menu
  (Profile & settings, Theme, Sign out).
- **Top bar**: global search (title search via `GET /issues?q=`; Enter on a number jumps
  to `GET /issues/by-number/{n}`), live connection indicator, notification bell with
  unread count (`GET /notifications/unread-count`, kept live by the stream), and the
  global **+ New** button (primary). The bell opens a 400px popover with the latest 8
  updates and "Open Inbox".
- Keyboard: `/` focuses search, `n` opens New, `g h` Home, `g w` My work, `g i` Inbox,
  `g c` Calendar, `?` shows the shortcut sheet. Shortcuts are off while typing.

### 3.2 Branch switcher

A button showing the current context: branch name, code, and the person's role there.

Menu contents (in this order):

1. **All my branches** (shown only if the person belongs to 2+ branches) — or, for a school
   admin, **Whole school (4 branches)**.
2. One row per branch the person belongs to (school admins: every active branch):
   name, code, and a small role tag: `Admin` / `Member`. School admins show
   `School admin` on the "Whole school" row only.
3. Footer link for school admins: "Manage branches".

Behaviour:
- The choice persists (localStorage) and is mirrored into the URL as `?branch=NTH` or
  `?branch=all`, so shared links keep context. Item URLs (`/items/1042`) do not need it.
- Changing branch re-fetches `/me`-derived capabilities for that branch and redraws the
  nav (e.g. Omar is Admin at North, Member at South: **Manage** disappears when he
  switches to South). The switch animates the sidebar badge, not the page.
- In **All my branches**, lists add a Branch column/tag, and the dashboard shows a
  per-branch breakdown. "Manage" pages are always about **one** branch; opening one from
  "All" opens the first branch where the person may manage, with a branch picker in the
  page header. [D-07]
- People in exactly one branch see the switcher as a static label (no menu), so they never
  wonder what it is for.

### 3.3 Navigation entries per role

"Admin" = branch admin of the **current** branch. "Grant" = the person holds the
permission in the current branch (from any group). School admins see everything.

| Entry | Route | Teacher (All members defaults) | Member with grant | Branch admin | School admin |
|---|---|---|---|---|---|
| Home | `/` | ✓ | ✓ | ✓ | ✓ |
| My work | `/my-work` | ✓ | ✓ | ✓ | ✓ |
| Approvals | `/approvals` | – | if `work_item.approve` | ✓ | ✓ |
| Inbox | `/inbox` | ✓ | ✓ | ✓ | ✓ |
| Items | `/items` | ✓ | ✓ | ✓ | ✓ |
| Calendar | `/calendar` | ✓ | ✓ | ✓ | ✓ |
| *Manage* → People | `/people` | ✓ read-only directory (`member.view`) | manage tools if `member.manage` | ✓ | ✓ |
| *Manage* → Groups | `/groups` | – | – (never grantable) | ✓ | ✓ |
| *Manage* → Export | `/export` (dialog) | – | if `export.run` | ✓ | ✓ (any/all branches) |
| *School* → Branches & admins | `/branches` | – | – | – | ✓ |
| Profile & settings | `/profile` (account menu) | ✓ | ✓ | ✓ | ✓ |

The "Manage" heading only appears if at least one of its entries other than a read-only
People directory is visible; otherwise "People" sits in the main list. Badges: My work
shows my open assignments count; Approvals shows "awaiting my approval"; Inbox shows unread.

### 3.4 Global "+ New"

Primary button in the top bar (and the centre button in the phone bottom bar). Opens the
Create flow (§5.8) as a full-height side sheet on desktop (720px) and a full-screen page on
phone. Its first step only lists the types the person may create in the current branch.
Contextual shortcuts pre-fill it: "New event" on a calendar day pre-fills the date;
"Send work to this group" on a group page pre-fills recipients.

### 3.5 Route map

| Route | Screen |
|---|---|
| `/sign-in`, `/change-password` | §5.1 |
| `/` | Home §5.2 |
| `/my-work` | §5.3 |
| `/approvals` | §5.4 |
| `/inbox` | §5.5 |
| `/items` (`?type&state&assignee=me&q&view=list|board&saved=`) | §5.6 |
| `/items/:number` (`?tab=conversation|history`) | Item detail §5.7 |
| `/items/:number/assignments/:workItemId` | Assignment drawer over detail §5.9 |
| `/items/:number/report` | Report editor §5.10 |
| `/new?type=` | Create flow §5.8 |
| `/calendar?view=month|week|agenda&date=` | §5.11 |
| `/people`, `/people/:userId` | §5.12 |
| `/groups`, `/groups/:id/(members|permissions|settings)` | §5.13 |
| `/branches`, `/branches/:id` | §5.14 |
| `/export` | dialog over the current page §5.15 |
| `/profile` | §5.16 |

---

## 4. Visual language

Colour is never the only signal: every badge pairs an **icon + word**. Icon names refer
to the Lucide set (or equivalents); the prototype draws simplified versions inline.

### 4.1 Item types

| Type | Icon | Colour token | Light fg / bg | Dark fg / bg | One-line description (type picker) |
|---|---|---|---|---|---|
| Ticket | `message-circle-question` | `--type-ticket` | #0B6A9A / #E3F2FA | #7CC4EC / #13303F | Ask a question. Someone answers in the comments. |
| Action | `square-check` | `--type-action` | #6D3FC8 / #F0EAFC | #B9A0F5 / #2A2142 | Give someone a task. They do it and send it for approval. |
| Report | `file-text` | `--type-report` | #9A5B00 / #FCF1DE | #F2C27A / #3A2B12 | Ask for a written report, or file your own. |
| Event | `calendar` | `--type-event` | #1E7A4C / #E2F4EA | #7FD3A6 / #14321F | Put something on the calendar and invite people. |

Type appears as a 28px rounded-square icon tile in lists (bg + fg colour) and as a
`TypeBadge` (icon + word) on the detail header.

### 4.2 Assignment (work) status

| Status | Badge text | Icon | Light fg / bg | Dark fg / bg |
|---|---|---|---|---|
| open | Not started | `circle` (outline) | #4A505C / #EEEDEA | #B4BAC6 / #262B35 |
| in_progress | In progress | `circle-half` | #1F4FC4 / #E6EDFD | #9DB5FF / #1C2747 |
| blocked | Blocked | `octagon-pause` | #B42318 / #FDECEA | #FF9C92 / #3D1A17 |
| pending_approval | Waiting for approval | `hourglass` | #8A5300 / #FFF3D6 | #FFCB6B / #3A2C0C |
| approved | Approved | `circle-check` (filled) | #1B7A43 / #E3F5EA | #7FD3A6 / #14321F |
| cancelled | Cancelled | `circle-x` | #646A78 / #F0EFEC | #8D94A2 / #232831 |

Derived tags (not statuses):
- **Sent back** — `undo-2` icon, rose outline (#B42318 border/text); shown when status is
  In progress and the last decision was a rejection (`decided_at` set, `decision_note`
  present, status in_progress). Hover/tap shows the note.
- **Overdue** — `alert-triangle`, red text "Overdue by 2 days" next to the due date.
  Never a badge on its own; it modifies the due date.
- **Due soon** — amber text "Due tomorrow" / "Due today" (within 24h).
- **Not picked up yet** — dashed-outline neutral badge with `hand` icon for unassigned
  shared assignments.

Progress on an Action/Report item: a segmented bar (approved = green, waiting = amber,
in progress = blue, blocked = red, not started = grey track) with text "3 of 8 approved ·
2 waiting for approval". Cancelled assignments are excluded from the denominator text
but listed.

### 4.3 Item state

| State | Treatment |
|---|---|
| Open | No badge in lists (default). Detail header shows green-dot "Open". |
| Closed | Neutral badge `check` "Closed"; title stays normal weight; row text-2 colour. |
| Cancelled | Neutral badge `ban` "Cancelled"; title struck through in lists; events show "Cancelled" ribbon on calendar chips. |

### 4.4 Priority

| Value | Shown as | Where |
|---|---|---|
| low | `arrow-down` "Low", text-3 | Detail only |
| medium | (nothing) / "Normal" in detail | Detail only |
| high | `arrow-up` "High", orange #B54708 / #FEF0E1 | Lists + detail |
| critical | `alert-octagon` "Urgent", white on red #C4320A (dark: #FF8A65 on #3D1A12) | Lists + detail; rows get a 3px red left edge |

### 4.5 RSVP

| Response | Badge | Icon | Colours |
|---|---|---|---|
| pending | Not replied | `circle-dashed` | neutral, dashed border; on my own events: "Reply needed" in primary |
| going | Going | `check` | event green |
| maybe | Maybe | `help-circle` | amber (as Waiting) |
| declined | Not going | `x` | neutral, text-3 |

Calendar chip styling by **my** response: going = solid event colour; maybe = striped
(45° 4px stripes); not replied = outlined with dashed border; not going = 50% opacity with
strikethrough time; organizer = solid with a small `crown`-free "Organizer" dot (no
crown icon; use `user-round-cog`).

### 4.6 Privacy and visibility markers

| Marker | Treatment |
|---|---|
| Private item | `lock` icon + "Private", slate #3D4350 / #ECEDF1 (dark #C6CBD6 / #2A2F3A). Placed right after the title in lists and the header. Tooltip: "Only the people it's sent to and admins can see this." |
| Staff-only comment | Comment card with 3px amber left border, tinted bg (#FFF8E6 / dark #2E2610), label `eye-off` "Staff only" above the body. The composer toggle reads "Staff only" with the same icon; when on, the composer gets the same tint so it is impossible to post the wrong way by accident. |
| School-wide item | `building-2` "School-wide" in primary-soft. In detail: "Sent by school leadership to 4 branches · Only school admins approve this work." |
| Unread | 8px primary dot left of the row + title weight 600. |
| Following | `bell` filled in the item header button "Following". |

---

## 5. Screen specifications

Each screen lists: **Purpose · Layout · Data · Actions · States · Role differences**.
Common states apply to every screen unless overridden:
- **Loading**: skeleton blocks shaped like the content (no spinners for page loads);
  after 8 s show "Still loading… check your connection" with Retry.
- **Error**: inline panel "We couldn't load this. [Try again]" plus the error code in
  small text for support. Never a blank page.
- **No access (404/403)**: "You don't have access to this item, or it no longer exists."
  with "Go to Home". (Server returns 404 for unreadable items; treat 403 the same.)

### 5.1 Sign in and forced password change

**Sign in** (`/sign-in`) — centred card 400px on a soft illustrated background (subtle
paper texture gradient, no stock photos).
- Fields: Email, Password (show/hide toggle), "Sign in" primary (full width).
- Below: "Forgot your password? Ask your branch admin to reset it." (No email reset in v1.)
- Errors: `401 invalid_credentials` → "That email and password don't match. After 5 wrong
  tries, sign-in pauses for 15 minutes." (Same message whether or not the email exists.)
- Loading: button shows inline spinner + "Signing in…", fields disabled.
- On success: if `must_change_password` → `/change-password`; else go to the originally
  requested URL or Home.

**Change password** (`/change-password`) — same card.
- Title "Choose your own password"; text "You signed in with a temporary password. Pick a
  new one only you know."
- Fields: New password, Confirm new password; live checklist of rules returned by the
  server's validation (see Open question Q4); "Save and continue".
- The rest of the app is unreachable (API returns `403 password_change_required`; the
  client redirects here on that code). "Sign out" link is available.
- Also reachable from Profile (then it asks for the current password too, if the API
  requires it — Q4).

### 5.2 Home dashboard

**Purpose**: answer "what needs me, what's coming, what changed" for the current branch
context, live. Data: `GET /dashboard?branch_id=` (omit for All), `GET /work-items?assignee=me`,
`GET /calendar?from=today&to=+14d`, `GET /notifications?…` (latest 6).

**Layout (desktop)**: greeting row → stat tiles row → two columns (main 2fr / side 1fr).

- Greeting: "Good morning, Sara" + "Friday 16 October · North Campus". Right side:
  live indicator "Updated just now".
- **Stat tiles** (`StatTile`, clickable → filtered list). Number 32px, label 13px, small
  secondary line.

| Tile | Teacher (no `dashboard.branch`) | Admin / `dashboard.branch` | School admin, Whole school |
|---|---|---|---|
| 1 | **My open work** (my open work items) → My work | **Open items** (sum of open by type, mini bar by type) → Items | Open items, all branches |
| 2 | **Due this week** (mine) | **Overdue** (red if > 0) → Items/board filtered | Overdue |
| 3 | **Overdue** (mine, hidden if 0) | **Waiting for my approval** → Approvals | Waiting for my approval |
| 4 | **Events in the next 14 days** ("2 need a reply") | **Due in the next 7 days** | Due in the next 7 days |
| 5 | – | **Events in the next 14 days** | Events in the next 14 days |

- **Main column**
  - Teacher: "Your work" — next 5 assignments sorted by due (overdue first), each a
    `WorkRow` with status, due, quick primary action ("Start", "Continue", "Write report").
    Then "Open questions" — tickets I asked or that are addressed to me (count from the
    public ticket counts) with a link to Items filtered.
  - Admin: "Waiting for your approval" (top 5, each with Review / Approve; Approve has the
    5 s undo). "Overdue" (top 5, assignee + days overdue + "Open"). "Work by status" — a
    horizontal stacked bar of all work items in the branch by status, with a legend
    that doubles as filters.
  - School admin (Whole school): "Branches at a glance" table — rows per branch: Open,
    Overdue, Waiting for approval, Events (14d); each cell links to that branch's filtered
    list. Then "School-wide work" — open cross-branch items with per-branch progress
    (e.g. Fire drill: North ✓, South waiting, Riverside in progress, Junior not started).
- **Side column**: "Coming up" (next events with RSVP buttons inline for "Not replied"),
  "What's new" (latest notifications, compact, unread dots; "Open Inbox").
- Live: tiles animate count changes (number cross-fade 200 ms, tile gets a 1.5 s soft
  highlight). Lists insert rows with highlight (§7).
- **Empty**: Teacher with no work: illustration-free friendly card "You're all caught
  up. Nothing is waiting for you." Admin with nothing awaiting: tile shows 0 in neutral,
  list hidden.
- **Phone**: tiles become a horizontally scrollable row of compact tiles (2 visible +
  peek), then sections stacked: Your work → Waiting for approval (admins) → Coming up →
  What's new.

### 5.3 My work

**Purpose**: everything assigned to me (and shared work I can pick up), across the current
context. Data: `GET /work-items?assignee=me&status=&branch_id=`, plus unassigned shared
items from groups I'm in (they appear on the item lists the API returns for me; see Q6).

- Header: "My work" + segmented tabs **To do** (Not started, In progress, Blocked) ·
  **Waiting for approval** · **Done** (Approved, Cancelled; last 30 days) + view toggle
  List / Board.
- **List**: grouped by due: Overdue · Today · This week · Later · No due date. Row =
  type tile, title, item #, branch tag (when All), status badge, due text, Sent back tag,
  primary inline action.
- **Board**: columns Not started · In progress · Blocked · Waiting for approval ·
  Approved. Cards are draggable **only** between Not started → In progress ⇄ Blocked
  (start/block/unblock). Dropping onto "Waiting for approval" opens the Submit flow
  (§5.9) instead of submitting silently; dropping elsewhere is refused with a shake +
  tooltip "Approval is decided by your approver". Keyboard alternative: card menu
  "Move to…".
- **Up for grabs** section (top, collapsible) — shared assignments "Not picked up yet" for
  groups I'm in, with "I'll take it" (claim).
- Empty (To do): "Nothing on your plate. New work will appear here as soon as it's sent."

### 5.4 Approvals

Visible to admins, school admins and holders of `work_item.approve`. Data:
`GET /work-items?status=pending_approval&branch_id=`.

- Header "Waiting for your approval" + count + branch tag. Sort: oldest submission first.
- Grouped by item (e.g. "Term 1 science report · 3 waiting"), each group expandable; row =
  person avatar, name, submitted "2 h ago", for reports the first line of the report,
  buttons **Review** (opens assignment drawer, §5.9) and **Approve** (5 s undo toast).
- Rows I may not decide on are not shown; if the API returns them (e.g. my own submission
  or a school-wide item for a branch admin) they show disabled with reason "You can't
  approve your own work" / "Only school leadership approves this".
- Bulk: checkbox per row + "Approve selected (4)" with a confirm dialog listing names.
  Bulk reject is not offered (a note is needed per person).
- Empty: "No work is waiting for your approval."

### 5.5 Inbox (notifications)

**Purpose**: the personal, in-app inbox. Data: `GET /notifications?unread=&after=`,
`POST /notifications/{id}/read`, `POST /notifications/read-all`.

- Header "Inbox" + tabs **All** · **Unread (3)** + "Mark all as read" (secondary).
- Grouped by **Today / Yesterday / This week / Earlier**. Infinite scroll with `after`.
- Row: kind icon in a 32px circle (colour by family), sentence (actor bold), item title
  (link), branch tag when All, relative time; unread = primary dot + tinted bg.
  Clicking marks read (optimistic) and opens the target (item, assignment drawer, or
  group).
- Hover/focus reveals "Mark as read/unread" icon button (unread toggle client-side only if
  API lacks it — we only have mark read; so show "Mark as read" only).
- New notifications arrive at the top with slide-in (150 ms) and a highlight; if the user
  has scrolled down, a pill "2 new" appears instead.
- Notifications older than 90 days and read are cleaned up by the server; footer text:
  "Read updates are kept for 90 days."
- Empty (All): "No updates yet. You'll see new work, mentions and reminders here."
  Empty (Unread): "You've read everything."

**Wording per kind** (`{actor}` bold; `{item}` = title link):

| kind | Icon | Text |
|---|---|---|
| assigned | `user-plus` | {actor} gave you {item} · due {date} |
| unassigned | `user-minus` | You're no longer assigned to {item} |
| mentioned | `at-sign` | {actor} mentioned you on {item}: "first 80 chars…" |
| commented | `message-square` | {actor} commented on {item} |
| status_changed | `refresh-cw` | {item} is now {status} (admin variant: "{person}'s work on {item} needs a new assignee") |
| submitted_for_approval | `hourglass` | {actor} sent {item} for your approval |
| approved | `circle-check` | {actor} approved your work on {item} |
| rejected | `undo-2` | {actor} sent {item} back to you: "note…" |
| changed_by_admin | `pencil` | {actor} changed your item {item} (or "closed") |
| ticket_created | `message-circle-question` | {actor} asked a question: {item} |
| event_invited | `calendar-plus` | {actor} invited you to {item} · {date time} [Going] [Maybe] [Can't go] |
| event_updated | `calendar-clock` | {item} has a new time or place — please reply again |
| event_cancelled | `calendar-x` | {item} on {date} was cancelled |
| event_reminder | `alarm-clock` | Reminder: {item} starts {in 1 hour / tomorrow at 18:00} |
| sla_due_soon | `clock` | {item} is due tomorrow |
| sla_breached | `alert-triangle` | {item} is overdue (admin variant: "{person}'s work on {item} is overdue") |
| added_to_group | `users` | You were added to the {group} group |
| permissions_changed | `shield` | What {group} can do was changed by {actor} |

`event_invited` rows include inline RSVP buttons (they call `PUT /events/{id}/rsvp`).

### 5.6 Items list

**Purpose**: browse and find items in the current context. Data: `GET /issues?branch_id&type&state&assignee=me&q&after`.

- **Header**: "Items" + count; right: view toggle **List / Board**, "Export" (if allowed),
  "+ New".
- **Saved views bar** (horizontal chips, scrollable on phone): built-in views
  - **Open** (state=open) — default
  - **Assigned to me** (assignee=me)
  - **Questions** (type=ticket, open)
  - **Actions & reports** (type=action,report, open)
  - **Events** (type=event)
  - **Closed** (state=closed,cancelled)
  - then the person's own saved views; "+ Save view" appears when the filters differ from
    the active view. Saved views are stored client-side per user per browser [D-08].
- **Filter row**: Search (title, debounced 300 ms, `q`), Type (multi), State (Open / Closed
  / Cancelled), "Assigned to me" toggle, Branch (only in All context). "Clear filters".
  Filters reflect in the URL. Filters not supported by the API (creator, priority,
  overdue) are **not** offered in v1 (Q5).
- **List view** (table on desktop, cards on phone). Columns: Type tile · Title (with
  #number, Private/School-wide markers, unread dot) · Sent to (avatars/group chips, max 2 +
  "+3") · Progress (Actions/Reports: mini segmented bar + "3/8"; Events: date + "12 going";
  Tickets: comment count) · Due (next due from `next_sla_due_at`, overdue in red) · Priority
  (High/Urgent only) · Updated (relative). Branch column when All. Row click → detail;
  middle-click/cmd-click opens new tab (rows are real links).
- **Board view** [D-09]: shows **assignments** of Actions and Reports by status
  (`GET /work-items?branch_id&status`) — columns Not started · In progress · Blocked ·
  Waiting for approval · Approved (last 14 days). Cards: title, assignee avatar + name,
  due, Sent back tag. Tickets and Events are not on the board (a note above the board
  says so). Dragging is limited exactly as on My work; admins additionally get
  "Reassign" in the card menu.
- Pagination: infinite scroll with "Load more" button fallback (keyboard friendly), 50 per page.
- Live: new/changed rows → pill "3 new updates · Show" pinned at the top of the list when
  the list is scrolled or a filter field has focus; otherwise rows update in place with
  highlight (§7).
- Empty (no items at all): "No items yet. Ask a question, send a task or add an event."
  + "+ New". Empty (filters): "No items match these filters." + "Clear filters".
- Role differences: teacher sees only items readable to them (the API filters); Private
  marker appears only on items they can see. Export button only for export-capable roles.

### 5.7 Item detail (one layout, adapts per type)

**Layout (desktop)**: breadcrumb → header → two columns (main 1fr / side 320px).

**Header**
- Line 1: TypeBadge · `#1042` (copy-link on click) · state badge · priority (High/Urgent)
  · Private · School-wide.
- Line 2: Title (24px, wraps; editable inline by people with `issue.edit` via a pencil
  button, never by clicking the title itself).
- Line 3: "Created by **Omar Rahimi** · North Campus · 2 days ago".
- **Action bar**: one primary button (table below), "Follow / Following", overflow menu
  (Edit details, Mark private/public, Add recipients, Close, Cancel, Copy link, Export
  this item — only those allowed).

**Primary action matrix** (viewer-dependent; first matching row wins):

| Type | Situation | Primary button |
|---|---|---|
| any | Item closed/cancelled | none (banner: "Closed by Sara Karimi on 14 Oct") |
| Ticket | I created it | **Close question** (confirm: "Got your answer? Closing tells everyone it's done.") |
| Ticket | I'm a recipient | **Reply** (focuses composer) |
| Action/Report | My assignment is Not started | **Start** |
| Action/Report | Shared, not picked up, I'm in the group | **I'll take it** |
| Action | Mine, In progress / Blocked | **Send for approval** |
| Report | Mine, report not yet written | **Write report** (→ editor) |
| Report | Mine, draft exists | **Continue report** |
| Action/Report | I can approve and N are waiting | **Review N waiting** (opens first in drawer) |
| Event | I'm invited | RSVP segmented control (Going / Maybe / Can't go) replaces the button |
| Event | I'm the organizer | **Edit event** |
| any | otherwise | **Comment** |

**Main column**
1. **Description** (rendered with line breaks + auto-linked URLs; "Show more" after 12 lines).
2. **Type block**:
   - **Ticket**: "Asked to" recipients line; if closed, "Answered" banner.
   - **Action / Report**: **Assignments panel** — title "Assignments", completion mode line
     ("Everyone does their own · sent to Year 7 tutors (7 people)"), the progress bar, a
     filter row of status chips with counts (All 7 · Waiting 3 · In progress 1 ·
     Blocked 1 · Not started 1 · Approved 1), and rows: avatar, name, status badge,
     Sent back tag, due/overdue, submitted time; for approvers rows that are Waiting
     show **Review** and **Approve**; row click opens the assignment drawer (§5.9).
     If I am an assignee, **my own row is pinned first** and labelled "You".
     For school-wide items: rows grouped by branch, each with that branch's assignee(s).
     Branch admins see only their branch's group expanded and can **Assign** an
     unassigned branch row (`POST /work-items/{id}/assign`).
   - **Event**: **When & where card** — date, time range (branch timezone; show "(UK
     time)" suffix only if the viewer's device timezone differs), all-day flag, location,
     reminders ("Reminders: 1 day and 1 hour before"), organizer. **RSVP bar** (for
     invitees): Going / Maybe / Can't go + optional note ("Add a note, e.g. arriving
     late"). **Responses** panel: counts per response with avatar stacks; expandable full
     list (`GET /events/{id}/rsvps`). If the time changed after I replied: amber banner
     "The time changed. Please reply again."
3. **Tabs**: **Conversation** (default) · **History**.
   - Conversation: comment thread (oldest first, newest at bottom), composer at bottom
     (sticky on phone). Comments: avatar, name, relative time (absolute on hover),
     "edited", body with @mentions highlighted, attachments as chips. Own comments: Edit /
     Delete in a menu; moderators: Delete on any ("Removed by an admin" placeholder stays).
     Composer: textarea (auto-grow), `@` opens mention picker (people who can read the
     item first; others are dropped by the server — show "Sara can't see this item, so
     she won't be notified" hint when picking someone not in recipients for private
     items), attach button (25 MB, allowed types), "Staff only" toggle (only with
     `comment.internal`), "Comment" button (Cmd/Ctrl+Enter).
     A "New" divider marks comments that arrived since I opened the page.
   - History: `GET /issues/{id}/history` timeline — icon, sentence ("Omar changed the due
     date from Fri 17 Oct to Mon 20 Oct"), time. Grouped by day. Read-only.
     Footer: "History can't be edited or deleted."

**Side column** (cards)
- **Details**: Branch(es) · Sent to (chips: person/group/branch; "+ Add" if `issue.target`;
  remove × with confirm "Removing Year 7 tutors cancels their unfinished assignments") ·
  Due (Actions/Reports) · Priority · Completion mode · Created / Updated.
- **People following** (avatar stack, "Follow" toggle).
- **Files**: list (icon by type, name, size, uploader) + "Add file" (drag-and-drop zone).
  Download via `/api/attachments/{id}`.
- **Report** (Report items, self-filed or my assignment): status of my report: "Draft
  saved 2 min ago" / "Submitted" with "Open report".

**Phone**: header → primary action (full-width sticky bottom button when relevant) →
type block → "Details" collapsible card → tabs. Assignment drawer becomes a full-screen
sheet.

**States**: loading skeleton; 404 page (§5 common); closed banner; "This item changed
while you were away" pill if a stream event arrives and the viewer is mid-edit (§7).

### 5.8 Create item flow

Side sheet (desktop 720px, right) / full-screen (phone) with a 4-step stepper
**Type → Details → Recipients → Review**. Back/Next at the bottom; Esc or "×" asks to
discard if anything was typed ("Discard this draft?"). Draft kept in sessionStorage so an
accidental close can be restored ("Restore your unsent draft?").

**Step 0 — Branch** (only if context is All and the person can create in 2+ branches):
inline select at the top of step 1: "Create in: North Campus ▾". School admins also get
**"Several branches (school-wide)"** for Actions, Reports, Tickets and Events [Q8].

**Step 1 — Type**: 2×2 cards (stacked on phone), each with icon, name, one-line
description (§4.1) and an example ("e.g. Where do I order lab supplies?"). Only creatable
types are shown (Teachers by default: Ticket, Report, Event). A teacher's Report card
says "File a report" — "Write a report about something you did or saw. It goes to your
admins for the record." (self-filed). Selecting a card advances automatically.

**Step 2 — Details** (fields vary by type):
- Title (required, 1–200, counter at 180+). Placeholder per type.
- Description (optional, textarea).
- Priority: segmented Low / Normal / High / Urgent (default Normal).
- **Actions & Reports**: Due date + time (default now + 3 days for Actions, + 7 days for
  Reports, shown as "Fri 17 Oct, 16:00 (default: 3 days)"); Report adds "What should the
  report cover?" hint in description placeholder.
- **Events**: Starts (date + time), Ends, All day toggle, Location, Reminders (chips:
  1 week / 1 day / 1 hour / 15 minutes before; default 1 day + 1 hour).
- Attachments (optional).
- **Private** toggle (only with `issue.set_private`): "Private — only the people it's sent
  to and admins can see it."

**Step 3 — Recipients** (skipped for self-filed reports, which are not sent to anyone):
- Label per type: "Who is this for?" (Action/Report), "Who should answer?" (Ticket),
  "Who's invited?" (Event). Tickets may be sent to nobody (then it goes to the branch's
  admins, who are notified via `ticket_created`); show "Leave empty to ask the branch
  admins."
- **Recipient picker** (§9 `RecipientPicker`): search box + tabs **People · Groups ·
  Branches** (Branches only for school admins). Results show avatar/icon, name, and for
  groups the member count ("Science · 8 people"). Selected recipients appear as chips
  above the search; × removes. "All members" group is listed first under Groups as
  "Everyone at North Campus".
- **How should groups do this?** (Actions/Reports, shown once a group or branch is
  selected): radio cards
  - **One person handles it** — "Anyone in the group can pick it up. 1 assignment."
  - **Everyone does their own** — "Each person gets their own copy. 8 assignments."
  The counts update live from group member counts (snapshot taken when sent — note
  "People who join the group later won't get one").
- Validation: at least one recipient for Actions and assigned Reports; events may have
  none ("Just for my calendar").

**Step 4 — Review**: a read-only summary card in plain sentences:
"You're sending an **Action** to **Year 7 tutors** (7 people, everyone does their own).
It's due **Fri 17 Oct at 16:00**. 7 people will be notified." Edit links per section.
Primary **Send** (Actions/Reports/Tickets) / **Create event** / **File report**. On
success: sheet closes, toast "Sent. #1063 is on its way.", navigate to the new item. On
`422` errors return to the offending step with field-level messages.

### 5.9 Assignment drawer: submit / approve / send back

Route `/items/:n/assignments/:id`; opens as a 480px right drawer over the item (phone:
full-screen sheet with back arrow). Data: `GET /work-items/{id}`, comments with
`work_item_id`, the linked report.

Contents: person (avatar, name, branch), status badge + Sent back tag, due, timeline
(Started · Blocked · Submitted · Sent back with note · Approved by…), **the work**: for
Reports, the submitted report rendered (title, body, files); for Actions, the person's
latest submission note (last comment before submission) and files. Then an
assignment-only comment thread ("Only people working on or approving this assignment are
notified").

**Assignee actions** (bottom bar):
- Not started → **Start** (`start`).
- In progress → **Send for approval** (primary) · "I'm blocked" (secondary).
  - "I'm blocked" opens a small dialog: "What's holding you up?" (optional, posted as a
    comment) → `block`. Blocked → **Continue** (`unblock`).
  - **Send for approval** dialog: "Add a note for your approver (optional)" + attach
    files → posts the note as a comment on the assignment, then `submit`. For Reports
    the button is replaced by **Write report / Continue report** until a report is
    submitted (§5.10).
- Waiting for approval → read-only "Sent for approval 2 h ago. You'll be told when it's
  approved." (No withdraw in v1; Q7.)
- Shared + unassigned → **I'll take it** (`claim`).

**Approver actions** (only for those allowed, never for the assignee themself):
- **Approve** (primary, green): applies optimistically, shows toast "Approved Sara's work
  · Undo" for 5 s; the request is sent after 5 s or immediately on navigation away
  [D-10]. Optional "Add a note" link expands a field before approving.
- **Send back** (secondary): dialog "Send back to Sara" with required note ("Tell Sara
  what to change"), button disabled until 3+ characters → `reject`. Result: status In
  progress + Sent back tag; Sara is notified.
- Admin overflow: **Reassign** (person picker limited to branch members; `assign`),
  **Cancel this assignment** (confirm: "Sara won't need to do this any more.").
- School-wide item viewed by a branch admin: approve buttons replaced by the line "Only
  school leadership approves this work."

### 5.10 Report editor (draft → submit)

Route `/items/:n/report`. Full-page focused editor (sidebar hidden on tablet/phone).

- Top bar: back arrow "Back to item", item title, autosave status ("Saving…" / "Draft
  saved 10:42" / "Couldn't save — retrying"), **Hand in report** (primary).
- Body: Report title (prefilled with the item title), body textarea with comfortable
  reading width (680px), 17px text, line height 1.6; word count; attachments area.
  Plain text with paragraphs; no rich-text toolbar in v1 [D-11].
- Autosave: `POST /issues/{id}/reports` on first keystroke, then `PATCH /reports/{id}`
  after 1.5 s idle and on blur; uses report `version`; on conflict show the conflict
  banner (§7.4).
- **Hand in report**: confirm dialog "Hand in your report? Your approver will be told. You
  can still edit it until it's approved." → `POST /reports/{id}/submit` then
  `POST /work-items/{id}/submit` (assigned reports) [D-12]. For self-filed reports only
  the first call is made, and the dialog says "File this report? It will be visible to
  your branch admins."
- After submission: editor stays editable until approval (per §7.4 of the plan); edits
  after hand-in show "You've changed your report since handing it in. Hand it in again?"
- Sent back: amber banner at the top with the approver's note.
- Leaving with unsaved changes (offline) → browser confirm.

### 5.11 Calendar (month / week / agenda) with RSVP

Data: `GET /calendar?from&to&branch_id` (events with my RSVP). Optional overlay of my due
dates from `GET /work-items?assignee=me` [D-13], toggle "Show my due dates" (default on).

- **Header**: "Calendar" · Today button · ‹ › · current range label ("October 2026") ·
  view segmented **Month / Week / Agenda** · "+ New event".
- **Filter chips**: "Needs a reply (2)", "Going", "All events"; branch tag in All context.
- **Month**: 7-column grid (weeks start Monday), day number, up to 3 event chips then
  "+2 more". Today highlighted with primary ring. Chips styled by my RSVP (§4.5). Due
  dates appear as small type-coloured outlined chips with a clock icon ("Due: Fire drill").
  Clicking an empty day → New event pre-filled.
- **Week**: time grid 07:00–19:00 (scrolls to 08:00), all-day row on top, events as
  blocks with overlap columns.
- **Agenda**: next 60 days grouped by day; each event row with time, title, location,
  RSVP control inline. Default on phone.
- **Event popover** (click chip; phone: bottom sheet): title, time, location, organizer,
  counts "12 going · 3 maybe · 5 not replied", my RSVP segmented control with optional
  note, "Open event". RSVP is optimistic; error reverts with toast.
- Cancelled events: struck through with "Cancelled" ribbon, still visible for 7 days.
- Empty range: "Nothing on the calendar this month."

### 5.12 People (branch members)

Data: `GET /branches/{id}/members`, member detail, `GET /branches/{id}/members/{user_id}/effective-permissions`.

- **List**: search, filter tabs **Current · Left the branch** (Left only for managers),
  group filter. Table: avatar+name, email, groups (chips, max 3), role ("Admin" badge),
  status (Deactivated), last sign-in (managers only). Phone: cards.
- Read-only directory for everyone with `member.view`: name, email, groups.
- **Add member** (admins, `member.manage`): dialog — Email (required) → if account exists:
  "Sara Karimi already has an account (South Campus). Add her to North Campus?" →
  Add. If new: First name, Last name → **Add member** → result panel "Temporary
  password: `k7-Fawn-Delta-42` [Copy]. Give this to Jamie in person. They'll choose their
  own password when they first sign in. This password won't be shown again." Optional:
  add to groups (admins only).
- **Member detail** (`/people/:id`): header with name, email, role in this branch, other
  branches (names only). Sections: **Groups** (admins: add/remove chips), **What can they
  do here?** — plain-language list of effective permissions, each with "from **Science**,
  **All members**" source chips; admin rows say "Admin of North Campus — can do everything
  here except school-level tasks". **Actions**: Edit name/email, Reset password (shows
  temp password once, "This signs Jamie out everywhere"), Remove from branch (confirm
  explains: "Jamie's unfinished work at North Campus becomes unassigned and you'll be
  asked to reassign it."), Deactivate account (only if single-branch, non-admin; "Jamie
  won't be able to sign in. Their history stays."), Reactivate (admin only, on Left tab).
- Rules surfaced as reasons: managers can't act on admins ("Admins are managed by school
  leadership"); removing an admin is blocked ("Remove their admin role first — ask a
  school admin").

### 5.13 Groups (list, detail, members, permission editor)

Admins and school admins only. Data: `GET /branches/{id}/groups`, `/groups/{id}`,
`/groups/{id}/permissions`, `GET /permissions` (catalog).

**List**: cards grid (2 cols desktop, 1 phone): name, description, member count + avatar
stack, plain-language capability summary built from grants ("Can approve work · Can
export to Excel · Can add and remove members"), archived groups under a collapsed
"Archived" section. "All members" pinned first with lock icon, "Everyone in North Campus
· 42 people · everyday permissions". "+ New group" (name, description, optional preset).

**Detail** header: name, description, member count, "Send work to this group" button.
Tabs **Members · What they can do · Settings**.

- **Members**: list + "Add people" (multi-select picker of branch members not yet in the
  group) + remove ×. Note: "Added people get this group's permissions immediately. They'll
  be notified." For All members: list is read-only with "Everyone in the branch is in
  this group automatically."
- **What they can do** (permission editor) — see below.
- **Settings**: rename, description, **Delete group** (if the group was ever sent work, the
  API archives instead: dialog says "This group has been sent work before, so it will be
  archived. Its history stays, and it can't be sent new work.") All members: no
  rename/delete.

**Permission editor (plain language, presets, per-kind reach)**

Layout: left column (editor), right column (desktop sticky; phone below) with **"Check a
person"** and **"Who's affected"**.

1. **Start from a template** (presets; selecting one previews changes, nothing saved yet):
   - **Everyday member** — the All members defaults (§14 list).
   - **Approver** — approve and send back work (Actions & Reports, whole branch); read
     private items; staff-only comments.
   - **Coordinator** — everything in Approver + create Actions, send items to anyone, edit
     and close any item, assign/reassign work, add & remove members, branch dashboard.
   - **Office & data** — branch dashboard, export to Excel, see member directory.
   - **Almost admin** — every grantable permission at whole-branch reach.
   - **Start empty**.
2. **Sections**, each permission is one row:

| Section | Row sentence (UI) | Permission | Reach options |
|---|---|---|---|
| Seeing things | See items | issue.read | Their own · Sent to them · Whole branch |
| | See private items | issue.read_private | Whole branch |
| | See staff-only comments and write them | comment.internal | Whole branch |
| | See the member directory | member.view | Whole branch |
| | See branch-wide dashboard numbers | dashboard.branch | Whole branch |
| Creating & managing | Create items | issue.create | Whole branch |
| | Edit title, description, priority and event details | issue.edit | Their own · Whole branch |
| | Close or cancel items | issue.close | Their own · Whole branch |
| | Mark items private or public | issue.set_private | Their own · Whole branch |
| | Send items to people and groups | issue.target | Their own · Whole branch |
| Doing & approving work | Update progress and send work for approval | work_item.update | Sent to them · Whole branch |
| | Pick up, assign or reassign work | work_item.assign | Sent to them (= pick up shared work) · Whole branch |
| | Approve or send back work | work_item.approve | Whole branch |
| Conversation | Comment | comment.create | Sent to them · Whole branch |
| | Remove other people's comments | comment.moderate | Whole branch |
| People & data | Add and remove members, reset passwords (not admins) | member.manage | Whole branch |
| | Export this branch to Excel | export.run | Whole branch |

   Row controls: **switch** (on/off) · **Reach** segmented control showing only allowed
   scopes (hidden when only one) · **Which kinds?** chips "All kinds" or any of Tickets /
   Actions / Reports / Events (only for per-type permissions). A link "Different reach for
   different kinds…" expands a mini-grid (kinds × reach) for the rare case; each cell
   maps to one grant. Each row has an ⓘ with a plain example ("e.g. A coordinator can
   close any question in North Campus").
   Mapping: on + All kinds + reach X → one grant `(key, NULL, X)`; specific kinds → one
   grant per kind. Saving diffs current vs. desired grants and calls `POST
   /groups/{id}/permissions` / `DELETE /group-permissions/{id}`.
3. **Locked section** (collapsed by default): "Things only admins can do — these can't
   be given to a group": create/delete groups, change group members, change what groups
   can do, appoint admins (school admin), manage branches (school admin), approve
   school-wide work (school admin), export several branches (school admin). Lock icons,
   no controls.
4. **Sticky save bar** appears on change: "3 changes · applies immediately to 6 people
   [Discard] [Save changes]". Save opens a confirm summarising in sentences: "Coordinators
   will now be able to: approve or send back work (Actions, Reports). Will no longer be
   able to: export to Excel." Admins of the branch are notified (server-side).
   Warning chips for powerful grants: "Whole branch · close" etc. get an amber
   "Powerful" tag.
5. **Check a person** (right column): pick a member → list of everything they can do in
   this branch with source group chips (from `effective-permissions`), highlighting rows
   that come from the group being edited. Answers "where does this person's permission
   come from?".
6. **All members** group: same editor, banner "These are the everyday permissions every
   person in North Campus gets. Changes affect all 42 people." Preset list limited to
   "Everyday member (recommended defaults)" reset.

### 5.14 Branches and admins (school admin)

- **List** (`/branches`): table — Code, Name, Timezone, Admins (names), Members, Status
  (Active / Closed). "+ New branch".
- **New branch** dialog: Code (2–10 uppercase letters/digits, auto-uppercases), Name,
  Timezone (searchable select; default Europe/London), Email (optional), **First admin**
  (required; picker of existing people, from any branch). Help: "Every branch needs at
  least one admin. You can add more later." Creates branch + admin in one go.
- **Branch detail** (`/branches/:id`): Settings card (rename, timezone, email, close
  branch → `PATCH`), **Admins** card: list + "Appoint admin" (pick from this branch's
  members) + "Remove admin role" (if last admin: button disabled with reason "A branch
  must always have an admin. Appoint another admin first."; API `409 last_admin` maps to
  the same text). Quick links: People, Groups, Dashboard of that branch.

### 5.15 Export dialog

Modal (phone: full-screen). Data: `GET /exports?branch_ids&types&from&to` (file download).

- **Branches**: branch admins/`export.run`: fixed to the current branch (text, not a
  control). School admins: checkboxes per branch + "All branches".
- **What to include**: checkboxes Tickets, Actions, Reports, Events (all on).
- **Dates**: presets chips "This month", "Last month", "Last 3 months", "Since 1
  September", "Custom" (from/to date fields).
- Note: "Private items and staff-only comments are included only if you can see them.
  This export is recorded in the history."
- Primary **Download Excel file** → button shows progress "Preparing your file…"; on
  success, browser download + toast "Export downloaded".
  `422 export_too_large` → inline error "That's too much for one file. Try a shorter
  date range."

### 5.16 Profile and settings

- **Profile**: name, email (read-only; "Ask your admin to change these"), branches with
  role per branch, my groups per branch.
- **What I can do**: per branch, plain-language list from `/me` effective permissions
  (same component as §5.12).
- **Password**: "Change password" form.
- **Appearance**: Theme System / Light / Dark; Text size Normal / Large (client-side root
  font-size 16 → 18px); "Reduce motion" follows the OS, with override.
- **Sign out**.

### 5.17 Activity history

v1 exposes history **per item** (`GET /issues/{id}/history`) — the History tab in §5.7.
Group and member pages show "Recent changes" only if the API exposes them (Q9). Sentences
are built from audit rows: "{actor} {verb} {object} {from → to}", system actions say
"Staffroom" as the actor ("Staffroom closed this item when all work was approved").

---

## 6. Key user flows

### 6.1 Teacher answers an assigned report
1. Inbox/toast: "Omar Rahimi gave you **Term 1 science report** · due Fri 24 Oct".
2. Tap → item detail. Primary button **Write report**. My row is pinned in Assignments.
3. Editor opens; title prefilled; she writes; "Draft saved" appears after pauses.
4. She closes the laptop; next day Home → "Your work" shows "Continue report · Draft".
5. **Hand in report** → confirm → status becomes **Waiting for approval**; toast "Handed
   in. Omar will review it."
6. If sent back: notification "Omar sent **Term 1 science report** back to you: 'Please
   add the Year 9 results'". Item shows amber banner with note; she edits and hands in
   again.
7. Approved: notification + status Approved; item closes automatically when all are done.

### 6.2 Admin sends a report request to a group and approves submissions
1. **+ New** → Report → title "Term 1 science report", due default 7 days.
2. Recipients → Groups → **Science (8 people)** → "Everyone does their own (8
   assignments)".
3. Review → Send. Item page shows 8 rows, all Not started.
4. Over the week, Home tile "Waiting for my approval" increments live; Approvals shows a
   group "Term 1 science report · 3 waiting".
5. **Review** → drawer shows Sara's report → **Approve** (undo 5 s) → next waiting
   person opens automatically ("Next: Daniel Price →").
6. For one: **Send back** with note → that row shows In progress + Sent back.
7. Remaining 2 not handed in show "Due tomorrow" and get the automatic reminder; the
   admin can comment on their assignment to nudge.

### 6.3 School admin sends a school-wide action
1. Branch switcher → **Whole school**. **+ New** → Action.
2. Step 0 "Create in" → **Several branches (school-wide)**.
3. Details: "Termly fire drill and evacuation log", due Fri, priority High.
4. Recipients → Branches tab → select all four (or "All branches"). Mode: One person
   handles it (each branch admin assigns it).
5. Review: "Sent to 4 branches. Each branch admin will assign it. Only school admins can
   approve the results." → Send.
6. Branch admins get "assigned"/notification; their item view shows their branch row
   with **Assign** → picks the site manager.
7. Leila's Home shows "School-wide work: Fire drill 1/4 approved" and approves each branch
   as submitted.

### 6.4 Member RSVPs to an event
1. Notification "Omar invited you to **Parent evening** · Thu 23 Oct 18:00 [Going]
   [Maybe] [Can't go]".
2. Tap **Going** right in the inbox → badge changes immediately; toast "You're going."
3. Or: Calendar → chip (dashed = not replied) → popover → Maybe + note "Arriving 18:30".
4. Organizer moves it to 18:30 → notification "has a new time — please reply again";
   chip turns dashed again; banner on the event.
5. Reminder notifications 1 day and 1 hour before (not for "Not going").

### 6.5 Admin builds a "Coordinators" group
1. Groups → **+ New group** → name "Coordinators", description "Year and phase leaders",
   template **Coordinator** → Create.
2. Lands on **What they can do** with the template applied and saved (creation saves);
   reviews rows, turns off "Export this branch to Excel".
3. Save bar: "1 change · applies immediately to 0 people" → Save.
4. Members tab → Add people → selects 4 people → Add. Each is notified.
5. Check a person → "Daniel Price": "Approve or send back work — from **Coordinators**".
6. Daniel can now see Approvals in his nav on his next click.

### 6.6 Teacher asks a question (ticket)
**+ New** → Ticket → "Where do I order lab supplies?" → Who should answer? **Lab
technicians** → Send. A technician replies; Sara gets "commented"; she clicks **Close
question**.

---

## 7. Real-time behaviour, optimistic UI and conflicts

Source: `GET /api/stream` (SSE) sends IDs only; the client refetches through the API.
Debounce refetches to once per 2 s per query; on reconnect, refetch everything visible.

### 7.1 Connection indicator (top bar)
- **Live** — green dot (pulsing once every 4 s, no pulse under reduced motion). Tooltip
  "Updates appear automatically."
- **Reconnecting…** — amber dot after 5 s without heartbeat/connection.
- **Offline** — grey, "You're offline. Changes will fail until you reconnect." Banner
  under the top bar after 30 s.

### 7.2 How updates appear (by surface)

| Surface | When the person is idle and at top | When reading/scrolled/typing |
|---|---|---|
| Lists (Items, My work, Approvals) | Rows update/insert in place; changed rows get a 1.5 s primary-soft background fade; removed rows collapse (200 ms) | Pill "3 new updates · Show" sticky at top of the list; nothing moves until clicked |
| Dashboard tiles | Number cross-fades + tile glow 1.5 s | same |
| Item detail | New comments append below with "New" divider; status badges update in place with highlight | If the composer has text or an edit form is open: banner "This item was updated. [Show changes]" — the form is never reset |
| Inbox / bell | Count updates; new row slides in | Pill "2 new" |
| Calendar | Chips update in place | same |

### 7.3 Toasts (only for things addressed to me)
Show a toast only when a new notification arrives whose kind is one of: assigned,
mentioned, submitted_for_approval, approved, rejected, event_invited, event_cancelled,
sla_breached — and only if I'm not already on that item. Max 1 visible; extra ones stack
into "+2 more updates → Inbox". Auto-dismiss 6 s (paused on hover/focus), never steal
focus, announced via `aria-live="polite"`.

### 7.4 Optimistic UI
Optimistic: RSVP, mark notification read, follow/unfollow, claim, start/block/unblock,
approve (with undo window), comment post (shown with "Sending…" then confirmed).
Not optimistic (wait for server): create item, submit, send back, permission changes,
member changes, export. On failure of an optimistic action, revert and show error toast
with the reason.

### 7.5 Version conflicts
Edits send the `version` they started from. On conflict (`409`):
- Inline banner above the form (amber): "**Someone else changed this while you were
  editing.** Review their changes, then try again." Buttons: **Review changes** (shows a
  small "theirs vs yours" for each changed field: title, description, priority, due,
  event time) and **Keep my version** (re-applies my values onto the new version and
  resubmits) / **Use theirs**.
- Report editor: "This report was changed in another window. [Load latest] [Keep mine]".

### 7.6 Losing access live
If a refetch returns 404/403 for the open item (e.g. removed from group, item made
private): replace content with "You no longer have access to this item." and a Home
button. If nav entries disappear (permissions changed), redraw the nav silently and, if
the current page is no longer allowed, show "Your permissions changed. [Go to Home]".

---

## 8. Design tokens

Expose as CSS custom properties on `:root`; dark values under
`@media (prefers-color-scheme: dark) { :root:not([data-theme=light]) {…} }` and
`:root[data-theme=dark]`. Contrast ratios below are against the token's intended
background and meet WCAG AA (≥ 4.5:1 text, ≥ 3:1 UI/large text).

### 8.1 Colour — light

| Token | Value | Use |
|---|---|---|
| `--bg` | #F6F5F2 | App background (warm paper) |
| `--surface` | #FFFFFF | Cards, sheets |
| `--surface-2` | #FBFAF8 | Table headers, subtle fills |
| `--sunken` | #EFEDE8 | Inputs track, hover on bg |
| `--border` | #E3E0D9 | Hairlines |
| `--border-strong` | #CFCBC2 | Inputs, dividers that must be seen (3:1 vs surface for input borders: use #A8A397 on inputs) |
| `--input-border` | #A8A397 | 3:1 on white |
| `--text` | #1D2129 | Body (15.6:1) |
| `--text-2` | #4A505C | Secondary (8.0:1) |
| `--text-3` | #646A78 | Meta, placeholders (5.5:1 on white, 5.0:1 on bg) |
| `--primary` | #2F55D4 | Buttons, links (6.2:1 on white) |
| `--primary-hover` | #2546B5 | |
| `--primary-soft` | #E8EDFC | Selected, highlight |
| `--primary-on-soft` | #2240A8 | Text on soft |
| `--focus` | #2F55D4 | 2px ring + 2px offset |
| `--success` | #1B7A43 | |
| `--warning` | #8A5300 | |
| `--danger` | #B42318 | |
| `--danger-solid` | #C4320A | Urgent badge bg (white text 4.8:1) |
| Type & status colours | §4 | |

### 8.2 Colour — dark

| Token | Value |
|---|---|
| `--bg` | #111419 |
| `--surface` | #191D24 |
| `--surface-2` | #1F242D |
| `--sunken` | #0D1014 |
| `--border` | #2A303B |
| `--border-strong` | #3A4150 |
| `--input-border` | #5B6372 |
| `--text` | #E8EAEE |
| `--text-2` | #B4BAC6 |
| `--text-3` | #8D94A2 (5.4:1 on surface) |
| `--primary` | #8FA8FF (text/links, 7.4:1) |
| `--primary-solid` | #4466E0 (button bg, white text 5.0:1) |
| `--primary-soft` | #1E2847 |
| `--primary-on-soft` | #B5C6FF |
| `--success` | #7FD3A6 · `--warning` #FFCB6B · `--danger` #FF9C92 |

Shadows in dark are replaced by 1px borders + slightly lighter surfaces.

### 8.3 Typography
Font: system UI stack (`ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica
Neue", Arial`) — fast, familiar, no download [D-14]. Numbers use
`font-variant-numeric: tabular-nums` in tables and tiles.

| Token | Size / line-height / weight | Use |
|---|---|---|
| `--fs-display` | 28/34, 650 | Page titles on Home |
| `--fs-h1` | 24/30, 650 | Page titles, item title |
| `--fs-h2` | 18/26, 600 | Section headings |
| `--fs-h3` | 15/22, 600 | Card titles |
| `--fs-body` | 15/22, 400 | Default (16px on phones to avoid iOS zoom in inputs) |
| `--fs-small` | 13/18, 450 | Meta, badges |
| `--fs-tiny` | 12/16, 500 | Labels, counts (uppercase eyebrow 11/16 + 0.06em tracking) |
| `--fs-stat` | 32/36, 650 | Stat tile numbers |
| Reading | 17/27 | Report editor and long descriptions |

### 8.4 Spacing, radii, elevation
- Spacing scale (4px base): `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 20,
  `--s-6` 24, `--s-8` 32, `--s-10` 40, `--s-12` 48. Page gutters: 32 desktop, 24 tablet,
  16 phone. Card padding 20 (16 phone).
- Radii: `--r-sm` 6 (badges, inputs small), `--r-md` 10 (buttons, inputs), `--r-lg` 14
  (cards), `--r-xl` 20 (sheets, dialogs), `--r-full` 999 (pills, avatars).
- Shadows (light): `--sh-1` 0 1px 2px rgb(29 33 41/.06), 0 1px 1px rgb(29 33 41/.04) (cards);
  `--sh-2` 0 4px 12px rgb(29 33 41/.08) (popovers); `--sh-3` 0 16px 40px rgb(29 33 41/.16)
  (dialogs, sheets).
- Hit targets ≥ 40px desktop, ≥ 44px touch.

### 8.5 Motion
| Token | Value | Use |
|---|---|---|
| `--dur-1` | 120ms | Hover, press, colour |
| `--dur-2` | 200ms | Popovers, dropdowns, row collapse |
| `--dur-3` | 280ms | Sheets, drawers, dialogs |
| `--dur-highlight` | 1500ms | Live-update fade |
| `--ease-out` | cubic-bezier(.2,.8,.2,1) | Entering |
| `--ease-in` | cubic-bezier(.4,0,1,1) | Leaving |
| `--ease-std` | cubic-bezier(.4,0,.2,1) | Movement |

`prefers-reduced-motion: reduce` → all durations 0.01ms except opacity fades (≤120ms);
no pulsing, no slide-ins, no number cross-fades.

---

## 9. Component inventory

| Component | Variants | States / notes |
|---|---|---|
| `AppShell` | desktop sidebar / rail / phone (top bar + bottom nav) | |
| `BranchSwitcher` | static label (1 branch) / menu | open, keyboard (arrows, type-ahead) |
| `NavItem` | with count badge, with section heading | active (primary-soft bg + 3px bar), hover, focus |
| `TopBar`, `SearchBox` | with number jump result | loading, no results ("No titles match. Try a number like #1042") |
| `LiveIndicator` | live / reconnecting / offline | |
| `Button` | primary, secondary (outline), ghost, danger, success (Approve), icon-only (requires `aria-label`) · sizes sm 32 / md 40 / lg 48 | hover, active, focus, disabled, loading (spinner + label) |
| `SegmentedControl` | 2–5 options, icon+label | selected, focus via arrows |
| `Switch`, `Checkbox`, `Radio`, `RadioCard` | | |
| `TextField`, `TextArea` (auto-grow), `Select`, `DateTimeField`, `TimezoneSelect` | with help, error, counter | |
| `TypeTile` / `TypeBadge` | ticket, action, report, event | |
| `StatusBadge` | 6 work statuses | |
| `StateBadge` | open, closed, cancelled | |
| `PriorityBadge` | low, normal (hidden), high, urgent | |
| `RsvpBadge`, `RsvpControl` | badge; segmented control with note | optimistic/pending |
| `MarkerTag` | Private, School-wide, Sent back, Not picked up yet, Staff only, Powerful | |
| `DueText` | normal, due soon, overdue, none | |
| `ProgressBar` (segmented) | full, mini | |
| `Avatar`, `AvatarStack` | initials on hashed pastel colour (AA text), sizes 20/24/32/40 | deactivated (grey + strike) |
| `RecipientChip` | person, group (with count), branch | removable |
| `RecipientPicker` | tabs People/Groups/Branches | search, keyboard select, empty |
| `StatTile` | neutral, alert (red when >0), clickable | live highlight |
| `ItemRow` / `ItemCard` | list row, phone card | unread, closed, cancelled, urgent edge, live highlight |
| `WorkRow` / `BoardCard` | | draggable, drop-refused shake |
| `BoardColumn` | | drop target highlight |
| `AssignmentsPanel` | per-member, shared, school-wide grouped | filter chips |
| `CommentThread`, `Comment`, `Composer` | normal / staff-only / removed / sending / failed | mention picker |
| `MentionPicker` | | |
| `AttachmentChip`, `DropZone` | | uploading progress, error (too big / type) |
| `HistoryTimeline` | | |
| `NotificationRow` | per kind family; with inline RSVP | unread |
| `Toast` | info, success, error, with action (Undo) | auto-dismiss, paused on hover |
| `UpdatesPill` | | |
| `Banner` | info, warning (conflict, sent back), danger, closed | |
| `Dialog`, `ConfirmDialog` | | focus trap |
| `Sheet` (side / bottom / full) | | |
| `Drawer` (assignment) | | |
| `Popover`, `Menu` (overflow) | | |
| `Tabs` | | |
| `Stepper` | 3–4 steps | complete / current / upcoming |
| `CalendarMonth`, `CalendarWeek`, `AgendaList`, `EventChip`, `EventPopover` | by RSVP | |
| `EmptyState` | with optional action | |
| `Skeleton` | text, row, tile, card | shimmer (off with reduced motion) |
| `PermissionRow`, `ReachControl`, `KindChips`, `PresetPicker`, `SaveBar`, `SourceChip`, `LockedList` | | changed (left accent), powerful |
| `TempPasswordReveal` | | copy, "won't be shown again" |
| `ConflictBanner` | | |
| `SavedViewChips` | built-in / custom | active, unsaved changes dot |

---

## 10. Responsive rules

| Breakpoint | Width | Shell | Notes |
|---|---|---|---|
| Phone | < 640 | Top bar (menu ☰, page title, bell) + **bottom nav** (Home · My work · **+** · Calendar · Inbox), 64px + safe-area | Items, Approvals, People, Groups, Export, Branches, Profile in the ☰ drawer, which also holds the branch switcher at the top. Search becomes an icon opening a full-screen search. |
| Tablet | 640–1023 | Icon rail (64px) + top bar | Detail side column moves below main; tables drop low-priority columns (Updated, Priority→icon only). |
| Desktop | 1024–1439 | Full sidebar | |
| Wide | ≥ 1440 | Full sidebar, content max 1200 (lists 1320) | |

Phone specifics:
- No horizontal page scroll at 360px+. Tables become stacked cards. Stat tiles scroll
  horizontally inside their own row (scroll-snap) — the only horizontal scroller besides
  saved-view chips and board columns.
- Board view on phone: one column at a time with a status segmented control on top
  (swipe between columns).
- Sheets/dialogs are full-screen with a sticky header (title + close) and sticky footer
  actions.
- Item detail: primary action in a sticky bottom bar above the bottom nav; composer
  sticky at bottom on the Conversation tab (bottom nav hides while the composer is focused).
- Inputs are 16px to avoid zoom; touch targets ≥ 44px.

---

## 11. Accessibility (WCAG 2.2 AA)

- **Landmarks**: `header`, `nav[aria-label=Main]`, `main`, `aside`. Skip link "Skip to
  content" as the first focusable element.
- **Keyboard paths**: everything reachable by Tab; visible focus ring (2px `--focus` +
  2px offset, never removed). Menus/tabs/segmented controls use arrow keys (roving
  tabindex). Dialogs/sheets/drawers trap focus, close on Esc, return focus to the opener.
  Board drag-and-drop has a keyboard alternative ("Move to…" menu). Calendar grid: arrow
  keys move days, Enter opens the day/event.
- **Screen readers**:
  - Badges are text, not just colour; icons are `aria-hidden` when next to text.
  - Icon-only buttons have `aria-label` ("Notifications, 3 unread", "Follow this item").
  - Item rows: link name reads "Action #1042: Check classroom first-aid kits, 3 of 7
    approved, due Friday, unread".
  - Live regions: one polite region for toasts and "3 new updates"; assertive only for
    errors on submit. Live list updates are **not** announced individually.
  - Progress bars: `role="img"` with label "3 approved, 2 waiting, 1 in progress, 1 not
    started".
  - Stepper: `aria-current="step"`; step titles in the dialog heading.
  - Forms: labels always visible (no placeholder-only), errors linked with
    `aria-describedby`, summary of errors on submit focused.
- **Reduced motion** (§8.5). **Text size**: layout works at 200% zoom and with the Large
  text setting; no fixed heights on text containers.
- **Colour**: AA contrast for all text and 3:1 for UI boundaries (input borders, focus,
  chart segments adjacent to background; progress segments separated by 2px gaps).
- **Time**: undo window and toasts pause on hover/focus; no other time limits.
- **Language**: `lang` set; dates formatted with `Intl` in the branch timezone.

---

## 12. Microcopy guidelines

- **Voice**: a helpful colleague. Short sentences, active voice, "you" and the person's
  first name. No exclamation marks except in "You're all caught up!" (one allowed).
- **Never show**: issue, work item, SLA, scope, grant, target, tenant, payload, 403, null,
  internal, pending_approval, per_member. (See §2.)
- **Buttons are verbs**: "Send", "Hand in report", "Approve", "Send back", "I'll take it",
  "Close question", "Download Excel file". Not "OK", "Submit", "Confirm".
- **Dates**: "Today 14:00", "Tomorrow", "Fri 17 Oct", "17 Oct 2025" (other year). 24-hour
  time (UK school; configurable later). Relative for < 7 days in feeds ("2 h ago").
- **Counts**: "1 person", "8 people"; "3 of 8 approved".
- **Consequences in confirms**: say what happens to other people. "Removing Year 7 tutors
  cancels 5 unfinished assignments. They'll be told."
- **Errors**: what happened + what to do. "We couldn't save your report. Check your
  connection — we'll keep trying."

| Situation | Copy |
|---|---|
| Empty My work | "Nothing on your plate. New work will appear here as soon as it's sent." |
| Sent back banner | "Omar sent this back: "Please add the Year 9 results." Make the changes and hand it in again." |
| Approve toast | "Approved Sara's work. · Undo" |
| Claim | "It's yours. Others in Lab technicians can see you picked it up." |
| Private toggle help | "Only the people it's sent to and admins can see it." |
| Staff-only toggle help | "Only staff with staff-only access will see this comment." |
| Locked permission | "Only admins can do this. It can't be given to a group." |
| Can't approve own work | "You can't approve your own work. Someone else will." |
| School-wide approval | "Only school leadership approves this work." |
| Last admin | "A branch must always have an admin. Appoint another admin first." |
| Temp password | "Give this to Jamie in person. It won't be shown again." |
| Event time changed | "The time changed. Please reply again." |
| No access | "You don't have access to this item, or it no longer exists." |
| Conflict | "Someone else changed this while you were editing. Review their changes, then try again." |
| Export too large | "That's too much for one file. Try a shorter date range." |

---

## 13. Error code → message mapping

| API | UI |
|---|---|
| 401 invalid_credentials | Sign-in message (§5.1) |
| 401 (session expired) on any call | Redirect to sign-in with "You were signed out. Please sign in again." Keep the URL to return to; keep unsent comment drafts in sessionStorage. |
| 403 password_change_required | Redirect to `/change-password` |
| 403 / 404 on item | No-access page (§5) |
| 403 on an action | Toast "You can't do that here. Your permissions may have changed." + refetch `/me` |
| 409 version conflict | ConflictBanner (§7.5) |
| 409 last_admin | "A branch must always have an admin…" |
| 409 removing an admin member | "Remove their admin role first — ask a school admin." |
| 422 report_required | "Write and hand in your report first." (button routes to editor) |
| 422 validation (grants, fields) | Field-level message from the server's `message`, mapped to the field |
| 422 export_too_large | §5.15 |
| 413 / 415 upload | "That file is too big (max 25 MB)." / "That kind of file can't be attached. Try PDF, images, Office files, CSV or text." |
| 5xx / network | "Something went wrong on our side. Try again in a moment." (+ Retry) |

---

## 14. How the client decides what to show

`GET /me` returns memberships and **effective permissions per branch**. Build a helper
`can(branchId, key, {type, scopeNeeded})` mirroring §6.4 for UI purposes only:

1. School admin → true (except "approve own work": compare assignee).
2. Admin of branch → true except school-only actions and edit/close/approve on
   school-wide items.
3. Otherwise any grant with matching key, type (or all kinds) and a scope that applies:
   `own` (I created it), `targeted` (I'm a recipient/assignee/member of a recipient group),
   `branch`.

Default **All members** grants (what a plain teacher can do), used for copy and the
"Everyday member" preset: see items (whole branch, non-private); create Tickets, Reports,
Events; edit and close their own items; send their own Tickets and Events to people and
groups; update their own work; pick up shared work sent to them; comment; see the member
directory.

The UI hides what `can()` denies; the server remains the authority and its 403/404 is
always handled gracefully (§13).

---

## 15. Design decision log

| ID | Decision |
|---|---|
| D-01 | The Ticket type is introduced as "Ticket — ask a question" in the picker and the primary close button says "Close question", because teachers think in questions, not tickets. Filters/exports keep "Ticket". |
| D-02 | Item numbers are displayed `#1042` (friendlier than `ISS-1042`); search accepts all forms. |
| D-03 | Work status `open` is labelled "Not started" to avoid confusion with item state "Open". |
| D-04 | Priority `medium` → "Normal", `critical` → "Urgent"; Low/Normal are not shown in lists. |
| D-05 | Internal comments are called "Staff only" (the product docs' word), styled with an amber edge and tinted composer. |
| D-06 | Super admin is called "School admin" in the UI. |
| D-07 | Manage pages are always single-branch; from "All my branches" they open the first manageable branch with an in-page branch picker. |
| D-08 | Saved views are client-side (localStorage, per user) in v1; built-in views cover the API's filters. |
| D-09 | Board view shows assignments (work items) by status; tickets/events are list-only. Drag is limited to start/block/unblock; submit via dialog; approval never by drag. |
| D-10 | Approve uses a 5-second client-side undo window before the API call (approval is irreversible in the API). |
| D-11 | Reports are plain text with paragraphs (body is `text`); no rich-text toolbar in v1. |
| D-12 | "Hand in report" performs report submit + work item submit in one step for assigned reports. |
| D-13 | Calendar can overlay my due dates from `/work-items?assignee=me` (client-side composition, no new endpoint). |
| D-14 | System font stack, no web fonts (speed on school networks, no external dependency). |
| D-15 | Phone bottom nav: Home · My work · + · Calendar · Inbox. Items etc. in the ☰ drawer. |
| D-16 | Brand colour: "schoolhouse blue" #2F55D4 on warm paper neutrals; type colours: Ticket sky, Action violet, Report amber, Event green. |
| D-17 | Toasts only for notifications addressed to me of 8 kinds (§7.3); everything else is quiet. |
| D-18 | A ticket with no recipients is allowed and described as "goes to the branch admins" (they get `ticket_created`). |
| D-19 | Approve from lists is allowed (with undo); bulk approve requires a confirm listing names; there is no bulk send-back. |

---

## 16. Open questions for the product owner

1. **Product name** — "Staffroom" is a placeholder. What should the app be called?
2. **Approvals queue** — can the API filter work items to "ones I can approve"
   (e.g. `GET /work-items?approvable_by=me`)? Today the client must infer it.
3. **School admin appointment** — there is no endpoint to make someone a school (super)
   admin. Is that CLI-only in v1?
4. **Password rules** — what are the minimum rules for new passwords, and does changing
   your own password require the current one?
5. **More list filters** — do we want "created by me", "priority", "overdue" and sorting in
   v1? They need API parameters.
6. **Shared work "up for grabs"** — should `/work-items` return unassigned shared items for
   groups I'm in (for My work → Up for grabs)?
7. **Withdraw a submission** — may an assignee pull back work that is waiting for approval?
   (Not in the state machine today.)
8. **School-wide tickets/events** — may school admins create cross-branch Tickets and
   Events, or only Actions and Reports?
9. **Branch-wide history** — should admins have a history screen beyond per-item history
   (group permission changes, exports, member changes)? Needs an endpoint.
10. **First admin of a new branch** — must they already have an account? If not, how is the
    account created before the branch exists?
11. **Sign out everywhere** — the data model mentions admins signing someone out; only
    password reset revokes sessions today. Is a separate control wanted?
