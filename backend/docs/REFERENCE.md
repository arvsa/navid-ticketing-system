# Reference

Details behind the [README](../README.md).

## Configuration

Environment variables (`.env` is read in development):

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string. The admin CLI needs only this. |
| `DATABASE_MAX_CONNECTIONS` | `10` | Pool size. |
| `BIND_ADDR` | `127.0.0.1:8080` | Listen address. |
| `APP_ORIGIN` | required | The frontend's origin, e.g. `https://tickets.school.org`. CORS allows only it, and every non-GET request must send it as `Origin` (CSRF protection). |
| `COOKIE_SECURE` | `true` | `Secure` flag on the session cookie, and HSTS. Set `false` only for local HTTP. |
| `STORAGE_DIR` | `./data/attachments` | Where uploaded files are kept. |
| `JOBS_ENABLED` | `true` | Run the SLA, reminder and cleanup jobs in this process. |
| `LOG_FORMAT` | `pretty` | `pretty` for development, `json` in production. |
| `RUST_LOG` | `backend=info,tower_http=info,sqlx=warn` | Log filter. |
| `FIRST_SUPER_ADMIN_EMAIL` | unset | On a start with no users at all, create this root user and print its temporary password (`First root user: ...`) in the log. The prebuilt bundle sets it to `superadmin@school.local`. |

Built-in limits: JSON bodies 1 MB, uploads 25 MB, member imports 2 MB and 500 people; requests time out after 30 s
(uploads and member imports 5 min); each database statement after 15 s, locks after 10 s, idle
transactions after 60 s.

## API conventions

- Lists use keyset pagination: `?limit=50` (max 200) and `?after=<next_cursor>`.
- IDs are UUIDs; issues also have a number, shown as `ISS-<n>`
  (`GET /api/issues/by-number/{n}`).
- Updates to issues, work items and reports send the `version` they last saw;
  a stale one gets `409 version_conflict`.
- Times are RFC 3339 UTC.

## Auth

- `POST /api/auth/login` `{email, password}` sets an HttpOnly `sid` cookie (7 days, 12 h idle timeout).
- `POST /api/auth/logout`, `GET /api/me`, `POST /api/me/password` `{current_password, new_password}`.
- Five wrong passwords in a row lock the account for 15 minutes.
- While `must_change_password` is set, only the three endpoints above work.
- Every non-GET request must send `Origin` equal to `APP_ORIGIN`, login included.

## Roles

- **Super admin** (root user): runs the app. Creates branches and their first
  admins, school-wide permission groups and accounts in any branch. Can do
  anything, but isn't part of the daily work: the UI opens on a Setup page.
- **Branch admin**: runs a branch: its people, departments, permission
  groups, and any item or work in it. Sends items to their whole branch.
- **Everyone** has the baseline (below), plus the grants of the permission
  groups attached to their departments.
- An item is run by its sender: on a school-wide item only they edit, close
  or resend it. Work is approved by the item's sender or the work's branch
  approvers (its admins and holders of `work_item.approve`).
- Whoever holds work may pass it to anyone in its branch
  (`POST /api/work-items/{id}/pass`, `{version, assignee_id}`). The chain is
  kept on the work item (`handoff_chain`): a hand-in is reviewed one level up
  (`reviewer_id`, or the branch's admins); approving there sends it up as
  that person's hand-in, until the top, where the sender or the branch's
  approvers give the final approval. Sending back returns it to whoever
  handed it in. Assigning or claiming starts a new chain.
- A question (ticket) asked to you can be passed to someone else in your
  branch: `POST /api/issues/{id}/pass` `{user_id}`.
- `PUT` / `DELETE /api/issues/{id}/mute`: no more comments or changes from an
  item; what needs you (work, a hand-in to review, a mention) still arrives.

## Departments and permissions

Two separate things:

- A **department** is a business unit of a branch: IT, Health, Teachers.
  Items are sent to departments (and to people); every member gets them, and
  shared work sent to a department is claimed by one of them. Its **heads**
  (chosen by admins) hand out, approve or send back, and cancel the work sent
  to it, and close the questions sent to it. Every branch has a built-in
  **All members** department that everyone in it joins automatically; send to
  the whole branch instead of to it.
- A **permission group** is a named set of grants, for one branch (its
  admins make it) or school-wide (root users make it; any branch attaches it).
  Attached to departments, its grants apply to their members in that branch.
  **Everyone**, the school-wide default group, applies to every user without
  being attached. A new branch gets an **All members** permission group,
  attached to its All members department, granting `issue.read`,
  `comment.create` and `member.view`. Every grant is branch-wide; `department.members.manage` is
  granted for named departments (or `*`).

**The baseline**, which needs no grant: create items of every type and send
them to any person or department in any branch; read, comment on and work on
what you sent or were sent; edit, resend or delete (soft) your own items while
they're open and current (not an event that has ended, not work past its
deadline); close your own items at any time. Whole branches are for their
admins; school-wide items to whole branches for root users.

