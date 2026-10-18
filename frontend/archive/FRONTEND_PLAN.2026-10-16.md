# Frontend implementation plan: school ticketing system

You are implementing the web frontend for a ticketing and work-coordination app
used by a school with several branches. Read this whole document, then
`design/UX_SPEC.md` and `design/prototype.html`, before writing code.

- **Work one phase at a time.** Keep `pnpm typecheck`, `pnpm lint` and `pnpm test` green at the end of each phase, and stop after each phase with a short summary.
- **The UX spec is the source of truth for what screens look like and how they behave.** This plan is the source of truth for how to build them.
- **If the two disagree, or something is missing, stop and ask.** Do not invent features, statuses or permissions.

Related documents:
- `../backend/BACKEND_PLAN.md`: the API, the rules and the permission model. Sections 6, 7 and 12 matter most.
- `../presentation/*.html`: the product description, permissions and data model in plain language.

---

## 1. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | |
| Build | Vite | Matches the backend's `APP_ORIGIN=http://localhost:5173` |
| UI library | React 19 | |
| Routing | TanStack Router (file-based) | Typed routes and typed search params for list filters |
| Server state | TanStack Query | Caching, invalidation from live events, optimistic updates |
| Styling | Tailwind CSS v4, with design tokens as CSS variables in `src/styles/tokens.css` | Tokens come from the UX spec |
| Primitives | shadcn/ui (Radix-based; components copied into the repo) | Accessible dialogs, menus, popovers, tabs, comboboxes |
| Icons | lucide-react | |
| Forms | react-hook-form + zod | |
| Dates | date-fns v4 + `@date-fns/tz` | Every date shown in the item's branch time zone |
| Calendar | FullCalendar (MIT core: daygrid, timegrid, list), themed with the tokens | Month, week and agenda views |
| Command palette / search | cmdk | |
| Toasts | sonner | |
| Markdown (report bodies, comments) | react-markdown + rehype-sanitize | Bodies are stored as text, rendered safely |
| i18n | i18next + react-i18next. Every user-facing string goes through `t()` from day one. | See the open question about language and RTL |
| API types | openapi-typescript + openapi-fetch, generated from the backend's OpenAPI document | |
| API mocks | MSW, in dev mode and in tests | Lets frontend work run ahead of the backend |
| Tests | Vitest + Testing Library (unit and component), Playwright (end-to-end) | |
| Quality | ESLint (typescript-eslint, jsx-a11y, react-hooks), Prettier | |
| Package manager | pnpm | |

- **Versions:** add packages with `pnpm add` to get current versions, and commit the lockfile.
- **No other state library.** Server state lives in TanStack Query. UI state uses React state and the URL.

---

## 2. Design

`design/UX_SPEC.md` defines the following. Implement it faithfully.
- the app shell and navigation for each role
- every screen with its empty, loading and error states
- the user flows
- the visual language for statuses
- design tokens, the component inventory, and the responsive and accessibility rules
- microcopy

`design/prototype.html` shows the intended look and feel. Match its spacing, hierarchy and motion, but build everything from the component library, not by copying its markup.

**Language rule:** the UI never shows technical words. UX_SPEC §2 is the complete vocabulary table: for example `work_item` is "assignment", `pending_approval` is "Waiting for approval", and `is_super_admin` is "School admin". Put it in `src/lib/labels.ts` as i18n keys, as the single place where these words are defined.

### 2.1 UX decisions to know before you start

The UX spec is long. These decisions shape the code structure, so read them first:

- **Navigation:**
  - On desktop, a 248 px sidebar (collapsible to an icon rail) with the branch switcher at the top, and a top bar with search, live indicator, bell and **+ New**.
  - On phones, a bottom nav (Home · My work · + · Calendar · Inbox) plus a drawer (UX_SPEC §3, D-15).
- **Branch context:**
  - Kept in `?branch=` and localStorage.
  - "All my branches" for people in several branches, and "Whole school" for school admins.
  - Manage pages always cover a single branch (D-07).
