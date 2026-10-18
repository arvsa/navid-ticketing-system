# Frontend implementation plan: school ticketing system

_Revision 2026-10-17, written against the latest API (`../backend/docs/api.html`, 66 endpoints, also served as `/api/openapi.json`). The previous revision is in `archive/FRONTEND_PLAN.2026-10-16.md`._

You are implementing the web frontend for a ticketing and work-coordination app used by a school with several branches. Read this whole document, then `design/UX_SPEC.md` and `design/prototype.html`, before writing code.

- **Work one phase at a time.** Keep `pnpm typecheck`, `pnpm lint` and `pnpm test` green at the end of each phase, and stop after each phase with a short summary.
- **The UX spec is the source of truth for what screens look like and how they behave.** This plan is the source of truth for how to build them and for what the API can and can't do.
- **If the two disagree, or something is missing, stop and ask.** Do not invent features, statuses or permissions. Section 10 lists the known gaps between the design and the API.

Related documents:
- `../backend/docs/api.html` and `../backend/docs/REFERENCE.md`: endpoints, types, error codes, live events. **These replace BACKEND_PLAN as the API reference.**
- `../presentation/*.html`: the product, permissions and data model in plain language.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | |
| Build | Vite | Backend expects `APP_ORIGIN=http://localhost:5173` in dev |
| UI library | React 19 | |
| Routing | TanStack Router (file-based) | Typed routes and typed search params for list filters |
| Server state | TanStack Query | Caching, invalidation from live events, optimistic updates |
| Styling | Tailwind CSS v4; tokens as CSS variables in `src/styles/tokens.css` | Tokens come from UX_SPEC |
| Primitives | shadcn/ui (Radix; copied into the repo) | Accessible dialogs, menus, popovers, tabs, comboboxes |
| Icons | lucide-react | |
| Forms | react-hook-form + zod | |
| Dates | date-fns v4 + `@date-fns/tz` | Every date shown in its branch's time zone |
| Calendar | FullCalendar (MIT: daygrid, timegrid, list), themed with tokens | Month, week, agenda |
| Command palette | cmdk | |
| Toasts | sonner | |
| Markdown (descriptions, comments, reports) | react-markdown + rehype-sanitize | Bodies are stored as plain text; render safely |
| i18n | i18next + react-i18next; every string through `t()` from day one | See open question Q-B (RTL) |
| API types | openapi-typescript + openapi-fetch, generated from `/api/openapi.json` | Available now (see 4.1 for a caveat) |
| API mocks | MSW, in dev mock mode and in tests | Frontend can run without the backend |
| Tests | Vitest + Testing Library; Playwright (+ `@axe-core/playwright`) | |
| Quality | ESLint (typescript-eslint, jsx-a11y, react-hooks), Prettier | |
| Package manager | pnpm | |

- **Versions:** add packages with `pnpm add`, commit the lockfile.
- **No other state library.** Server state lives in TanStack Query; UI state in React state and the URL.

---

## 2. Design

`design/UX_SPEC.md` defines the shell, every screen with its empty/loading/error states, the flows, the status visual language, tokens, the component inventory, responsive and accessibility rules, and microcopy. `design/prototype.html` shows the intended look and feel: match its spacing, hierarchy and motion, but build from the component library, not by copying its markup.

**Language rule:** the UI never shows technical words. The UX_SPEC vocabulary table maps every API enum to UI words (e.g. `pending_approval` → "Waiting for approval", `per_member` → "Everyone does their own", `reject` → "Send back", `is_super_admin` → "School admin"). Put it in `src/lib/labels.ts` as i18n keys — the only place these words are defined. Unit-test that every value of every API enum (section 4.6) has a label.

**Product name** is a placeholder until decided: keep it in one `APP_NAME` constant and one `Logo` component.

---

## 3. Project layout