| Endpoint | Who |
|---|---|
| `GET /api/branches/{id}/departments` | Members of the branch. |
| `POST /api/branches/{id}/departments`, `PATCH`/`DELETE /api/departments/{id}` | Admins, `department.manage`. Deleting a department items were sent to archives it. |
| `PUT`/`DELETE /api/departments/{id}/members/{user_id}` | Admins, `department.manage`, `department.members.manage` for that department. Removing a head: admins and `department.manage` only. |
| `PUT`/`DELETE /api/departments/{id}/heads/{user_id}` | Admins, `department.manage`. |
| `GET`/`POST /api/branches/{id}/permission-groups` | Admins. Lists the branch's groups and the school-wide ones. |
| `GET`/`POST /api/school-permission-groups` | Root users. |
| `PATCH`/`DELETE /api/permission-groups/{id}` | `{name?, description?, grants?}`; `grants` replaces them all: `[{permission, issue_type?, department?}]`. |
| `PUT`/`DELETE /api/departments/{id}/permission-groups/{group_id}` | Admins: attach or detach. |
| `GET /api/branches/{id}/members/{user_id}/effective-permissions` | Admins and the user: each grant with its permission group and department. |
| `GET /api/recipients`, `GET /api/recipient-departments` | Everyone: people and departments of every branch, to send items to. |
| `GET /api/root-users/names` | Everyone: active root users' names (they belong to no branch), to name and @mention them. |
| `POST /api/issues/{id}/delete` | `{version}`: soft delete. The sender while open and current; admins at any time. |

**The permission config.** `GET /api/permission-config?format=yaml|json`
returns the setup as one document: permission groups with their grants as
statements, and each branch's departments with their permission groups and
heads (by email). Root users get everything; branch admins the school-wide
groups and their own branches. `POST /api/permission-config?format=&dry_run=`
with an edited document as the body applies it in one transaction, or with
`dry_run=true` only lists what would change (`{applied, changes}`). Importing
creates and updates, never deletes: what's missing from the document is left
as it is. Branch admins can only change their own branches.

```yaml
version: 1
permission_groups:
  - name: IT support          # add `branch: AAA` for a branch's own group
    statements:
      - actions: [issue.read, comment.internal]
        issue_types: [ticket] # optional; none = every type
      - actions: [department.members.manage]
        departments: [IT]     # per-department actions only; "*" = all
branches:
  - branch: AAA
    departments:
      - name: IT
        permission_groups: [IT support]
        heads: [ali@school.example]
```

## Settings

- `GET /api/settings` (no sign-in needed) and `PATCH /api/settings`
  `{school_name}` (super admins): the school's name, shown in the header and
  on the sign-in page. Changing it sends `settings_changed` to everyone.

## Profiles and the directory

- `PUT` / `DELETE /api/me/cover` (max 5 MB) and `/api/me/avatar` (profile
  picture, max 2 MB): a multipart `file` part, JPEG, PNG or WebP (checked by
  its bytes). `GET /api/users/{id}/cover?v=` and `/avatar?v=` serve them,
  cached for good; the version is in `/api/me` and `/api/users/{id}/profile`.
- `GET /api/avatars`: everyone with a picture, `[{user_id, version}]`, so
  clients can show pictures beside names. Changes send `avatars_changed`.
- `GET /api/directory`: every active branch with its departments (other
  than All members, with their current members and heads) and its people
  (names, emails, who runs it). Everyone signed in reads it and anyone's profile.

