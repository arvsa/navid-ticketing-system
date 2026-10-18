# School ticketing frontend

The web app for the school ticketing system: Home dashboards, items (tickets,
actions, reports, events), assignments and approvals, calendar and RSVPs, inbox,
and branch administration. It talks to the Rust backend in `../backend`.

Built with React 19, TypeScript, Vite, TanStack Router and Query, and Tailwind v4.
Screens follow the designs in `../School Ticketing UI-png` and the behaviour in
`design/UX_SPEC.md`.

## Run it

1. Start the backend (see `../backend/README.md`): database, `seed-demo`, then
   `cargo run`. It must allow the frontend's origin: `APP_ORIGIN=http://localhost:5173`
   and `COOKIE_SECURE=false` (the defaults in `.env.example`).
2. Install and start the frontend:

   ```sh
   pnpm install
   pnpm dev
   ```

3. Open http://localhost:5173 and sign in with a demo account, password
   `demo-password`:
   - `superadmin@demo.school` — super admin, sees the whole school
   - `admin@north.demo.school` — North Campus admin
   - `member4@north.demo.school` — a staff member

Vite proxies `/api` to `http://127.0.0.1:8080`, keeps the browser's `Origin`
header (the backend checks it on every non-GET request), and doesn't buffer the
live-updates stream (`/api/stream`).

## Scripts

| Script | Does |
|---|---|
| `pnpm dev` | Dev server on port 5173 |
| `pnpm build` | Typecheck and build static files into `dist/` |
| `pnpm typecheck` | TypeScript only |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm api:types` | Regenerate `src/api/schema.d.ts` from the running backend |

In production, serve `dist/` from the same origin as `/api`, and turn off
response buffering for `/api/stream` (see the backend's REFERENCE "Deploying").

## Layout

```text
src/
  api/        generated schema, fixed-up types, fetch client, query keys, hooks
  app/        router, shell (sidebar, top bar, phone nav), branch context, theme
  auth/       session, sign in, password change
  realtime/   live updates (SSE with heartbeat watchdog, debounced refetching, toasts)
  people/     id → name directory built from branch member lists
  lib/        labels (all UI words for API values), dates, permissions (can.ts),
              notification and history sentences, item helpers
  components/ buttons, dialogs, badges, pickers, files
  features/   home, items, work, events, calendar, inbox, create, admin, profile
```

`src/lib/labels.ts` is the only place API values become words on screen.
`src/lib/can.ts` decides which controls to show; the server still checks
everything, and when the client is unsure it shows the control.

## Differences from the plan and designs

These follow from what the API can return today (gap numbers are from
`design/UX_SPEC.md` §12):

- **Items list** has no "Sent to" or "Due" columns and no group/due/priority
  filters: `IssueSummary` doesn't carry them and `/issues` can't filter by them
  (G-5, G-6). Tabs are "Whole branch" and "Assigned to me".
- **"Work you sent out"** on Home looks at the 50 most recent open items and keeps
  the ones you created, because there's no "created by me" filter (G-6).
- **Activity history** for a whole branch isn't built: there's no endpoint (G-7).
  Each item has its own History tab.
- **Assignments** have no item title (G-1), so their items are fetched and cached
  separately; names come from member lists (G-2); "up for grabs" and "sent to me"
  need the groups you're in, which are worked out from group member lists (G-4).
- **Super admins card** can't list every super admin (G-12).
- The backend's OpenAPI document references an undefined `Transition` schema and
  repeats operation ids; `scripts/gen-api-types.mjs` patches both before
  generating types.

Not done yet from `FRONTEND_PLAN.md`: i18n (all copy is in English, words for
API values are centralised in `labels.ts`), MSW mock mode, Playwright end-to-end
tests, the board view, the command palette, and the week view of the calendar.