- **One primary button for each item**, chosen from the item's type, status and the viewer's role (UX_SPEC §1 principle 4, §5.7).
- **Board view** shows assignments by status. Drag is allowed only for start, block and unblock; submitting and approving never happen by drag (D-09).
- **Approving has a 5-second undo** before the API call is sent (D-10). Approving from lists is allowed, and bulk approve asks for confirmation (D-19).
- **Reports are plain text.** "Hand in report" calls the report submit and the assignment submit in sequence (D-11, D-12).
- **The calendar** can show my due dates alongside events, built from `/work-items?assignee=me` (D-13).
- **System fonts only**, with no web fonts (D-14). Tokens are in UX_SPEC §8.
- **The permission editor** (UX_SPEC §5.13): plain-language rows, presets, reach controls, a sticky save bar with a confirmation in plain sentences, and a "Check a person" panel driven by the effective-permissions endpoint.

### 2.2 Where this plan overrides the UX spec

- **UX_SPEC §14 (deciding what to show).** Do not re-create the full permission rules in TypeScript.
  - Use `/me` only for navigation and screen-level decisions (§3.3 of the spec).
  - For buttons on items and assignments, use the server-provided `can` object (section 4.3 below). If that isn't available yet, use the mock.
  - A small `can.ts` helper may combine the two sources, but must not re-derive item-level permissions.
- **Product name.** "Staffroom" is a placeholder (UX_SPEC Q1). Keep it in one constant, `APP_NAME`, and one logo component, so it can be renamed in one place.

---

## 3. Project layout

```text
frontend/
  design/                     # UX_SPEC.md, prototype.html (input, do not edit)
  public/
  src/
    main.tsx
    app/
      providers.tsx           # QueryClient, Router, i18n, Theme, Toaster
      AppShell.tsx            # sidebar / top bar / bottom nav per UX spec
      BranchContext.tsx       # current branch, switcher state
      ThemeProvider.tsx       # light / dark / system
    routes/                   # TanStack Router file routes (one folder per screen)
    api/
      schema.d.ts             # generated: pnpm api:types
      client.ts               # openapi-fetch instance, error normalization
      keys.ts                 # query-key factory (single source for invalidation)
      hooks/                  # useIssues, useIssue, useWorkItems, useNotifications, ...
    realtime/
      stream.ts               # EventSource wrapper, reconnect handling
      useLiveUpdates.ts       # event -> query invalidation, "new updates" pill state
    auth/
      useSession.ts           # GET /api/me, sign-in / out, password change gate
      RequireAuth.tsx
    features/
      dashboard/ items/ create/ work/ reports/ events/ calendar/
      inbox/ members/ groups/ branches/ export/ profile/ history/
    components/
      ui/                     # shadcn primitives
      common/                 # StatusBadge, TypeIcon, PriorityTag, UserAvatar,
                              # RecipientPicker, MentionTextarea, EmptyState,
                              # ConflictDialog, PrivateBadge, DueLabel, ...
    lib/
      labels.ts  dates.ts  format.ts  i18n.ts  can.ts
    styles/
      tokens.css  globals.css
  mocks/
    handlers/                 # MSW handlers, one file per API area
    fixtures/                 # realistic school data (2–3 branches, ~30 people)
  e2e/                        # Playwright specs
  index.html  vite.config.ts  tsconfig.json  package.json
```

---

## 4. Talking to the backend

### 4.1 Dev setup
- **Proxy.** Vite proxies `/api` to `http://127.0.0.1:8080`, so the browser sees one origin. The session cookie then works without any CORS setup, and the browser's `Origin` header (`http://localhost:5173`) matches the backend's `APP_ORIGIN` check.
- **Mock mode.** `pnpm dev` runs against the real backend. `pnpm dev:mock` runs against MSW with the fixtures. Every screen must work in mock mode.
- **Generated types.** `pnpm api:types` regenerates `src/api/schema.d.ts` from `http://127.0.0.1:8080/api/openapi.json`. Until the backend publishes OpenAPI, hand-write types in `src/api/types.ts` that follow BACKEND_PLAN section 12 exactly. Replace them when the generated file is available.

### 4.2 Sessions and errors
- **Session.** A cookie session, so requests are made with `credentials: 'same-origin'`. Never store tokens in JavaScript.

