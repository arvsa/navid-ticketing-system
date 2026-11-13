# End-to-end: a day at the school

`org-day.spec.ts` runs a whole school day through the UI with Playwright, in
the installed Google Chrome, against the **running dev stack**
(`cargo run` in `backend/`, `pnpm dev` here):

1. The root user opens four branches, imports their people from Excel
   (`fixtures/roster-*.xlsx`) and appoints each principal as branch admin.
2. Roles and departments (CEO Office, Principals, Teachers, IT, Health) as
   school-wide groups with permissions; four templates.
3. Each principal signs in for the first time and staffs their groups; Azar
   also gets an "IT Leads" group (the nearest thing to a department admin).
4–6. A principal asks every teacher for midterm grades (written report + file);
   teachers start, get blocked, hand in; the principal approves, sends one back,
   bulk-approves.
7–8. Teachers send tickets to whole departments (IT, Health), who answer and close.
9–10. School-wide and branch events with replies; the calendar.
11–12. Filtering and exporting items; hiring, password resets, deactivating.
13–14. Inbox, directory, profile, search; the root user's view; Farsi screenshots.

```sh
pnpm test:e2e                       # E2E_ROOT_EMAIL / E2E_ROOT_PASSWORD for the root user
python3 e2e/fixtures/make_rosters.py   # rebuild the Excel rosters
```

It fills the database it runs on and leaves the data there. Start from an
empty database with only a root user. Reruns reuse what exists (item numbers
are kept in `.state/values.json`; passwords chosen at first sign-in in
`.state/creds.json`). Temporary passwords are read with the backend's `users`
tool, so build it first (`cargo build --bins`). Screenshots go to
`.state/shots/`, problems found to `.state/findings.md`.