```text
frontend/
  design/                     # UX_SPEC.md, prototype.html (input, do not edit)
  archive/                    # previous plan/spec revisions (reference only)
  public/
  src/
    main.tsx
    app/
      providers.tsx           # QueryClient, Router, i18n, Theme, Toaster
      AppShell.tsx            # sidebar / top bar / bottom nav per UX spec
      BranchContext.tsx       # current branch scope, switcher state
      ThemeProvider.tsx       # light / dark / system
    routes/                   # TanStack Router file routes
    api/
      schema.d.ts             # generated: pnpm api:types
      types.ts                # hand-written fixes on top of schema.d.ts (see 4.1)
      client.ts               # openapi-fetch instance, ApiError normalisation
      keys.ts                 # query-key factory: single source for invalidation
      hooks/                  # one file per API area (issues, workItems, comments,
                              # reports, calendar, notifications, dashboard,
                              # branches, members, groups, permissions, users, me)
    realtime/
      stream.ts               # EventSource + heartbeat watchdog + reconnect
      useLiveUpdates.ts       # event -> debounced invalidation; "new updates" pill
    auth/
      useSession.ts           # /me, login, logout, password change gate
      RequireAuth.tsx
    people/
      usePeople.ts            # id -> person directory (section 4.5)
    features/
      dashboard/ items/ create/ work/ approvals/ reports/ events/ calendar/
      inbox/ members/ groups/ permissions/ branches/ export/ profile/ history/
    components/
      ui/                     # shadcn primitives
      common/                 # StatusBadge, TypeIcon, PriorityTag, PersonName,
                              # Avatar, RecipientPicker, MentionTextarea,
                              # EmptyState, ConflictDialog, PrivateBadge,
                              # DueLabel, RsvpControl, FileList, ...
    lib/
      labels.ts dates.ts format.ts i18n.ts can.ts history.ts notifications.ts
    styles/
      tokens.css globals.css
  mocks/
    handlers/                 # MSW handlers, one file per API area
    fixtures/                 # 3 branches, ~30 people, mirrors seed-demo shape
  e2e/
  index.html vite.config.ts tsconfig.json package.json
```

---

## 4. Talking to the backend

### 4.1 Dev setup and types
- **Proxy.** Vite proxies `/api` → `http://127.0.0.1:8080`. Keep the browser's `Origin` header intact (`changeOrigin: false`): every non-GET request must carry `Origin: http://localhost:5173` or the backend returns `403 origin_mismatch`. Browsers send it automatically on same-origin `POST/PUT/PATCH/DELETE`, so no manual header is needed. Run the backend with `APP_ORIGIN=http://localhost:5173 COOKIE_SECURE=false`.
- **SSE through the proxy.** Make sure the Vite proxy doesn't buffer `/api/stream` (verify in F2; events must arrive immediately).
- **Mock mode.** `pnpm dev` uses the real backend; `pnpm dev:mock` uses MSW. Every screen must work in both.
- **Generated types.** `pnpm api:types` generates `src/api/schema.d.ts` from `http://127.0.0.1:8080/api/openapi.json`. Commit the result.
  - **Caveat:** the docs show every `Page_*` type's `items` as `array of object`, and several enum-like fields as plain `string` (`IssueDetail.type`, `GroupGrant.permission`, `Notification.kind`). If the generated schema confirms this, define the precise types in `src/api/types.ts` (e.g. `Page<IssueSummary>`, `type: IssueType`) and use only those in feature code. Ask the backend to tighten the schema (gap G-21); delete the overrides when it does.
- **Demo data.** The backend's `admin seed-demo` creates three branches with ~90 staff (`member1@north.demo.school` / `demo-password`). E2E tests run against a freshly seeded database.

### 4.2 Sessions and errors
- **Session.** HttpOnly `sid` cookie (7 days, 12 h idle). Requests use `credentials: 'same-origin'`. Never store tokens in JS.
- **Login** returns `MeResponse`; seed the `['me']` query with it.
- **Password gate.** If `user.must_change_password`, route to the forced change screen; only `/me`, `/me/password` and `/auth/logout` work. Changing the password signs out other sessions.
- **Error shape** is always `{error: {code, message}}`. `client.ts` turns it into `ApiError {status, code, message, requestId}` (from `x-request-id`). Branch on `code`, never on `message`.

| Response | What the frontend does |
|---|---|
| `401 unauthenticated` / SSE `session_ended` | Clear the query cache, redirect to sign-in keeping the return path |
| `401 invalid_credentials` | One generic sign-in error (never says locked/inactive). After 5 failures mention the 15-minute lock in the copy |
| `403 password_change_required` | Route to forced password change |
| `403 forbidden` | Inline "You don't have permission to do that"; refetch `/me` so the control disappears |
| `403 origin_mismatch` | Treat as a bug: generic error + log with request id |
| `404 not_found` | "This doesn't exist or you don't have access" — never distinguish |
| `409 version_conflict` | `ConflictDialog`: refetch, keep the user's unsaved text, let them re-apply |
| other `409` / `422` | Map `code` → friendly copy in `labels.ts`. Field-specific codes (`invalid_title`, `invalid_email`, `weak_password`, `invalid_event_range`, `note_required`, …) map onto form fields via a `codeToField` table |
| `413 payload_too_large` | "Files can be up to 25 MB" |
| `500` | Generic error with the request id, and a retry |

