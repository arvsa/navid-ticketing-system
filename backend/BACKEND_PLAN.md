# Backend implementation plan: school ticketing system

You are implementing the Rust backend for a ticketing web app used by a school
with several branches. Read this whole document before writing code. Work one
phase at a time, keep the build and tests green at the end of every phase, and
stop after each phase with a short summary of what was built and anything you
had to decide.

The database schema is final and lives in `schema.sql` next to this file. Use it
verbatim as the first migration. Any schema change after that goes in a new
migration file; never edit `0001_init.sql` once it exists.

If something in this plan is ambiguous or seems wrong, stop and ask. Do not
invent permissions, statuses or rules that are not written here.

---

## 1. Product in one page

- **Branches.** The school has branches. People are members of one or more branches.
- **Roles.**
  - **Super admin:** global and unrestricted.
  - **Branch admin:** a per-branch flag on the membership. Only a super admin sets or clears it.
  - **Everyone else:** a member whose abilities come from their groups.
- **Groups.**
  - Groups live inside one branch. Only that branch's admins create, edit, archive or delete them, add or remove members, and grant them permissions.
  - Members inherit every permission of every group they are in, in that branch only.
  - An admin may grant a group everything, making it admin-like inside the branch. A few actions are reserved and can never be granted.
- **"All members".** Every branch has this default group. Everyone in the branch is in it automatically, and it carries the baseline permissions that the admin can adjust.
- **Issues.** There are four types:
  - **Ticket:** a question or request. Anyone may create one in their branch. It is answered in comments and closed by its creator or an admin.
  - **Action:** a task sent to people or groups. Each recipient's work goes `open → in_progress → submitted → approved`.
  - **Report:** like an Action, but submitting requires a written report. Anyone may also file a report for themselves and close it.
  - **Event:** a calendar entry with invitees, RSVPs and reminders. The creator is the organizer, as in Outlook.
- **Targets.** An issue is sent to users or groups in its branch. Super admins may also send an issue to whole branches, including several at once.
- **Private issues.** An admin (or a permitted group) can mark an issue private. It is then hidden from members who did not create it and are not targeted by it.
- **Approval.**
  - Work on an issue a super admin created is approved only by a super admin.
  - Other work is approved by the branch admin or a group holding `work_item.approve`.
- **Notifications.** They appear in the in-app inbox and live on the dashboard. There is no email or SMS in this version.
- **Real-time dashboard.** The dashboard updates live for each branch.
- **Excel export.** Admins export their branch. Super admins export any or all branches.
- **Scale.** About 100 users, at most about 50 active at once. Optimize for correctness and clarity, not throughput.

---

## 2. Tech stack

| Concern | Choice |
|---|---|
| Language | Rust stable, edition 2021 |
| HTTP | `axum` (latest 0.8.x), `tower-http` (trace, cors, request size limit, compression) |
| Async | `tokio` |
| Database | PostgreSQL 16, `sqlx` (postgres, runtime-tokio, tls-rustls, uuid, time, json, macros, migrate) |
| Serialization | `serde`, `serde_json` |
| Time / IDs | `time` (with serde), `uuid` v4 |
| Passwords | `argon2` (argon2id, default params) |
| Tokens | `rand` (32 random bytes), `sha2` for storing token hashes |
| Errors | `thiserror` for domain errors, a single `AppError` → HTTP mapping |
| Logging | `tracing`, `tracing-subscriber` (JSON in prod, pretty in dev) |
| Excel | `rust_xlsxwriter` |
| Config | Environment variables loaded into one `Config` struct (`dotenvy` in dev) |
| Tests | `sqlx::test` against a real Postgres from `docker compose` |

- **Versions:** add crates with `cargo add` to get current versions, and commit `Cargo.lock`.
- **Database layer:** do not add an ORM. Use `sqlx::query!` / `query_as!` with compile-time checking. Commit the `.sqlx` offline data so CI builds without a database.

---

## 3. Project layout