| Response | What the frontend does |
|---|---|
| `401` | Clear the query cache and redirect to sign-in, keeping the return path |
| `403 password_change_required` | Route to the forced password change screen; nothing else is reachable |
| `403` (other) | Show "You don't have permission to do that" inline. Hide the control next time, by refetching `can` (4.3) |
| `404` | "This item doesn't exist or you don't have access". Never distinguish the two |
| `409 version_conflict` | `ConflictDialog`: "Someone else changed this. Review the latest version and try again." It refetches and keeps the user's unsaved text |
| `409` (other, e.g. `last_admin`) | Show the server message mapped to friendly copy in `labels.ts` |
| `422` | Map `field` errors onto the form fields; otherwise show a form-level message |

- **Error codes** live in one `ApiError` type. Map every error code from BACKEND_PLAN to copy in `labels.ts`.

### 4.3 Showing only what the user can do
The server enforces every permission. The UI's job is to **hide or disable** controls the user can't use, without copying the permission rules into TypeScript.

- **`GET /api/me`** returns the user's memberships and effective permissions per branch. Use it for navigation-level decisions, such as whether to show Members, Groups, Export or Create action.
- **Per-item actions:** the frontend needs a `can` object on issue and work item responses, for example:
  ```json
  "can": { "edit": true, "close": false, "set_private": false, "target": true,
           "comment": true, "comment_internal": false,
           "update": true, "assign": false, "claim": true, "approve": false, "rsvp": true }
  ```
  Use it for every button on the detail screens.

  **This is a small backend addition not in BACKEND_PLAN.** The backend computes it with the same `authorize()` function. Flag it to the backend work before phase F3. Until it exists, mock it in MSW.
- **`src/lib/can.ts`** wraps both sources so components never read raw permission data.

### 4.4 Query keys and caching
- `keys.ts` defines every key. Examples:
  - `['issues', 'list', filters]`
  - `['issues', 'detail', id]`
  - `['work-items', 'mine']`
  - `['dashboard', branchId]`
  - `['notifications', 'unread-count']`
- **Freshness:** set `staleTime` to 30 s by default. Live events (section 5) keep data fresh, so no polling is needed.
- **Optimistic updates** for:
  - marking notifications read
  - RSVP
  - claiming an assignment
  - watch / unwatch

  Roll back on error. Everything else waits for the server.
- **Lists use keyset pagination** (`after` cursor). Use `useInfiniteQuery` with a "Load more" button or infinite scroll, as the UX spec says.

### 4.5 Branch context
- **One branch:** the current branch is part of the URL (`?branch=NTH`) so links are shareable. The last choice is remembered in `localStorage`, wrapped in try/catch.
- **Several branches:** users with more than one membership also get an "All my branches" option wherever the UX spec allows it.
- **Super admins** can pick any branch, or "Whole school".
- **Dates** show in the item's branch time zone (from the branch list). If that differs from the browser's time zone, show the zone abbreviation.

---

## 5. Real-time updates

- **Connection.** `realtime/stream.ts` opens one `EventSource('/api/stream')` per tab after sign-in. EventSource reconnects by itself. On every (re)connect, invalidate all active queries once to catch up.
- **Event shape.** Events are small: `{kind, issue_id, branch_ids, recipient_ids}`. `useLiveUpdates` maps each to invalidations through `keys.ts`:

| Event | Invalidate |
|---|---|
| Any event with `issue_id` | That issue's detail, its comments and work items, and lists containing it |
| An event naming me in `recipient_ids` | Notifications, unread count, my work |
| Branch-level events | That branch's dashboard |

- **Batching.** Collect events and run the invalidations at most once every 2 s.
- **Don't disturb the user**, following the UX spec's real-time rules:
  - Lists the user is reading don't reorder under them. Show a "N new updates" pill that applies the changes when clicked.
  - On an item detail screen with an open editor, don't refetch over unsaved text. Show "This item was updated" with a reload action.
  - Show a toast only for events addressed to me (assigned, mentioned, approved or rejected).
- **Unread count.** The notification bell's count updates live. When the count rises, add the new count to the tab title.
- **Respect reduced motion.** No highlight animations when the user prefers reduced motion.

---

## 6. Cross-cutting requirements

- **Accessibility:** WCAG 2.2 AA. Everything works by keyboard, with visible focus and labelled controls.
  - Status is never shown by color alone; always add an icon and text.
  - Dialogs trap focus and restore it when closed.
  - Run `@axe-core/playwright` on every screen in end-to-end tests, with zero violations.
