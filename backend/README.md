# School ticketing backend

The API for the school ticketing app: branches, people and groups, issues
(tickets, actions, reports and events), work and approvals, comments,
attachments, notifications, a dashboard and Excel exports.

Built with Rust, axum and PostgreSQL 16. For configuration, error codes and
deployment, see [docs/REFERENCE.md](docs/REFERENCE.md).

## Setup

You need [Rust](https://rustup.rs) and [Docker](https://www.docker.com).

1. **Start the database** (Postgres 16 on `localhost:5432`), using the
   `docker-compose.yml` at the repository root:

   ```sh
   docker compose up -d postgres
   ```

   To run the whole app in Docker instead, see the [root README](../README.md).

2. **Create your settings file.** The defaults work for local development:

   ```sh
   cp .env.example .env
   ```

3. **Add demo data**, so there's someone to sign in as:

   ```sh
   cargo run --bin admin -- seed-demo
   ```

   This creates three branches, about 90 people and some issues. Every demo
   account has the password `demo-password`, for example:

   | Account | Role |
   |---|---|
   | `superadmin@demo.school` | Super admin (all branches) |
   | `admin@north.demo.school` | Admin of the North branch (also `south`, `east`) |
   | `member1@north.demo.school` | A member (`member1` to `member28`, in each branch) |

4. **Start the server:**

   ```sh
   cargo run
   ```

   It listens on `http://127.0.0.1:8080` and updates the database
   automatically. Check that it's up:

   ```sh
   cargo run --bin health
   # OK: the server and its database are up (http://127.0.0.1:8080)
   ```

To run the tests: `cargo test` (with the database from step 1 running).

## API

- **Base URL:** `http://127.0.0.1:8080/api`
- **Readable docs:** open [`docs/api.html`](docs/api.html) in a browser. It has
  every endpoint, who may call it, its fields and a curl example. After
  changing endpoints, regenerate it with `python3 scripts/gen_api_docs.py`
  (the server must be running).
- **Command-line tools:** [`docs/binaries.html`](docs/binaries.html) describes
  every `cargo run --bin ...` tool, and
  [`docs/password-rotation.html`](docs/password-rotation.html) walks through
  creating the first super admin and rotating passwords.
- **Every endpoint**, with its parameters and responses, is listed in the
  OpenAPI document at
  [`/api/openapi.json`](http://127.0.0.1:8080/api/openapi.json). Paste it into
  any OpenAPI viewer (for example [editor.swagger.io](https://editor.swagger.io)),
  or generate a client from it.
- **Signing in** returns a session cookie, `sid`. Send it with every request.
- **Every non-GET request** (POST, PUT, PATCH, DELETE) must also send
  `Origin: http://localhost:5173`, the frontend's address from `.env`.
  Without it you get `403 origin_mismatch`.
- **Bodies are JSON.** Errors always look like this:

  ```json
  {"error": {"code": "not_found", "message": "not found"}}
  ```

  The full list of codes is in [docs/REFERENCE.md](docs/REFERENCE.md#errors).
- **Lists are paged:** add `?limit=20`, then pass the response's `next_cursor`
  as `?after=...` to get the next page.

The main endpoints:

| What | Endpoints |
|---|---|
| Session | `POST /auth/login`, `POST /auth/logout`, `GET /me` |
| Issues | `GET /issues`, `POST /issues`, `GET` / `PATCH /issues/{id}`, `POST /issues/{id}/close` |
| Work | `GET /work-items?assignee=me`, `POST /work-items/{id}/start` (also `submit`, `approve`, ...) |
| Comments | `GET` / `POST /issues/{id}/comments` |
| Events | `GET /calendar?from=...&to=...`, `PUT /events/{id}/rsvp` |
| Inbox | `GET /notifications`, `GET /notifications/unread-count` |
| Overview | `GET /dashboard`, `GET /exports?branch_ids=...` (Excel) |
| People | `GET /branches`, `GET /branches/{id}/members`, `GET /branches/{id}/groups` |

## Making requests with curl

The session cookie is kept in `cookies.txt`: the `login` tool writes it, and
curl sends it with `-b cookies.txt`.

**1. Sign in** (the password defaults to `demo-password`)

```sh
cargo run --bin login -- --email member1@north.demo.school
cargo run --bin whoami
```

`whoami` shows your profile and your branches. Note a branch `id` for the
next steps.

**2. Read something**: GET requests only need the cookie.

```sh
curl -b cookies.txt 'http://127.0.0.1:8080/api/issues?limit=5'
curl -b cookies.txt http://127.0.0.1:8080/api/dashboard
```

**3. Sign out**

```sh
cargo run --bin logout
```

- Edits send the `version` you last saw, for example
  `PATCH /issues/{id}` with `{"version": 1, "title": "New title"}`. If someone
  changed it in between, you get `409 version_conflict`; fetch it again and retry.
- A `401 unauthenticated` means the cookie is missing or expired: sign in again
  with `cargo run --bin login`.

## Publishing a release

Tag the commit and push the tag:

```sh
git tag v0.0.2
git push origin v0.0.2
```

The [release workflow](../.github/workflows/backend-binaries.yml) then creates
the GitHub release and attaches the Linux binaries and the offline bundles
(`navid-offline-0.0.2-amd64.zip`, `-arm64.zip`). Others download a bundle with
`./get-offline-bundle.sh` (see
[instructions/offline-bundle.md](../instructions/offline-bundle.md)).