```text
backend/
  Cargo.toml
  docker-compose.yml          # postgres:16 for dev and tests
  .env.example
  migrations/
    0001_init.sql             # = schema.sql, verbatim
  src/
    main.rs                   # build Config, pool, router; spawn listener + jobs
    config.rs
    error.rs                  # AppError, IntoResponse, error codes
    db.rs                     # pool, transaction helper
    bin/admin.rs              # CLI: create-super-admin, reset-password
    auth/
      password.rs             # hash / verify
      session.rs              # create, look up, revoke
      middleware.rs           # cookie -> Actor extractor
    authz/
      permission.rs           # Permission enum = permission table
      actor.rs                # Actor, BranchAccess, Grant
      policy.rs               # authorize(actor, action, resource)
      filter.rs               # visible_issue_filter(actor) -> SQL fragment + binds
      relations.rs            # loads own/targeted facts for a resource
    domain/
      branches.rs  members.rs  groups.rs  permissions.rs
      issues.rs  targets.rs  work_items.rs
      comments.rs  reports.rs  attachments.rs  events.rs
      notifications.rs  dashboard.rs  exports.rs  audit.rs
    http/
      mod.rs                  # router assembly
      branches.rs  members.rs  groups.rs  issues.rs  work_items.rs
      comments.rs  reports.rs  attachments.rs  events.rs
      notifications.rs  dashboard.rs  exports.rs  auth.rs  stream.rs
    realtime/
      listener.rs             # LISTEN app_events -> broadcast channel
      stream.rs               # SSE endpoint, per-connection filtering
    jobs/
      mod.rs                  # leader election via pg advisory lock
      sla.rs  reminders.rs  cleanup.rs
    storage/
      mod.rs                  # trait ObjectStore
      local.rs                # local-disk implementation (dev and v1 prod)
  tests/
    authz_matrix.rs           # table-driven permission tests (section 6.6)
    ...
```

**Layering rule:**
- `http` handlers parse and validate input, then call `domain`.
- `domain` functions take `&Actor`, call `authz`, run SQL inside a transaction, write audit and notification rows, and emit realtime events.
- Handlers never check permissions themselves.

---

## 4. Cross-cutting conventions

- **Transactions.** Every mutating domain function runs in one transaction. The audit row, the notification rows and the `pg_notify` call happen inside that same transaction, so they commit or roll back together. `NOTIFY` is delivered only on commit, which is exactly what we want.
- **Optimistic locking.** `issue`, `work_item` and `issue_report` carry `version`.
  - Clients send the version they last saw.
  - Updates run `UPDATE ... SET ..., version = version + 1 WHERE id = $1 AND version = $2`.
  - Zero rows updated means `409 Conflict` with code `version_conflict`.
- **Errors.** The JSON shape is `{"error": {"code": "snake_case_code", "message": "human text"}}`.
  - `401`: not signed in.
  - `403`: signed in, can see the thing, but may not do this.
  - `404`: not found **or not readable**. Never reveal that a private issue exists.
  - `409`: version conflicts and invariant violations, such as removing the last admin.
  - `422`: validation errors.
  - Map Postgres errors raised by the schema's triggers and constraints to `409` or `422` with readable codes. Do not leak SQL text.
- **Time.** Store `timestamptz`, and send RFC 3339 UTC in the API. `branch.timezone` (an IANA name, validated with `time-tz` or `chrono-tz` on write) is used only to compute "today", "this week", and reminder and SLA display on the server side.
- **Pagination.** Use keyset pagination (`?after=<cursor>&limit=50`, max 200) on every list.
- **IDs.** UUIDs in URLs. Issues also have a `number`, displayed as `ISS-<number>`. Support `GET /api/issues/by-number/{n}`.
- **No hard deletes** of issues, work items, memberships or users.
  - Issues are cancelled or closed.
  - Memberships end via `left_at`.
  - Users are deactivated via `is_active = false`.
  - Comments are soft-deleted via `deleted_at`.
  - Groups that are referenced by targets are archived (`archived_at`). Only unreferenced groups may be hard-deleted.
- **Audit.** Write an `audit_log` row for every change to:
  - issues, targets, work items and approvals
  - memberships and admin flags
  - groups, group members and group permissions
  - user activation and super admin status
  - exports

  Use `entity_type` / `entity_id` / `branch_id` / `action` / `old_value` / `new_value` (JSON of only the changed fields).

---

## 5. Authentication

- **Bootstrap.** Running `cargo run --bin admin -- create-super-admin --email x --first-name y --last-name z` creates the first super admin and prints a one-time temporary password. The app is unusable until this has been run. This is the only way to create a user without an existing super admin.
- **Login.** `POST /api/auth/login` takes `{email, password}`.
  - On success, generate a 32-byte random token and store its sha256 in `user_session` with `expires_at = now + 7 days`.
  - Set a cookie `sid` with HttpOnly, Secure (off in dev), SameSite=Lax and Path=/.
  - Update `last_login_at`.
