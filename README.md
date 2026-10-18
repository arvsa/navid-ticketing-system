# School ticketing

A ticketing app for schools: branches, people and groups, issues (tickets,
actions, reports and events), assignments and approvals, a calendar with RSVPs,
an inbox, dashboards and Excel exports.

| Folder | What |
|---|---|
| [`backend/`](backend/README.md) | The API: Rust, axum, PostgreSQL 16 |
| [`frontend/`](frontend/README.md) | The web app: React 19, TypeScript, Vite |
| `School Ticketing UI-png/` | Screen designs |
| `presentation/` | Project presentation |
| `DESIGN.md` | Overall design |

## Run everything with Docker

You only need [Docker](https://www.docker.com).

1. **Build and start** the database, backend and frontend:

   ```sh
   docker compose up -d --build
   ```

   The first build compiles the backend and takes a few minutes.

2. **Add demo data**, so there's someone to sign in as:

   ```sh
   docker compose exec backend admin seed-demo
   ```

3. **Open http://localhost:8000** and sign in with a demo account. Every one
   has the password `demo-password`:

   | Account | Role |
   |---|---|
   | `superadmin@demo.school` | Super admin (all branches) |
   | `admin@north.demo.school` | Admin of the North branch (also `south`, `east`) |
   | `member1@north.demo.school` | A member (`member1` to `member28`, in each branch) |

How it fits together:

```text
browser ──► frontend (nginx, :8000) ──/api──► backend (:8080) ──► postgres (:5432)
              serves the built app
```

The frontend and `/api` are served from the same address, so the session
cookie and the backend's `Origin` check work without CORS. The backend applies
database migrations when it starts.

### Settings

The defaults work as they are. To change them, copy the example file and edit
it:

```sh
cp .env.example .env
```

| Setting | Default | Meaning |
|---|---|---|
| `APP_PORT` | `8000` | Port on your machine where the app is served |
| `APP_ORIGIN` | `http://localhost:8000` | The address you open in the browser. Change it together with `APP_PORT` |
| `COOKIE_SECURE` | `false` | Set to `true` when serving over HTTPS |
| `RUST_LOG` | `backend=info,...` | Backend log levels |

### Everyday commands

| Command | Does |
|---|---|
| `docker compose logs -f backend` | Follow the backend's logs |
| `docker compose up -d --build` | Rebuild and restart after changing code |
| `docker compose down` | Stop everything (data is kept) |
| `docker compose down -v` | Stop and **delete** the database and uploaded files |

Data lives in two Docker volumes: `pgdata` (the database) and `attachments`
(uploaded files). Back them up together.

## Developing

For day-to-day work, run only the database in Docker and the apps on your
machine, so changes reload straight away:

```sh
docker compose up -d postgres
```

Then follow [backend/README.md](backend/README.md) (`cargo run`, on
`http://127.0.0.1:8080`) and [frontend/README.md](frontend/README.md)
(`pnpm dev`, on http://localhost:5173). The dev frontend proxies `/api` to the
backend for you.