- **Every error code** in REFERENCE.md gets a key in `labels.ts`; a unit test checks the list is complete.

### 4.3 Showing only what the user can do

The server enforces everything. The UI hides or disables what the user can't do. **The API has no per-item `can` object** (gap G-20), so `src/lib/can.ts` evaluates `/me` against the item:

- **Inputs:** `me.user.is_super_admin`; for the item's branch, the `MembershipView` (`is_admin`, `grants: Grant[]` = `{permission, issue_type|null, scope: own|targeted|branch}`); the item (`created_by`, `targets`, `work_items`, `type`, `state`, `requires_super_admin_approval`, `is_private`).
- **Scope check:** `own` = I created it; `targeted` = a target names me, one of my groups, or my branch, or a work item is assigned to me; `branch` = anything in the branch. A grant with `issue_type` applies only to that type. (Same rule as UX_SPEC §3.6.)
  - "One of my groups" needs my group memberships, which `/me` doesn't include. Load `GET /branches/{id}/groups` + members, or (better) ask for group ids in `MembershipView` (gap G-4).
- **Fixed rules** (from the API "Who" lines; encode them as named functions with unit tests citing the endpoint):
  - Super admins can do everything except approve their own work. Branch admins can do everything in their branch except super-admin actions, and except edit / close / approve / cancel work on items with `requires_super_admin_approval` (school-wide items). There they may still **assign** their branch's part (UX_SPEC §3.6, §4.6 "Assign our part").
  - Close: creators of tickets/reports/events, `issue.close`, admins. Cancel: same as close.
  - Work transitions: start/block/unblock/submit — the assignee; claim — members of the target group, shared work only; assign — admins or `work_item.assign`; approve/reject — admins or `work_item.approve`, **never your own work**, and only super admins when `requires_super_admin_approval`; cancel — admins.
  - The primary button on every item view comes from the UX_SPEC §4.6 matrix (first matching row wins). Implement it as one pure function `primaryAction(item, me)` with a table-driven unit test, one case per matrix row.
  - Valid transitions from each `WorkStatus` (encode the state machine; the §4.6 matrix depends on it): `open → start | claim | assign | cancel`, `in_progress → block | submit`, `blocked → unblock`, `pending_approval → approve | reject`, `approved`/`cancelled` → none. **Confirm the exact machine with the backend before F4** (Q-A in section 11); on `409 invalid_transition` refetch and show the copy.
  - Comment edit: author only. Delete: author, admins, `comment.moderate`. Staff-only comments: `comment.internal` or admin.
  - Reports: start — the work item's assignee or the issue creator; edit — author until approved; `report_locked` after.
- **Rule of thumb:** when `can.ts` is unsure, **show** the control and let the server answer; a `403` then refetches `/me`. Never hide something the user can do.
- When the backend adds `can` (G-20), switch the detail screens to it and shrink `can.ts` to navigation-level checks.

Navigation-level checks (from `/me` only): Members (`member.view`), Groups/Permissions (admin), Export (admin or `export.run`), Branches (super admin), branch dashboard numbers (`dashboard.branch` or admin), create menu entries (`issue.create` per type).