- **Responsive:** follow the UX spec's breakpoints. Everything must work at 375 px wide with no horizontal page scroll. Tables become cards on phones.
- **Themes:** light, dark and system, using tokens only. No hard-coded colors in components.
- **Performance:**
  - initial JavaScript under 250 KB gzipped
  - code-split routes; lazy-load the admin screens and FullCalendar
  - the dashboard becomes interactive in under 1.5 s on a mid-range laptop against the local backend
- **Security:**
  - Never render HTML from the API. Markdown goes through `rehype-sanitize`.
  - Attachments are downloaded from `/api/attachments/{id}` only.
  - No sensitive data in URLs beyond IDs and filter values.
- **Empty, loading and error states** for every screen, as the UX spec lists. Use skeletons, not spinners, for content areas.
- **Forms:**
  - validate with zod, mirroring server limits (title 1–200 characters, attachments up to 25 MB with the allowed types)
  - disable submit while sending
  - keep drafts of long text (reports, comments) in `localStorage` until sent
- **Copy:** every string goes through i18n keys. No user-visible text written directly in components.

---

## 7. Phases

Each phase depends on the backend phase shown. Until that backend phase is done, build against MSW mocks, and switch to the real API when it lands.

| Phase | Needs backend phase |
|---|---|
| F0, F1 | none |
| F2 | 1 (auth) |
| F3 | 3 (issues) and 4 (comments, attachments) |
| F4 | 3 and 4 (reports) |
| F5 | 5 (events) |
| F6 | 6 (notifications, stream) and 7 (dashboard) |
| F7 | 2 (organisation) and 7 (export) |

### F0: Scaffold
- **Build:**
  - Vite + React + TypeScript, Tailwind with `tokens.css` from the UX spec, shadcn setup
  - TanStack Router and Query, i18n, the theme provider, MSW (`dev:mock`)
  - ESLint and Prettier, Vitest, Playwright
  - scripts: `dev`, `dev:mock`, `build`, `typecheck`, `lint`, `test`, `e2e`, `api:types`
- **Done when:** a clean clone runs `pnpm i && pnpm dev:mock` and shows an empty app shell, and every script passes.

### F1: Design system
- **Build:** every component in the UX spec's component inventory, with all variants and states. Add a `/dev/components` route, available in dev builds only, that shows each component in light and dark.
- **Done when:**
  - every component in the inventory is on the gallery page
  - axe reports no violations there
  - `StatusBadge`, `TypeIcon`, `PriorityTag` and `DueLabel` have unit tests covering every status value from BACKEND_PLAN

### F2: Sign-in, shell, branch context
- **Build:**
  - sign-in, forced password change and sign-out
  - the app shell with role-dependent navigation, branch switcher, notification bell (count only), Create button and command palette (navigation only for now)
  - the profile and settings page
- **Done when:**
  - end-to-end test: sign in as a seeded teacher, get the forced password change, land on Home
  - navigation entries match the UX spec for each of the three roles
  - a user in two branches can switch between them, and the URL updates

### F3: Items
- **Build:**
  - the Items list (filters in typed search params, saved views and list/board views as the UX spec defines)
  - item detail with the layout for each type
  - the create flow (type, details, recipients, review) with `RecipientPicker` for users, groups and, for super admins, branches
  - comments with `@` mentions, staff-only comments, attachments (upload with progress, download)
  - watch, private badge, activity history tab, unread markers
- **Done when:**
  - end-to-end test: a teacher creates a Ticket to a group, a technician replies, the teacher closes it
  - a private item is not visible to a non-targeted teacher in the list, search or a direct URL (which shows the 404 screen)
  - a version conflict shows the conflict dialog

### F4: Assignments, reports, approvals
- **Build:**
  - My work
  - assignment states and controls (start, block, unblock, submit, claim, reassign, cancel)
  - the report editor (draft, autosave, submit)
  - approve and reject (a reason is required to reject)
  - the "Waiting for my approval" queue
- **Done when:**
  - end-to-end test: an admin sends a Report to a group as one each, two teachers draft and submit, the admin approves one and rejects one with a reason, and the rejected teacher sees the reason and resubmits
  - a super admin item shows the branch admin "Only a super admin can approve this"