- **Lockout.** After 5 consecutive failures, set `locked_until = now + 15 min`. Reset the count on success. Always answer `401 invalid_credentials`, whether the email exists or not.
- **Session lookup** happens on every request.
  - Reject the session if it is revoked, expired, or the user is inactive.
  - Slide `last_seen_at` at most once a minute.
  - Treat a session idle for more than 12 hours as expired.
- **`must_change_password`.** While true, every endpoint except `GET /api/me`, `POST /api/me/password` and logout returns `403 password_change_required`.
- **No email reset.** There is no email in v1. Admins reset passwords for members they manage (see `member.manage`), which sets a temp password and `must_change_password = true` and revokes that user's sessions.
- **CSRF.** For non-GET requests, require the `Origin` header to match the configured app origin. SameSite=Lax covers the rest.
- **Endpoints.** `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me` (profile, memberships, effective permissions per branch), `POST /api/me/password`.

---

## 6. Authorization (the core of the system)

### 6.1 The permission catalog

`authz/permission.rs` defines an enum whose variants map 1:1 to rows of the `permission` table. Add a startup check that the enum and the table agree, and fail fast if they don't.

| Key | Per issue type | Allowed scopes | Meaning |
|---|---|---|---|
| `issue.read` | yes | own, targeted, branch | View issues. At `branch` scope, private issues are excluded. |
| `issue.read_private` | yes | branch | View private issues in the branch |
| `issue.create` | yes | branch | Create issues of the type in the branch |
| `issue.edit` | yes | own, branch | Edit title, description, priority, event details |
| `issue.close` | yes | own, branch | Close or cancel an issue |
| `issue.set_private` | yes | own, branch | Toggle `is_private` |
| `issue.target` | yes | own, branch | Add or remove targets (users or groups in the branch) |
| `work_item.update` | yes | targeted, branch | Change work status, submit for approval |
| `work_item.assign` | yes | targeted, branch | Assign or reassign. At `targeted` scope: only claim an unassigned shared item for yourself. |
| `work_item.approve` | yes | branch | Approve or reject submitted work |
| `comment.create` | no | targeted, branch | Comment on readable issues (`targeted`: only issues you are targeted by or created) |
| `comment.internal` | no | branch | Read and write `is_internal_only` comments |
| `comment.moderate` | no | branch | Soft-delete other people's comments |
| `member.view` | no | branch | See the branch member directory |
| `member.manage` | no | branch | Add and remove **non-admin** members, edit their profile, reset their password |
| `dashboard.branch` | no | branch | See branch-wide dashboard numbers (without it: only your own) |
| `export.run` | no | branch | Export this branch to Excel |

**Scopes:**
- **`own`:** the actor created the issue (`issue.created_by`).
- **`targeted`:** any of these is true:
  - the actor is a `user` target of the issue
  - the actor is a current member of a `group` target
  - the actor is a current member of a `branch` target's branch
  - the actor is the assignee of a work item on the issue

  For work-item actions, `targeted` means the actor is the assignee. For an unassigned shared item, it means a member of the item's target group or branch.
- **`branch`:** any issue or work item in that branch.

A grant with `issue_type_id = NULL` applies to all four types.

### 6.2 Actions that can never be granted (hard-coded)

**Super admin only:**
- create, edit or deactivate branches
- set or clear `branch_membership.is_admin`
- set or clear `app_user.is_super_admin`
- create cross-branch issues (`issue.branch_id IS NULL`) and `branch`-kind targets
- approve or reject work where `issue.requires_super_admin_approval`
- edit, close, cancel, retarget or change privacy of an issue where `requires_super_admin_approval`
- export more than one branch in one request
- deactivate a user who belongs to more than one branch, or who is an admin

**Branch admin (or super admin) only:**
- create, rename, archive or delete groups
- add or remove group members
- grant or revoke group permissions
- edit the "All members" baseline grants
- act on another admin's membership or profile
- reactivate a departed member

A group may hold every grantable permission, but none of the actions above.

### 6.3 The Actor

Build the `Actor` once per request in the auth middleware, with two queries:

```sql
-- memberships
SELECT branch_id, is_admin FROM branch_membership
WHERE user_id = $1 AND left_at IS NULL;

-- grants via groups (active groups only)
SELECT gm.branch_id, gp.permission_key, gp.issue_type_id, gp.scope
FROM group_member gm
JOIN user_group g        ON g.id = gm.group_id AND g.archived_at IS NULL
JOIN group_permission gp ON gp.group_id = g.id
WHERE gm.user_id = $1;
```