## Templates and tags

- Issues are tickets, actions or events. A **template** is a named starting
  point for a new issue: `POST /api/issues` with `template_id` (and the
  template's `type`) adds the template's `tag` and fixes its rules on the
  issue. The built-in **Report** template is an action whose work needs a
  submitted written report before it goes for approval (`requires_report`
  on the issue); the issue's creator can also file one for themselves.
- `GET /api/templates` (everyone signed in; `?include_archived=true` for super
  admins), `POST /api/templates` `{name, type, description?, tag?,
  requires_report?, default_sla_hours?}` and `PATCH /api/templates/{id}`
  `{version, ..., archived?}` (super admins). The type can't change; edits
  apply to new issues only. Changes send `templates_changed` to everyone.
- **Tags**: `tags` on `POST /api/issues` (on top of the template's) and
  `PATCH /api/issues/{id}` (replaces them). Lower case, 1 to 40 characters, at
  most 10. Filter lists with `GET /api/issues?tag=report` or `?template_id=`.

## Real-time updates

`GET /api/stream` is a Server-Sent Events stream for the signed-in user.
Events carry IDs only (`{"kind", "issue_id", "branch_ids"}`), never content,
so nothing you can't read leaks through the stream: the client refetches through
the normal API, which applies permissions.

| Event | Meaning |
|---|---|
| `ready` | Connected. |
| `issue_created`, `issue_updated`, `work_item_updated`, `comment_*`, `report_*`, `rsvp_changed`, ... | Something changed on `issue_id`; refetch it (and any list showing it). |
| `notification` | Your inbox changed; refetch the unread count. |
| `permissions_changed`, `member_changed`, `department_changed`, `permission_groups_changed`, `branch_changed` | Refetch `/api/me` and the affected branch data. |
| `templates_changed` | Refetch `/api/templates`. |
| `settings_changed` | Refetch `/api/settings`. |
| `avatars_changed` | Refetch `/api/avatars`. |
| `resync` | Events may have been missed; refetch everything. |
| `session_ended` | The session is no longer valid; sign in again. |

Client guidance:

- **Debounce refetches** to at most once per 2 seconds; bursts are common.
- **Refetch everything on (re)connect** and on `resync`: the stream doesn't replay missed events.
- A heartbeat comment arrives every 25 s; treat ~60 s of silence as a dead connection and reconnect.

## Background jobs

With `JOBS_ENABLED=true` (the default) each instance runs, in-process:

| Job | Every | Does |
|---|---|---|
| SLA | 1 min | `sla_due_soon` within 24 h of the SLA, `sla_breached` after it, to the assignee and branch admins; once per day (branch timezone). |
| Event reminders | 1 min | `event_reminder` to invitees who haven't declined, once per reminder and start time. |
| Cleanup | daily | Deletes read notifications older than 90 days and sessions expired or revoked over 30 days ago. |

Each run takes a Postgres advisory lock first, so running several instances is safe.

## Errors

Every error has the shape `{"error": {"code": "snake_case", "message": "human text"}}`.
Clients should branch on `code`; messages are for people. Responses also carry
an `x-request-id` header to quote when reporting problems.

| Status | Code | Meaning |
|---|---|---|
| 401 | `unauthenticated` | No valid session. Sign in. |
| 401 | `invalid_credentials` | Wrong email or password, or the account is locked or inactive (never says which). |
| 403 | `forbidden` | Allowed to see this, but not to do it. |
| 403 | `password_change_required` | Change the temporary password first. |
| 403 | `origin_mismatch` | Non-GET request without the app's `Origin`. |
| 403 | `not_invited` | RSVP to an event you aren't invited to. |
| 404 | `not_found` | Missing, or not readable by you (never says which). |
| 409 | `version_conflict` | Someone else changed it; reload and retry. |
| 409 | `template_name_taken` | Another template in use has this name. |
| 409 | `already_exists` | Generic uniqueness conflict. |
| 409 | `email_taken` | A user with this email exists. |
| 409 | `branch_code_taken` | A branch with this code exists. |
| 409 | `branch_name_taken` | A branch with this name exists. |
| 409 | `department_name_taken` | A department with this name exists in the branch. |
| 409 | `permission_group_name_taken` | A permission group with this name exists in the branch (or school-wide). |
| 409 | `target_exists` | The issue is already sent to this target. |
| 409 | `already_assigned` | Someone already has this work (or this person already has work on the target). |
| 409 | `already_member` | Already a member of the branch. |
| 409 | `not_yours` | Only a question asked to you can be passed on. |
| 409 | `member_is_admin` | Admins can't leave a branch; demote them first. |
| 409 | `last_admin` | A branch must keep an active admin. |
| 409 | `last_super_admin` | At least one active super admin must remain. |
| 409 | `default_department` | "All members" can't be renamed, archived, deleted, given heads or joined by hand. |
| 409 | `default_group` | "Everyone" can't be renamed, deleted or attached: it applies to everyone. |
| 409 | `not_a_member` | The user isn't a current member of the branch (or of the department, to become a head). |
| 409 | `department_archived` | Restore the department first. |
| 409 | `not_empty` | (Demo seed) The database already has branches. |
| 409 | `issue_not_open` | The issue is closed or cancelled. |
| 409 | `event_not_open` | The event is cancelled or over. |
| 409 | `invalid_transition` | Not a valid work item transition from its current status. |
| 409 | `not_assigned` | Assign or claim the work before working on it. |
| 409 | `not_claimable` | Only shared work sent to a department can be claimed. |
| 409 | `comment_deleted` | The comment was deleted. |
| 409 | `report_exists` | There's already a report for this; edit it. |
| 409 | `report_locked` | The report's work was approved (or its issue closed). |
| 413 | `payload_too_large` | Body over 1 MB, or file over 25 MB. |
| 422 | `invalid_body` | The JSON body is malformed or missing fields. |
| 422 | `invalid_query` | A query parameter is malformed. |
| 422 | `invalid_cursor` | The pagination cursor is invalid. |
| 422 | `invalid_limit` | `limit` must be 1 to 200. |
| 422 | `invalid_reference` | A referenced record doesn't exist. |
| 422 | `invalid_value` | A value isn't allowed. |
| 422 | `weak_password` | Passwords are 8 to 128 characters. |
| 422 | `password_unchanged` | The new password must differ from the current one. |
| 422 | `invalid_current_password` | The current password is wrong. |
| 422 | `invalid_email` | Not a valid email. |
| 422 | `invalid_name` | A name is empty or too long. |
| 422 | `invalid_bio` | A bio is longer than 500 characters. |
| 422 | `invalid_timezone` | Not an IANA timezone name. |
| 422 | `invalid_branch_code` | Branch codes are 2 to 10 uppercase letters or digits. |
| 422 | `invalid_admin` | The first admin must be an active user. |
| 422 | `user_inactive` | An inactive user can't be appointed admin. |
| 422 | `unknown_permission` | Not a permission in the catalog. |
| 422 | `invalid_issue_type` | Unknown issue type, or the permission can't be limited to a type. |
| 422 | `department_required` | `department.members.manage` names a department (or `*`). |
| 422 | `invalid_department` | Only per-department permissions name departments. |
| 422 | `invalid_config` | The permission config can't be read, has an unknown version, or names something that doesn't exist. |
| 422 | `invalid_title` | Titles are 1 to 200 characters. |
| 422 | `invalid_target` | Bad target: wrong branch, not a member, archived department, "All members", or not allowed here. |
| 422 | `event_required` | Events need event details. |
| 422 | `invalid_event` | Only events have event details. |
| 422 | `invalid_event_range` | An event must end after it starts. |
| 422 | `invalid_completion_mode` | Only actions have per-member work. |
| 422 | `invalid_sla` | Only actions have an SLA. |
| 422 | `invalid_template` | No such template, archived, of another type, or its rules don't fit its type. |
| 422 | `invalid_tag` | Tags are 1 to 40 characters, at most 10 on an issue. |
| 422 | `invalid_description` | A template's description is at most 500 characters. |
| 422 | `invalid_reminders` | Up to 10 reminders, 1 minute to 4 weeks before. |
| 422 | `invalid_assignee` | The assignee must be an active member of the branch. |
| 422 | `assignee_required` | `assignee_id` is required. |
| 422 | `note_required` | Rejections need a note. |
| 422 | `report_required` | Submit the written report before submitting the work. |
| 422 | `invalid_work_item` | The work item isn't part of this issue. |
| 422 | `invalid_comment` | Comments are 1 to 20,000 characters. |
| 422 | `too_many_mentions` | At most 50 mentions. |
| 422 | `not_a_report` | Reports go on issues that need one (made from a template like Report). |
| 422 | `invalid_report` | Reports are 1 to 100,000 characters. |
| 422 | `invalid_parent` | The comment or report to attach to doesn't exist or is locked. |
| 422 | `invalid_upload` | The multipart upload is malformed. |
| 422 | `invalid_import` | The member import file can't be read, has no `email` column or no people, or has over 500. |
| 422 | `duplicate_email` | (Import row) The same email is on an earlier row. |
| 422 | `unsupported_type` | That file type isn't accepted. |
| 422 | `empty_file` | The file is empty. |
| 422 | `invalid_response` | RSVP with going, maybe or declined. |
| 422 | `invalid_note` | RSVP notes are up to 500 characters. |
| 422 | `invalid_range` | `to` must be after `from` (calendar windows: at most 366 days). |
| 422 | `export_too_large` | Over 50,000 rows; narrow the date range. |
| 500 | `internal_error` | A bug; details are logged, never returned. |

## Development

- **SQL queries** use `sqlx::query!`, checked at compile time against the
  database in `DATABASE_URL`. After adding a migration, apply it there first
  (`sqlx migrate run`, or start the server once). After changing a query,
  refresh and commit the offline data:

  ```sh
  cargo install sqlx-cli --no-default-features --features rustls,postgres
  cargo sqlx prepare -- --all-targets
  ```

  CI builds without a database by setting `SQLX_OFFLINE=true`.
- **Tests** each get a fresh database (`#[sqlx::test]`). The authorization
  matrix is `tests/authz_matrix.rs`; it and the list/decision agreement test
  must keep passing whenever permissions change.
- Before a commit: `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test`.

## Load test

`scripts/loadtest.js` is a [k6](https://k6.io) script: 50 virtual users sign
in as demo members and spend 5 minutes browsing (issue lists, issue pages,
comments, dashboard, unread counts) and updating (comments, read marks), with
~1 s think time. It fails unless p95 latency is under 200 ms and no request
errors.

```sh
# needs the demo accounts: a database filled by backend::seed::demo (as in tests/hardening.rs)
SQLX_OFFLINE=true cargo build --release
APP_ORIGIN=http://localhost:5173 COOKIE_SECURE=false JOBS_ENABLED=true ./target/release/backend &
k6 run scripts/loadtest.js                             # BASE_URL / ORIGIN / DURATION / VUS env to override
```

## Deploying

- **Build** with `SQLX_OFFLINE=true cargo build --release`; ship
  `target/release/backend`, `admin`, `health` and `users` (or take the static
  Linux builds attached to each GitHub release). Migrations run when the
  server starts.
- **TLS:** run behind a reverse proxy (Caddy, nginx) that terminates HTTPS.
  Keep `COOKIE_SECURE=true` (it also enables HSTS) and set `APP_ORIGIN` to the
  public frontend origin. Serving the frontend and `/api` from the same origin
  is simplest.
- **Proxy settings:** allow 26 MB request bodies for uploads; for
  `/api/stream`, disable response buffering and allow long-lived connections
  (nginx: `proxy_buffering off; proxy_read_timeout 1h;`).
- **Client IPs:** sessions record the TCP peer address. Behind a proxy that's
  the proxy's address; `X-Forwarded-For` is not trusted yet.
- **Storage:** `STORAGE_DIR` must be persistent and backed up together with
  the database (`pg_dump`). Several instances need a shared directory, or an
  S3-style `ObjectStore` implementation (`src/storage`).
- **Several instances** are otherwise safe: each one listens for real-time
  events itself, and jobs use advisory locks so only one runs each tick.
- **Logs:** use `LOG_FORMAT=json`. Requests are logged with method, path,
  status, latency and request id only; cookies, passwords, tokens and bodies
  never are.
- **Health:** `GET /api/healthz` (no auth) checks the database; use it for
  liveness and readiness probes.