### F5: Events and calendar
- **Build:**
  - the calendar (month, week, agenda) with branch and "my events" filters
  - event detail with RSVP and the attendee list with counts
  - creating and editing events (time, all-day, location, reminders, invitees)
  - cancelling events
- **Done when:**
  - end-to-end test: an admin creates an event inviting a group, a teacher RSVPs going, and the admin sees the counts update live
  - changing the time shows invitees an "Event time changed, please confirm" prompt

### F6: Notifications, real time, dashboard
- **Build:**
  - the inbox (filters, mark read, mark all read, links to items)
  - the live stream (section 5), toasts, and the "new updates" pill
  - the Home dashboard for each role, as the UX spec defines
- **Done when:**
  - end-to-end test with two browser contexts: the admin assigns work, the teacher's bell and My work update within 3 s without a reload, and a member of another branch receives nothing
  - dashboard numbers equal the counts of the matching filtered lists

### F7: Administration
- **Build:**
  - branch members (add by email and show the temporary password once, remove, reset password, deactivate)
  - groups (create, rename, archive, members)
  - the permission editor (plain-language toggles and presets as the UX spec defines; reach limited to "their own", "sent to them" or "whole branch"; optional per item kind)
  - "Where does this permission come from?" for a member
  - branches and admins (super admin): create a branch with its first admin, appoint and remove admins, with the last-admin error shown clearly
  - the export dialog (branches, item kinds, date range; download `.xlsx`)
- **Done when:**
  - every reserved action from BACKEND_PLAN 6.2 is absent from the UI for roles that can't perform it, and the matching API error copy exists anyway
  - end-to-end test: an admin creates "Coordinators" with the approve permission, adds a teacher, and that teacher can approve on their next click
  - removing them takes the ability away again

### F8: Polish and hardening
- **Build:**
  - a responsive pass of every screen at 375, 768 and 1280 px
  - a full axe run, a keyboard-only walkthrough of the five key flows, and a reduced-motion check
  - a bundle size check, and error boundaries for each route
  - a README covering setup, scripts, mock mode, regenerating API types and how to build for production (static files served behind the same origin as `/api`)
- **Done when:** every end-to-end test passes against the real backend with seed data, accessibility and performance budgets are met, and there are no console errors in any flow.

---

## 8. Out of scope

- Email or SMS (not in the product yet)
- Offline mode
- Native mobile apps; the web app must work well on phones instead
- Calendar sync (iCal)
- Recurring items

## 9. Backend additions the frontend needs

These aren't in BACKEND_PLAN yet. Raise them with the backend work. Until they land, mock them in MSW.

| # | Addition | Needed by | Why |
|---|---|---|---|
| B1 | `can` object on issue and work item responses (section 4.3) | F3 | Buttons without copying the permission rules into TypeScript |
| B2 | `/api/openapi.json` from backend phase 1 | F0–F2 | Generated types |
| B3 | `GET /work-items?approvable_by=me` | F4 | Approvals queue and badge (UX_SPEC Q2) |
| B4 | `GET /work-items?claimable=me` (unassigned shared work for my groups) | F4 | "Up for grabs" on My work (UX_SPEC Q6) |
| B5 | Extra list filters: `created_by=me`, `priority`, `overdue=true`, `sort` | F3 | Items list filters (UX_SPEC Q5) |
| B6 | Way to create the first admin's account while creating a branch | F7 | New-branch dialog (UX_SPEC Q10) |

## 10. Open questions for the product owner

Resolve these before F3. The full list is UX_SPEC §16.

1. **Language and direction.** Which languages does the school use? If any are right-to-left (such as Persian or Arabic), build RTL from F0: use logical CSS properties only (`ms-`/`me-`, `start`/`end`), and set `dir` from the language.
2. **Product name.** "Staffroom" is a placeholder.
3. **Withdrawing a submission.** May someone pull back work that is waiting for approval? This isn't in the state machine today.
4. **Cross-branch tickets and events.** Can school admins create Tickets and Events across branches, or only Actions and Reports?
5. **Password rules.** What are the minimum rules, and does changing your own password require the current one?