```rust
pub struct Actor {
    pub user_id: Uuid,
    pub is_super_admin: bool,
    pub branches: HashMap<Uuid, BranchAccess>, // only current memberships
}
pub struct BranchAccess {
    pub is_admin: bool,
    pub grants: Vec<Grant>, // union of all group grants in this branch
}
pub struct Grant { pub permission: Permission, pub issue_type: Option<IssueType>, pub scope: Scope }
```

Do not cache the Actor across requests. At this scale, loading it per request is cheap, and permission changes then take effect on the very next request.

### 6.4 Decision procedure

`authorize(actor, action, resource) -> Result<(), AuthzError>`. Evaluate the steps in order and stop at the first that decides:

1. **Super admin:** allow.
2. **Reserved super admin action** (6.2): deny.
3. **Find the resource's branch.**
   - An issue uses `issue.branch_id`.
   - A work item uses `work_item.branch_id`.
   - For actions on a cross-branch issue itself (read, comment, watch), use every branch it targets. Allow if any of them allows.
4. **Admin of that branch:** allow everything except super admin actions. On `requires_super_admin_approval` issues, branch admins may read, comment, and assign and update their branch's work items. They may not edit, close or approve.
5. **Reserved admin action** (6.2): deny.
6. **Grants:** allow if any grant in that branch has the matching permission, a matching issue type (or NULL), and a scope that holds for this actor and resource.
7. **Otherwise:** deny.

**Extra rules applied after the grant check:**
- **No self-approval.** The approver must not be the work item's assignee. This applies to everyone, super admins included.
- **Read precedes everything.** If the actor cannot read the issue, every action on it returns `404`, not `403`.
- **Private issues.** An issue with `is_private = true` is readable only by:
  - its creator
  - anyone targeted by it
  - branch admins
  - holders of `issue.read_private`
  - super admins
- **Internal comments.** `is_internal_only` comments are filtered out of every response unless the actor is an admin, a super admin, or holds `comment.internal`.
- **`member.manage` limits.** It can never change `is_admin`, touch an admin's or super admin's account, or affect other branches. Removing a member from the branch sets `left_at`. Deactivating a user (`is_active = false`) is allowed only when the user belongs to this branch alone.
- **Event invitees** can always RSVP to an event they are invited to. RSVP needs no permission.

### 6.5 List filtering

`authz/filter.rs` turns the actor into a SQL `WHERE` fragment for issues. Every list, search, dashboard and export query must use it.

```sql
-- shape of the generated predicate (super admins: TRUE)
( i.created_by = $me                                              -- own
  OR EXISTS (SELECT 1 FROM issue_target t
             WHERE t.issue_id = i.id AND (
                   t.user_id = $me
                OR t.group_id = ANY($my_group_ids)
                OR (t.kind = 'branch' AND t.branch_id = ANY($my_branch_ids))))
  OR EXISTS (SELECT 1 FROM work_item w WHERE w.issue_id = i.id AND w.assignee_id = $me)
  OR (i.branch_id = ANY($admin_branch_ids))
  OR (i.branch_id = ANY($private_read_branch_ids))                -- issue.read_private
  OR (NOT i.is_private AND i.branch_id = ANY($branch_read_branch_ids)) -- issue.read @ branch
  OR (i.branch_id IS NULL AND EXISTS (SELECT 1 FROM issue_target t
             WHERE t.issue_id = i.id AND t.branch_id = ANY($admin_branch_ids)))
)
```

- **Per-type grants.** When `issue.read` grants are limited to some types, the per-branch sets become `(branch_id, type_id)` pairs. Generate `(i.branch_id, i.type_id) IN (...)` accordingly.
- **Consistency.** The filter and `authorize(Read)` must agree. A test enforces this (6.6).

### 6.6 Tests that must exist before phase 3 ends

1. **`tests/authz_matrix.rs`.**
   - Seed a fixture with a super admin, two branches, and in each branch an admin, a plain member, and a member of an admin-like group.
   - Add one multi-branch member who is an admin in branch A and a plain member in branch B.
   - Add issues of every type, private and public, created by each role, including one cross-branch super admin issue.
   - Run a table of `(actor, action, resource, expected)` rows covering every row of the table in 6.1 and every bullet in 6.2 and 6.4.
2. **Filter and decision agreement.** For every actor in the fixture, `list_issues(actor)` returns exactly the set of issues for which `authorize(actor, Read, issue)` is Ok.
3. **Instant revocation.**
   - Remove someone from a group. Their next request loses those permissions.
   - Set `left_at`. They lose access to that branch.

