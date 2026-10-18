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
   curl http://127.0.0.1:8080/api/healthz
   # {"status":"ok"}
   ```

To run the tests: `cargo test` (with the database from step 1 running).

## API

- **Base URL:** `http://127.0.0.1:8080/api`
- **Readable docs:** open [`docs/api.html`](docs/api.html) in a browser. It has
  every endpoint, who may call it, its fields and a curl example. After
  changing endpoints, regenerate it with `python3 scripts/gen_api_docs.py`
  (the server must be running).
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

Let curl keep the session cookie in a file: `-c cookies.txt` saves it,
`-b cookies.txt` sends it.

**1. Sign in**

```sh
curl -c cookies.txt -X POST http://127.0.0.1:8080/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"email": "member1@north.demo.school", "password": "demo-password"}'
```

The response is your profile and your branches. Note a `branch.id` for the
next steps.

**2. Read something**: GET requests only need the cookie.

```sh
curl -b cookies.txt http://127.0.0.1:8080/api/me
curl -b cookies.txt 'http://127.0.0.1:8080/api/issues?limit=5'
curl -b cookies.txt http://127.0.0.1:8080/api/dashboard
```

**3. Change something**: add the `Origin` and `Content-Type` headers.

```sh
# Create a ticket (replace BRANCH_ID with the id from step 1)
curl -b cookies.txt -X POST http://127.0.0.1:8080/api/issues \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"branch_id": "BRANCH_ID", "type": "ticket", "title": "The projector is broken"}'

# Comment on it (replace ISSUE_ID with the "id" from the response above)
curl -b cookies.txt -X POST http://127.0.0.1:8080/api/issues/ISSUE_ID/comments \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  -d '{"body": "It flickers and then turns off."}'
```

**4. Sign out**

```sh
curl -b cookies.txt -X POST http://127.0.0.1:8080/api/auth/logout -H 'Origin: http://localhost:5173'
```

Tips:

- Add `-i` to see the status code and headers, or pipe through `jq` to
  pretty-print: `curl -s -b cookies.txt http://127.0.0.1:8080/api/me | jq`.
- Edits send the `version` you last saw, for example
  `PATCH /issues/{id}` with `{"version": 1, "title": "New title"}`. If someone
  changed it in between, you get `409 version_conflict`; fetch it again and retry.
- A `401 unauthenticated` means the cookie is missing or expired: sign in again.
