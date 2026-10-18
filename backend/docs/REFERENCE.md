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

Built-in limits: JSON bodies 1 MB, uploads 25 MB; requests time out after 30 s
(uploads 5 min); each database statement after 15 s, locks after 10 s, idle
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

## Real-time updates

`GET /api/stream` is a Server-Sent Events stream for the signed-in user.
Events carry IDs only (`{"kind", "issue_id", "branch_ids"}`), never content,
so nothing private can leak through the stream: the client refetches through
the normal API, which applies permissions.

| Event | Meaning |
|---|---|
| `ready` | Connected. |
| `issue_created`, `issue_updated`, `work_item_updated`, `comment_*`, `report_*`, `rsvp_changed`, ... | Something changed on `issue_id`; refetch it (and any list showing it). |
| `notification` | Your inbox changed; refetch the unread count. |
| `permissions_changed`, `member_changed`, `group_changed`, `branch_changed` | Refetch `/api/me` and the affected branch data. |
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
| 409 | `already_exists` | Generic uniqueness conflict. |
| 409 | `email_taken` | A user with this email exists. |
| 409 | `branch_code_taken` | A branch with this code exists. |
| 409 | `branch_name_taken` | A branch with this name exists. |
| 409 | `group_name_taken` | A group with this name exists in the branch. |
| 409 | `grant_exists` | The group already has this grant. |
| 409 | `target_exists` | The issue is already sent to this target. |
| 409 | `already_assigned` | Someone already has this work (or this person already has work on the target). |
| 409 | `already_member` | Already a member of the branch. |
| 409 | `member_is_admin` | Admins can't leave a branch; demote them first. |
| 409 | `last_admin` | A branch must keep an active admin. |
| 409 | `last_super_admin` | At least one active super admin must remain. |
| 409 | `default_group` | "All members" can't be renamed, archived, deleted or joined by hand. |
| 409 | `not_a_member` | The user isn't a current member of the branch. |
| 409 | `group_archived` | Restore the group first. |
| 409 | `issue_not_open` | The issue is closed or cancelled. |
| 409 | `event_not_open` | The event is cancelled or over. |
| 409 | `invalid_transition` | Not a valid work item transition from its current status. |
| 409 | `not_assigned` | Assign or claim the work before working on it. |
| 409 | `not_claimable` | Only shared work sent to a group can be claimed. |
| 409 | `comment_deleted` | The comment was deleted. |
| 409 | `report_exists` | There's already a report for this; edit it. |
| 409 | `report_locked` | The report's work was approved (or its issue closed). |
| 409 | `not_empty` | `seed-demo` only runs on an empty database. |
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
| 422 | `invalid_timezone` | Not an IANA timezone name. |
| 422 | `invalid_branch_code` | Branch codes are 2 to 10 uppercase letters or digits. |
| 422 | `invalid_admin` | The first admin must be an active user. |
| 422 | `user_inactive` | An inactive user can't be appointed admin. |
| 422 | `unknown_permission` | Not a permission in the catalog. |
| 422 | `invalid_scope` | The scope isn't allowed for this permission. |
| 422 | `invalid_issue_type` | Unknown issue type, or the permission can't be limited to a type. |
| 422 | `invalid_title` | Titles are 1 to 200 characters. |
| 422 | `invalid_target` | Bad target: wrong branch, not a member, archived group, or not allowed here. |
| 422 | `event_required` | Events need event details. |
| 422 | `invalid_event` | Only events have event details. |
| 422 | `invalid_event_range` | An event must end after it starts. |
| 422 | `invalid_completion_mode` | Only actions and reports have per-member work. |
| 422 | `invalid_sla` | Only actions and reports have an SLA. |
| 422 | `invalid_reminders` | Up to 10 reminders, 1 minute to 4 weeks before. |
| 422 | `invalid_assignee` | The assignee must be an active member of the branch. |
| 422 | `assignee_required` | `assignee_id` is required. |
| 422 | `note_required` | Rejections need a note. |
| 422 | `report_required` | Submit the written report before submitting the work. |
| 422 | `invalid_work_item` | The work item isn't part of this issue. |
| 422 | `invalid_comment` | Comments are 1 to 20,000 characters. |
| 422 | `too_many_mentions` | At most 50 mentions. |
| 422 | `not_a_report` | Reports go on report issues. |
| 422 | `invalid_report` | Reports are 1 to 100,000 characters. |
| 422 | `invalid_parent` | The comment or report to attach to doesn't exist or is locked. |
| 422 | `invalid_upload` | The multipart upload is malformed. |
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
cargo run --bin admin -- seed-demo                     # on an empty database
SQLX_OFFLINE=true cargo build --release
APP_ORIGIN=http://localhost:5173 COOKIE_SECURE=false JOBS_ENABLED=true ./target/release/backend &
k6 run scripts/loadtest.js                             # BASE_URL / ORIGIN / DURATION / VUS env to override
```

## Deploying

- **Build** with `SQLX_OFFLINE=true cargo build --release`; ship
  `target/release/backend` and `target/release/admin`. Migrations run when
  the server starts.
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
- Never run `seed-demo` against real data (it refuses anyway).