---

## 7. Domain rules

### 7.1 Branches, members, groups

- **Creating a branch** (super admin) takes `{code, name, timezone, email?, first_admin_user_id}`.
  - In one transaction, insert the branch and the admin membership.
  - The schema's deferred trigger rejects a branch without an admin.
  - A trigger creates the "All members" group with the baseline grants.
- **Appointing or demoting admins** (super admin): first lock the branch row (`SELECT ... FROM branch WHERE id = $1 FOR UPDATE`), then update. This serializes concurrent demotions. The deferred trigger refuses to leave the branch without an admin; map that to `409 last_admin`.
- **Adding a member** (admin or `member.manage`): by email.
  - If the account exists, add the membership, or clear `left_at` to reactivate (admin only).
  - Otherwise create the user with a temp password returned once in the response, and `must_change_password = true`.
  - The trigger adds them to "All members".
- **Removing a member** sets `left_at`. The trigger removes them from that branch's groups.
  - Their open work items in the branch become unassigned, and the branch admins are notified (`unassigned` to the user, `status_changed` to admins).
  - Refuse with `409` if they are an admin; demote them first.
- **Groups.** Admin-only CRUD.
  - Deleting a group that is referenced by any `issue_target` must archive it instead.
  - The "All members" group can't be deleted or renamed. Its grants can be edited.
  - Every grant or revoke notifies the branch admins (`permissions_changed`) and every affected member (`added_to_group` on add).
- **Grants.** Validate the scope against `allowed_scopes` and the issue type against `per_issue_type` in Rust, so the API returns a friendly `422`. The schema's trigger checks the same thing again.

### 7.2 Issues and targets

- **Creating an issue** requires `issue.create` for the type in the branch, and `issue.target` for any targets supplied.
  - The request takes `{branch_id, type, title, description, priority, is_private?, completion_mode?, targets: [{user_id}|{group_id}], sla_due_at?, event?: {...}}`.
  - Super admins may send `branch_id: null` with `targets: [{branch_id}, ...]`.
  - Set `requires_super_admin_approval = actor.is_super_admin`.
  - `is_private` requires `issue.set_private`.
- **Default SLA.** If `sla_due_at` is omitted for an Action or Report, use `now + issue_type.default_sla_hours`.
- **Work item creation** happens for Action and Report only, when the issue is created and whenever a target is added:

| Target | `shared` (default) | `per_member` |
|---|---|---|
| user | 1 item, assigned to that user | same |
| group | 1 unassigned item; members may claim it | 1 item per **current** member (snapshot) |
| branch (super admin) | 1 unassigned item; the branch admin assigns it | 1 item per current branch member |

- **Removing a target** cancels its non-final work items. Never delete them.
- **Tickets** have targets (who the question is addressed to) but no work items. They close via `issue.close`.
- **Events** have targets as invitees. When created or when targets change, create `event_rsvp` rows for every resolved invitee: the user target, the current group members, or the current branch members. The organizer is excluded.
- **Closing an issue** sets `state = closed`, `closed_at` and `closed_by`, and cancels the remaining non-final work items. Cancelling an event (`state = cancelled`) notifies every invitee who has not declined.
- **Auto-close.** When the last work item of an issue reaches `approved` or `cancelled`, set the issue to `closed` with `closed_by = NULL` (system).
- **Notifying owners.** When an admin, or a grant holder at `branch` scope, edits or closes an issue they did not create, notify the creator (`changed_by_admin`).

### 7.3 Work item state machine

```text
open ──► in_progress ◄──► blocked
  │           │              │
  └───────────┴──────────────┴──► pending_approval ──► approved
                                        │
                                        └── reject (note required) ──► in_progress
any non-final state ──► cancelled   (closing the issue, removing the target, admin)
```

- **Start, block, unblock, submit:** need `work_item.update`.
- **Submitting** sets `submitted_at`. For a **Report**, it requires an `issue_report` linked to this work item with `submitted_at` set; otherwise return `422 report_required`.
- **Approve and reject:** need `work_item.approve` (or admin, or super admin for `requires_super_admin_approval`). They set `decided_by`, `decided_at` and `decision_note`, and a note is required on rejection. Notify the assignee (`approved` / `rejected`).
- **Claiming** an unassigned shared item sets `assignee_id = me` and needs `work_item.assign` at `targeted`. Reassigning needs `work_item.assign` at `branch` (or admin). Notify the new assignee (`assigned`) and the previous one (`unassigned`).