### 4.4 Query keys, caching, pagination
- `keys.ts` defines every key: `['me']`, `['branches']`, `['issues','list',filters]`, `['issues','detail',id]`, `['issues',id,'comments',workItemId?]`, `['issues',id,'reports']`, `['issues',id,'history']`, `['work-items','list',filters]`, `['calendar',from,to,branchId]`, `['events',id,'rsvps']`, `['notifications',filters]`, `['notifications','unread-count']`, `['dashboard',branchId|'all']`, `['branches',id,'members',filters]`, `['branches',id,'groups']`, `['groups',id,'permissions']`, `['permissions','catalog']`, `['effective-permissions',branchId,userId]`.
- `staleTime` 30 s; the catalog, `/branches` and people directory 5 min. Live events keep data fresh; no polling.
- **Optimistic updates** (roll back on error): mark notification read / read-all, RSVP, watch/unwatch, claim, issue read mark.
- **Versioned writes** (issue PATCH/close/cancel, work transitions, report PATCH/submit) always send the `version` from the cached object, and update the cache from the response.
- **Pagination** is keyset: `limit` (≤200) + `after=next_cursor`. Use `useInfiniteQuery` with "Load more" (or infinite scroll where the spec says).
- **Opening an issue** calls `POST /issues/{id}/read` once the detail has rendered; optimistically clear `unread` in list caches.
- **Deep links** by number: route `/i/:number` → `GET /issues/by-number/{n}` → render the detail.

### 4.5 People directory (names for ids)

Most responses carry user **ids only** (`created_by`, `author_id`, `assignee_id`, `actor_id`, `organizer_id`, `decided_by`, `mentions`). There's no `GET /users/{id}` (gap G-2). Until there is:
- `usePeople()` loads `GET /branches/{id}/members?limit=200` (all pages) for every branch in scope and builds an `id → {first_name, last_name, email, is_active}` map (~100 staff, cheap). Admins add `include_left=true` so departed authors still resolve.
- `<PersonName id>` renders from the map, falling back to "Former member" when unknown.
- The same data feeds `RecipientPicker` and `MentionTextarea`.
- Invalidate on `member_changed`.

### 4.6 Enums the UI must cover

`IssueType` ticket·action·report·event; `IssueState` open·closed·cancelled; `WorkStatus` open·in_progress·blocked·pending_approval·approved·cancelled; `Priority` low·medium·high·critical; `CompletionMode` shared·per_member; `RsvpResponse` pending·going·maybe·declined; `TargetKind` user·group·branch; `Scope` own·targeted·branch; `Transition` start·block·unblock·submit·approve·reject·claim·assign·cancel; `Permission` (17 keys, labels and descriptions come from `GET /permissions`); `NumbersScope` branch·personal. `Notification.kind` is an undocumented string — see gap G-8.

### 4.7 Branch context and time zones
- Current scope in the URL (`?branch=<code>`) so links are shareable, remembered in `localStorage` (try/catch).
- Options: each membership; "All my branches" (omit `branch_id`) when there are several; super admins see every branch from `GET /branches` plus "Whole school".
- `BranchRef` in `/me` has no timezone: load `GET /branches` once and join. Show times in the item's branch zone; append the zone abbreviation when it differs from the browser's. Cross-branch issues (`branch_id: null`) use the viewer's zone.
- Admin screens (Members, Groups, Permissions, Export for non-super-admins) always operate on one branch.

---

## 5. How each screen maps to the API