### 7.4 Comments, mentions, reports, attachments

- **Comments** are on the issue, or on one work item (`work_item_id`). `is_internal_only` requires `comment.internal` (or admin).
- **Mentions.**
  - Parse `@` mentions client-side and send `mention_user_ids` with the comment.
  - The server keeps only users who can read the issue (non-readers are dropped silently), stores them in `comment_mention`, and notifies them (`mentioned`).
- **Comment notifications.** Notify, via `commented`:
  - the issue creator
  - the assignees of the work item (or of all work items, for issue-wide comments)
  - watchers

  Never notify the author. Never notify someone who can't read an internal comment.
- **Reports.** Draft, then submit (`submitted_at`). Editable by the author until the linked work item is approved.
- **Attachments.**
  - Upload with `multipart/form-data`, max 25 MB, and an allow-list of content types (pdf, images, office documents, csv, txt).
  - Compute sha256 and store via `ObjectStore` under the key `issues/{issue_id}/{uuid}`.
  - Download through `GET /api/attachments/{id}`, which streams the file after an authorization check. No public URLs.

### 7.5 Events

- **Event fields** are `starts_at`, `ends_at`, `all_day`, `location`, plus reminders (`minutes_before` list, default `[1440, 60]`).
- **RSVP.** `PUT /api/events/{id}/rsvp` with `{response, note?}` is allowed for invitees only.
- **Event updates.**
  - Changing the time or location notifies invitees with `going` or `maybe` (`event_updated`).
  - Changing the time resets those RSVPs to `pending`.
- **Calendar.** `GET /api/calendar?from=&to=&branch_id=` returns events the actor can read in that window, with the actor's own RSVP.

### 7.6 Notifications

- **Create notifications** inside the same transaction as the change that caused them. `notification.kind` values are fixed by the schema.
- **Recipients:**
  - `assigned` and `unassigned`: the assignee
  - `submitted_for_approval`: everyone who can approve that work item; for super admin issues, that is all active super admins
  - `ticket_created`: admins of the branch
  - `event_invited`: new invitees
- **Deduplication.** Use `dedupe_key` for anything a job generates, e.g. `sla_due:{work_item}:{yyyy-mm-dd}`, `reminder:{issue}:{user}:{minutes}`. Insert with `ON CONFLICT (dedupe_key) DO NOTHING`.
- **Endpoints:**
  - `GET /api/notifications?unread=true&after=`
  - `POST /api/notifications/{id}/read`
  - `POST /api/notifications/read-all`
  - `GET /api/notifications/unread-count`

### 7.7 Read tracking and watchers

- `POST /api/issues/{id}/read` upserts `issue_read`. Issue lists include an `unread` flag: `last_activity_at > last_read_at`.
- Watch and unwatch use `PUT` and `DELETE /api/issues/{id}/watch`. Creators and assignees are implicitly watched for notification purposes.

---

## 8. Real-time updates

- **Signal.** At the end of every mutating transaction, call:
  `SELECT pg_notify('app_events', $json)`
  with `{"kind": "...", "issue_id": "...", "branch_ids": [...], "recipient_ids": [...]}`. Keep the payload small, with IDs only, well under the 8 KB limit.
- **Listener.** `realtime/listener.rs` holds one `PgListener` on `app_events` and forwards each payload into a `tokio::sync::broadcast` channel. Reconnect with backoff if the connection drops.
- **Stream endpoint.** `GET /api/stream` is a Server-Sent Events endpoint.
  - Each connection keeps its `Actor`, refreshed every 60 s and whenever an event of kind `permissions_changed` names them.
  - Forward an event if the actor is a super admin, is listed in `recipient_ids`, or shares a branch with `branch_ids`.
  - Send a heartbeat comment every 25 s.
- **No data in events.** Events never carry issue content. The client refetches through the normal API, which applies permissions. This makes leaking a private issue or an internal comment through the stream impossible.
- **Client guidance** (document it in the README): debounce refetches to at most once per 2 s, and refetch everything on reconnect.

---

## 9. Dashboard

`GET /api/dashboard?branch_id=` returns numbers for one branch, or for all readable branches when omitted.

| Number | Meaning |
|---|---|
| Open issues by type | |
| Work items by status | |
| Overdue work items | Uses `work_item_overview.is_overdue` |
| Awaiting my approval | |
| Due in the next 7 days | Computed in the branch timezone |
| My open work items | |
| Upcoming events, next 14 days | With my RSVP |
| Unread notification count | |