| Screen | Reads | Writes | Notes |
|---|---|---|---|
| Sign-in / password | `POST /auth/login`, `GET /me` | `POST /me/password`, `POST /auth/logout` | Password 8–128 chars; must differ |
| Home dashboard | `GET /dashboard?branch_id=` | — | `branches[]` (each `BranchNumbers`; nullable fields mean "not allowed to see": hide the tile, don't show 0) + `mine` (open work, awaiting my approval, unread, upcoming events). **No activity feed in the API** — the feed area shows my latest notifications (G-7) |
| My work | `GET /work-items?assignee=me&status=`, `GET /issues?assignee=me` | transitions | `WorkItem` has no title (G-1): join with the `IssueSummary` list by `issue_id`; fetch missing ones by id |
| Up for grabs | `GET /work-items?branch_id=&status=open` | `claim` | No claimable filter (G-3, G-4): client-filter `assignee_id == null` on shared work whose group target I'm in |
| Approvals queue | `GET /work-items?status=pending_approval&branch_id=` | `approve`, `reject` | No `approvable_by=me` (G-3, G-4): filter out my own work and apply `can.ts`; badge count from `dashboard.mine.awaiting_my_approval` |
| Items list | `GET /issues?branch_id&type&state&assignee&q` | — | Only these filters exist. Priority / created-by-me / overdue / sort are **not** server-side (G-6); don't fake them over paged data. Row shows `key`, title, type, priority, `done_count/work_item_count`, `is_overdue`, `unread`, private badge, `last_activity_at`. **No Due or Sent-to column** (not in `IssueSummary`, G-5). Quick-view chips are single-select because the API takes one `type`/`state` |
| Board view | `GET /work-items?branch_id&status=…` | start/block/unblock | Drag only for start/block/unblock; never submit/approve |
| Item detail | `GET /issues/{id}`, `/work-items?…` for per-row detail | `PATCH`, `close`, `cancel`, `read`, `watch`, `targets` add/remove | Layout per type (UX_SPEC §4.5). Edits send `version`. `requires_super_admin_approval` shows "Only school admins approve this work." to branch admins. **No deadline change** after sending (G-10) and **no file delete** (G-11): don't offer either. Organizers get **Close event** after an event ends |
| Comments | `GET /issues/{id}/comments?work_item_id=` | `POST`, `PATCH /comments/{id}`, `DELETE` | Oldest first. `mention_user_ids` parsed client-side from `@` picks (≤50). Deleted comments keep their slot ("Comment deleted"). Body 1–20,000 chars |
| Attachments | in `IssueDetail.attachments`, `Comment.attachments`, `Report.attachments` | `POST /issues/{id}/attachments` (multipart, optional `comment_id`/`report_id`) | Upload after the comment/report exists. Progress via XHR. ≤25 MB; accepted types not documented (G-22) — send and map `unsupported_type`. Download via `<a href="/api/attachments/{id}">` |
| Reports | `GET /issues/{id}/reports` | `POST` (with `work_item_id`), `PATCH /reports/{id}`, `POST /reports/{id}/submit` | "Hand in" = report submit → work item `submit` in sequence; if step 2 fails, the report stays submitted and the button becomes "Send for approval". Autosave drafts with PATCH (debounced, versioned). 1–100,000 chars. `report_exists` → load the existing one |
| Create flow | `GET /me`, people, groups, `GET /branches` | `POST /issues` | Fields: type, title (1–200), description, priority, is_private (if allowed), `completion_mode` (actions/reports only), `sla_due_at` (actions/reports only), `targets[]`, `event` (events only: starts/ends, all_day, location, reminders ≤10, 1 min–4 weeks). `branch_id: null` only for super admins with whole-branch targets |
| Calendar | `GET /calendar?from&to&branch_id` (≤366 days, paged) + my due dates from `GET /work-items?assignee=me` | — | Fetch the visible window; page through `next_cursor` |
| Event detail | `GET /issues/{id}` (`event: EventView` with `my_rsvp`, `rsvp_counts`, reminders), `GET /events/{id}/rsvps`. Calendar chips have no counts (G-15): fetch them when the popover opens | `PUT /events/{id}/rsvp` (note ≤500) | `not_invited` → hide RSVP; `event_not_open` → read-only |
| Inbox | `GET /notifications?unread=`, `/unread-count` | `POST /notifications/{id}/read`, `/read-all` | Rendering per `kind` lives in `lib/notifications.ts`; unknown kinds fall back to "Update on {issue_key}" |
| History tab | `GET /issues/{id}/history` | — | `HistoryEntry {action, entity_type, old_value, new_value}` → sentences in `lib/history.ts` using UX_SPEC §4.15's observed vocabulary; unknown actions get a generic line (G-9). The branch-wide `/history` screen is **deferred** (no endpoint, G-7) |
| Members | `GET /branches/{id}/members?group_id&include_left` | `POST` (add by email; show `temporary_password` once), `PATCH`, `DELETE`, `PATCH /users/{id}/active`, `POST /users/{id}/reset-password` | `already_member`, `member_is_admin`, `email_taken` copy |
| Groups | `GET /branches/{id}/groups?include_archived` | `POST`, `PATCH` (rename/archive/restore), `DELETE` (may archive: read `DeleteOutcome`), `PUT/DELETE /groups/{id}/members/{user_id}` | "All members" (`is_default`) is locked |
| Permission editor | `GET /permissions` (catalog), `GET /groups/{id}/permissions` | `POST /groups/{id}/permissions`, `DELETE /group-permissions/{id}` | No update endpoint: changing scope/type = delete + create. Save bar diffs desired vs current and runs the calls in sequence; report partial failure (G-13); treat `409 grant_exists` as success. Staff see a read-only Groups list Scopes limited to `allowed_scopes`; type picker only if `per_issue_type` |
| "Check a person" | `GET /branches/{id}/members/{uid}/effective-permissions` | — | `SourcedGrant.group` explains where each grant comes from |
| Branches & admins | `GET /branches`, `GET /branches/{id}` | `POST /branches` (needs `first_admin_user_id` of an existing active user), `PATCH`, `PUT/DELETE /branches/{id}/admins/{uid}`, `PUT/DELETE /users/{id}/super-admin` | Admin picker = people from all branches (G-19 for brand-new people). `last_admin`, `last_super_admin`, `branch_code_taken` copy; code 2–10 uppercase/digits; timezone IANA picker |
| Export | — | `GET /exports?branch_ids&types&from&to` (param formats undocumented, G-16: assume comma lists and ISO dates; verify in F7) | Download with `fetch` → blob → save, so JSON errors (`export_too_large`) can be shown. Several branches: super admins only |
| Profile | `GET /me` | `POST /me/password` | No self-service name edit (admins edit via Members). The forced-change screen sends the temporary password as `current_password` without asking for it again (UX_SPEC §4.1) |

---

## 6. Real-time updates

- **Connection.** `realtime/stream.ts` opens one `EventSource('/api/stream')` per tab after sign-in (and after the password gate). Wait for `ready`.
- **Watchdog.** A heartbeat arrives every 25 s. If nothing is received for 60 s, close and reopen. On every (re)connect and on `resync`, invalidate all active queries once.
- **Event shape:** `{kind, issue_id?, branch_ids?}` — IDs only, no recipient list. Mapping in `useLiveUpdates`:

| Event `kind` | Invalidate |
|---|---|
| `issue_created`, `issue_updated`, `work_item_updated`, `comment_*`, `report_*`, `rsvp_changed`, other issue events | `['issues','detail',id]` + its comments/reports/history/rsvps; issue and work-item lists; calendar if it's an event; dashboards for `branch_ids` |
| `notification` | unread count, notifications list, `['dashboard']` (`mine`) |
| `permissions_changed`, `member_changed`, `group_changed`, `branch_changed` | `['me']`, `['branches']`, people directory, affected branch members/groups/permissions |
| `resync` | everything |
| `session_ended` | sign out locally → sign-in screen |

- **Debounce:** collect events and flush invalidations at most once every 2 s.
- **Toasts** come from the `notification` event: after refetching, toast the new unread notifications (assigned, mentioned, approved/rejected, etc.). The stream itself doesn't say who an event is for.
- **Don't disturb the user** (UX spec real-time rules): lists the user is reading show an "N new updates" pill instead of reordering; a detail screen with unsaved edits shows "This was updated" with a reload action instead of refetching under the editor; no highlight animation with `prefers-reduced-motion`.
- **Tab title** shows the unread count when it's above zero.

---

## 7. Cross-cutting requirements

- **Accessibility:** WCAG 2.2 AA, keyboard-complete, visible focus, labelled controls. Status never by colour alone. Dialogs trap and restore focus. axe on every screen in E2E with zero violations.
- **Responsive:** UX spec breakpoints; works at 375 px with no horizontal page scroll; tables become cards on phones.
- **Themes:** light, dark, system; tokens only, no hard-coded colours.
- **Performance:** initial JS < 250 KB gzipped; code-split routes; lazy-load admin screens and FullCalendar; dashboard interactive < 1.5 s against the local backend. The backend load test targets p95 < 200 ms, so no client-side caching tricks are needed beyond Query.
- **Security:** never render API HTML (markdown via `rehype-sanitize`); files only from `/api/attachments/{id}`; no sensitive data in URLs beyond ids and filters; temporary passwords shown once, in a copyable field, never stored or logged.
- **States:** empty, loading (skeletons) and error for every screen.
- **Forms:** zod schemas mirror server limits (title 1–200, comment 1–20,000, report 1–100,000, RSVP note ≤500, password 8–128, branch code `^[A-Z0-9]{2,10}$`, reminders ≤10 within 1 min–4 weeks, event end after start, mentions ≤50, files ≤25 MB). Disable submit while sending. Keep long-text drafts (comments, reports) in `localStorage` until sent.
- **Copy:** all strings through i18n keys.

---

## 8. Phases

The backend is complete for everything in this plan, so every phase builds against the real API, with MSW fixtures kept in step for tests and mock mode.

### F0: Scaffold
- Vite + React + TS, Tailwind + `tokens.css` from UX_SPEC, shadcn, TanStack Router/Query, i18n, theme, MSW (`dev:mock`), ESLint/Prettier, Vitest, Playwright.
- `pnpm api:types` against the running backend; write `api/types.ts` overrides (4.1); `client.ts` with `ApiError`.
- Scripts: `dev`, `dev:mock`, `build`, `typecheck`, `lint`, `test`, `e2e`, `api:types`.
- **Done when:** a clean clone runs `pnpm i && pnpm dev:mock` showing an empty shell, `pnpm dev` reaches `/api/healthz` through the proxy, and every script passes.

### F1: Design system
- Every component in the UX_SPEC inventory with all variants and states, on a dev-only `/dev/components` gallery in light and dark.
- `labels.ts` complete for every enum (4.6) and every error code.
- **Done when:** axe is clean on the gallery; `StatusBadge`, `TypeIcon`, `PriorityTag`, `DueLabel`, `RsvpControl` have unit tests over every enum value; label-completeness tests pass.

### F2: Sign-in, shell, branch context, live connection
- Sign-in, forced password change, sign-out; `RequireAuth`; error routing (4.2).
- App shell with role-based navigation, branch switcher (4.7), notification bell (count), **+ New**, command palette (navigation only).
- `usePeople`, `can.ts` (navigation checks), `stream.ts` + `useLiveUpdates` with the watchdog.
- Profile page with password change.
- **Done when:** E2E: sign in as a seeded member with a temporary password → forced change → Home; nav matches UX_SPEC for staff, branch admin and super admin; a two-branch user switches branches and the URL updates; killing the backend for 70 s and restarting reconnects the stream and refetches.

### F3: Items, comments, files
- Items list (filters as typed search params, list view), item detail per type, create flow with `RecipientPicker` (people, groups, and branches for super admins), edit with version handling, close/cancel, targets add/remove, watch, private badge, unread marks, history tab, `/i/:number` deep links.
- Comments with `@` mentions, staff-only toggle, edit/delete; attachments with progress and download.
- `can.ts` item-level rules with unit tests (4.3).
- **Done when:** E2E: a teacher creates a Ticket to a group, a technician replies with an attachment, the teacher closes it; a private item is invisible to a non-targeted teacher in the list, search and by URL (404 screen); two contexts editing the same title produce the conflict dialog.

### F4: Work, reports, approvals
- My work (joined with issue titles), Up for grabs, board view, every transition with the primary-button logic from UX_SPEC, assign/reassign picker, cancel.
- Report editor: start, autosave draft, hand in (report submit → work submit), resubmit after rejection.
- Approve (optional note, 5-second undo per UX_SPEC) and reject (note required); approvals queue; bulk approve with confirmation.
- **Done when:** E2E: admin sends a Report to Science "one each"; two teachers draft and hand in; admin approves one and rejects one with a note; the rejected teacher sees the note, edits and resubmits; a super-admin-approval item shows branch admins the "only a school admin" message and no approve button.

### F5: Events and calendar
- Calendar (month, week, agenda) from `/calendar`, with branch filter and my due dates overlay.
- Event create/edit (time, all-day, location, reminders, invitees), cancel; event detail with RSVP (+ note) and attendee list with counts.
- **Done when:** E2E: admin creates an event inviting a group; a teacher RSVPs going; the admin's counts update live without reload; cancelling notifies invitees (notification appears).

### F6: Notifications, dashboard, real-time polish
- Inbox (all/unread, mark read, mark all read, links to items), per-kind rendering, toasts from new notifications.
- Home dashboard per role from `/dashboard` (branch, all-my-branches and whole-school variants; hidden tiles for null numbers).
- "N new updates" pill and the edit-protection banner.
- **Done when:** E2E with two contexts: admin assigns work → the teacher's bell, toast and My work update within 3 s without reload, and a member of another branch receives nothing; dashboard numbers equal the matching filtered lists.

### F7: Administration and export
- Members (add by email with one-time temporary password, edit, remove, deactivate/reactivate, reset password).
- Groups (create, rename, archive/restore, delete with archive outcome, members).
- Permission editor driven by `/permissions` (plain-language rows, presets from UX_SPEC, scope and type controls, diff-based save bar), "Check a person".
- Branches and admins (super admin): create branch with first admin, edit, deactivate, appoint/remove admins, grant/revoke school admin.
- Export dialog.
- **Done when:** every super-admin-only control is absent for branch admins and staff; E2E: admin creates "Coordinators", grants `work_item.approve` at branch scope, adds a teacher → that teacher can approve on the next click (after the `permissions_changed` refetch); removing them takes it away; removing the last admin shows the `last_admin` copy; an export downloads a non-empty `.xlsx`.

### F8: Polish and hardening
- Responsive pass at 375 / 768 / 1280; full axe run; keyboard-only walkthrough of the "week in the app" flows; reduced-motion check; bundle budget; route error boundaries.
- README: setup, scripts, mock mode, regenerating types, production build (static files on the same origin as `/api`; see REFERENCE "Deploying" for proxy settings incl. SSE buffering).
- **Done when:** all E2E pass against a freshly seeded backend; budgets met; no console errors.

---

## 9. Out of scope (v1)

Email/SMS, self-service password reset, recurring items, term-based reporting, advanced search, calendar sync, native apps, offline mode, withdrawing a submission, reopening a closed issue, changing a deadline after sending, deleting attachments, branch-wide activity history screen, "sign out everywhere", mark as unread (none exist in the API; see UX_SPEC §12–13).

---

## 10. API gaps (raise with the backend)

**UX_SPEC §12.1 is the master list (G-1 … G-19)**; this plan uses the same numbers. The table below lists only what changes the build, plus three gaps that only matter to implementation (G-20 … G-22). Ordered by impact.

| # | Gap | Frontend workaround | Phase |
|---|---|---|---|
| G-20 | No per-item `can` object on `IssueDetail` / `WorkItem` | `can.ts` evaluates `/me` grants (4.3). It duplicates server rules, so it's the biggest maintenance risk | F3 |
| G-1 | `WorkItem` has no item context (key, title, type, priority, mode, `requires_super_admin_approval`) | Join with `IssueSummary` lists and cache `GET /issues/{id}` per distinct item (5) | F4 |
| G-2 | User ids only, no names | Member directory per branch (4.5); "Former member" fallback | F2 |
| G-3, G-4 | No `approvable=me` / `claimable=me` filters; `/me` lacks my groups | Client-side derivation (5, 4.3); lists may look short across pages | F4 |
| G-5, G-6 | `IssueSummary` lacks due/recipients/event fields; `/issues` has few filters | No Due/Sent-to columns, single-select quick views, no sort (5) | F3 |
| G-7 | No activity feed / audit endpoint | Home feed = my notifications; branch history screen deferred | F6 |
| G-8, G-9 | Notification kinds/payloads and history vocabulary undocumented | Per-kind/per-action renderers with generic fallbacks | F3, F6 |
| G-10, G-11 | No deadline change; no attachment delete | Not offered | — |
| G-12, G-19 | No school-wide user search; first admin must already exist | Merge all branches' member lists for pickers | F7 |
| G-13 | Grants change one call at a time | Sequenced save with partial-failure report (5) | F7 |
| G-14, G-15, G-16 | Dashboard semantics, calendar RSVP counts, export params undocumented or missing | Hide unknowns; fetch counts on popover open; verify export params in F7 | F5–F7 |
| G-21 | OpenAPI `Page_*` items untyped; some enums typed as `string` | Hand-written overrides in `api/types.ts` (4.1) | F0 |
| G-22 | Accepted upload MIME types undocumented | Rely on `unsupported_type` | F3 |

**Ask the backend first for G-20, G-1, G-2 and G-3/G-4.** Together they remove most client-side derivation code.

---

## 11. Open questions

UX_SPEC §12.2 holds the product questions (Q-1 … Q-12: name, "School admin" wording, ticket recipients, RSVP reset on time change, export date field, withdraw, approval undo, staff dashboard, board visibility, locale, self-filed reports, deadline changes). Resolve them before the phase where they apply. The plan adds two implementation questions:

- **Q-A, work state machine (backend, before F4).** Confirm the transitions in 4.3, in particular whether `blocked → submit` and `in_progress → open` exist.
- **Q-B, language and direction (product owner, before F0).** Which languages? If any are right-to-left (Persian, Arabic), build RTL from F0 with logical CSS properties only and `dir` set from the language.

Now settled by the spec: school admins may send any item type school-wide (`branch_id: null` with branch targets), and Home's "What's new" uses notifications (dashboard feed question).