- **With `dashboard.branch`** (or admin): branch-wide numbers.
- **Without it:** only the "my" numbers plus public counts of tickets.
- **Queries:** run them live on the views. No caching or materialized views at this scale. Every number must go through the filter in 6.5.

---

## 10. Excel export

`GET /api/exports?branch_ids=...&types=ticket,report,event,action&from=&to=` responds with `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.

- **Who can export:**
  - One branch: admin, or `export.run` in that branch.
  - Several branches, or all: super admin only.
- **Workbook sheets:**

| Sheet | Columns |
|---|---|
| Tickets | number, title, branch, created by, created at, state, closed at, comment count |
| Actions | One row per work item: number, title, branch, assignee, status, SLA due, overdue?, submitted at, decided by/at |
| Reports | One row per report: number, issue title, branch, author, submitted at, approval status, body (truncated to 32k chars) |
| Events | number, title, branch, starts, ends, location, going / maybe / declined / pending counts |

- **Formatting:** bold header row, frozen header, auto-filter, and dates formatted in the branch timezone.
- **Contents:** internal comments and private issues are included only if the actor could read them.
- **Audit:** write an `audit_log` row (`entity_type = 'export'`) with the parameters.
- **Generation:** synchronous in the request. If the workbook exceeds about 50k rows, return `422 export_too_large` and ask for a narrower date range.

---

## 11. Background jobs

Run them in-process with `tokio::time::interval`. Each tick does `SELECT pg_try_advisory_lock(<job id>)` and skips the tick if the lock is not acquired, so running two server instances is safe.

| Job | Every | Does |
|---|---|---|
| SLA | 1 min | `sla_due_soon` 24 h before `sla_due_at`; `sla_breached` when passed. Recipients: the assignee and branch admins. Deduplicated per day. |
| Event reminders | 1 min | For each `event_reminder` whose time has come, notify invitees who are not `declined`. Deduplicated per (issue, user, minutes). |
| Cleanup | daily | Delete read notifications older than 90 days and expired or revoked sessions older than 30 days. |

Jobs act as the system: notifications get `actor_id = NULL`, and audit rows likewise.

---

## 12. HTTP API summary

All routes are under `/api` and require a session except login.

```text
Auth        POST /auth/login  POST /auth/logout  GET /me  POST /me/password
Branches    GET /branches  POST /branches*  PATCH /branches/{id}*
            PUT /branches/{id}/admins/{user_id}*  DELETE /branches/{id}/admins/{user_id}*
Members     GET /branches/{id}/members  POST /branches/{id}/members
            PATCH /branches/{id}/members/{user_id}  DELETE /branches/{id}/members/{user_id}
            POST /users/{id}/reset-password  PATCH /users/{id}/active
Groups      GET /branches/{id}/groups  POST /branches/{id}/groups  PATCH|DELETE /groups/{id}
            PUT|DELETE /groups/{id}/members/{user_id}
            GET /groups/{id}/permissions  POST /groups/{id}/permissions  DELETE /group-permissions/{id}
            GET /permissions                      (catalog, for the admin UI)
            GET /branches/{id}/members/{user_id}/effective-permissions   (with the group each comes from)
Issues      GET /issues?branch_id&type&state&assignee=me&q&after  POST /issues
            GET|PATCH /issues/{id}  GET /issues/by-number/{n}
            POST /issues/{id}/close  POST /issues/{id}/cancel
            POST /issues/{id}/targets  DELETE /issues/{id}/targets/{target_id}
            POST /issues/{id}/read  PUT|DELETE /issues/{id}/watch
            GET /issues/{id}/history              (audit rows the actor may see)
Work items  GET /work-items?assignee=me&status&branch_id  GET /work-items/{id}
            POST /work-items/{id}/start|block|unblock|submit|approve|reject|claim|assign|cancel
Comments    GET|POST /issues/{id}/comments  PATCH|DELETE /comments/{id}
Reports     GET|POST /issues/{id}/reports  PATCH /reports/{id}  POST /reports/{id}/submit
Attachments POST /issues/{id}/attachments  GET /attachments/{id}
Events      GET /calendar  PUT /events/{id}/rsvp  GET /events/{id}/rsvps
Notifs      GET /notifications  GET /notifications/unread-count
            POST /notifications/{id}/read  POST /notifications/read-all
Dashboard   GET /dashboard
Export      GET /exports
Stream      GET /stream                            (SSE)
Health      GET /healthz  (no auth; checks DB)
```

Routes marked `*` are super admin only. Publish an OpenAPI document with `utoipa`; this is optional but recommended, because the frontend will be generated against it.

---

## 13. Phases and acceptance criteria

Finish each phase with `cargo fmt`, `cargo clippy -- -D warnings` and `cargo test` passing.

### Phase 0: Skeleton
- **Build:** Cargo workspace, config, tracing, DB pool, migrations run on startup, `AppError`, `/healthz`, docker-compose with Postgres 16, a test harness using `sqlx::test`.
- **Done when:** `docker compose up -d && cargo test` passes on a clean checkout, and `0001_init.sql` applies cleanly.

### Phase 1: Auth
- **Build:** the bootstrap CLI, login and logout, sessions, the `Actor` extractor (memberships and grants only; policy comes in phase 2), lockout, forced password change, CSRF origin check.
- **Done when:**
  - integration tests cover login success and failure, lockout, an expired session, an inactive user, and the forced password change gate
  - passwords and tokens never appear in logs

### Phase 2: Organisation and authorization core
- **Build:**
  - branches, memberships (with the admin lock), groups, group members, grants, the effective-permissions endpoint
  - `authz` (`policy.rs`, `filter.rs`, `relations.rs`) and the audit helper
- **Done when:**
  - every rule in 6.2 has a passing test
  - the last-admin and last-super-admin cases return `409`
  - removing a member from a group removes the permission on the next request

### Phase 3: Issues and work items
- **Build:** issue CRUD for all four types (event details included), targets, work item creation per 7.2, the state machine in 7.3, approvals, auto-close, optimistic locking, watchers, read tracking.
- **Done when:** the full `authz_matrix.rs` and the agreement test (6.6) pass, and every transition in 7.3 is tested, including invalid ones and version conflicts.

### Phase 4: Collaboration
- **Build:** comments (internal filtering, mentions, moderation), reports (draft and submit, Report submit gate), attachments (local `ObjectStore`, size and type limits, authorized download).
- **Done when:** tests show that internal comments never appear for non-permitted actors in any endpoint, including issue history, and that an unreadable issue's attachment returns `404`.

### Phase 5: Events
- **Build:** RSVP generation from targets, RSVP endpoint, reminders config, calendar endpoint, update and cancel notifications.
- **Done when:** RSVP rows exist for exactly the resolved invitees, and a time change resets RSVPs and notifies the right people.

### Phase 6: Notifications and real time
- **Build:** notification creation for every kind in the schema, inbox endpoints, the `pg_notify` emitter, the listener, SSE with per-connection filtering, and the jobs (SLA, reminders, cleanup) with advisory-lock leader election.
- **Done when:**
  - an integration test opens two SSE connections (a member of branch A and a member of branch B) and only the right one receives an event for a branch A change
  - running jobs twice creates no duplicate notifications

### Phase 7: Dashboard and export
- **Build:** the dashboard endpoint and the Excel export.
- **Done when:**
  - dashboard numbers for each fixture actor match counts computed from the filtered lists
  - the exported workbook opens and its sheet and row counts match the filtered data
  - a multi-branch export is refused for non-super admins

### Phase 8: Hardening
- **Build:** request size limits, timeouts, structured error codes documented in the README, the OpenAPI document, seed script for demo data, and a small load test (50 virtual users browsing and updating for 5 minutes using `oha` or `k6`).
- **Done when:** p95 latency is below 200 ms on a laptop, there are no errors under the load test, and the README covers setup, env vars, bootstrap and the deploy notes.

---

## 14. Out of scope for this version

- Email or SMS notifications, and password reset by email
- Recurring tasks and events
- Academic terms (exports use date ranges)
- Full-text search beyond `ILIKE` on titles (add `tsvector` later)
- S3 or other cloud object storage (the `ObjectStore` trait leaves room for it)
- The frontend. This plan covers the API only.

## 15. Decisions already made (do not reopen)

- Branches exist, and divisions do not. Groups are the only way to organize people within a branch.
- Admin is a per-branch flag set only by super admins. Admin-like groups never count as admins for the "every branch has an admin" rule.
- Only admins manage groups, including their members and permissions. Groups can't be given that power.
- Members can be in several branches. Permissions never carry over from one branch to another.
- Any super admin can approve work on a super admin issue, not only its creator.
- Targeted users always see private issues addressed to them.
- Anyone can close the tickets, reports and events they created.
