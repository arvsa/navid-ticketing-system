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

You only need [Docker](https://www.docker.com) and git.

1. **Clone the repository:**

   ```sh
   git clone https://github.com/arvsa/navid-ticketing-system
   cd navid-ticketing-system
   ```

2. **Build and start** the database, backend and frontend:

   ```sh
   docker compose up -d --build
   ```

   The first build compiles the backend and takes a few minutes.

3. **Add demo data** (optional):

   ```sh
   docker compose exec backend admin seed-demo
   ```

4. **Open http://localhost:8000** and sign in with a demo account or create an account. Every one
   has the password `demo-password`:

   | Account | Role |
   |---|---|
   | `superadmin@demo.school` | Super admin (all branches) |
   | `admin@north.demo.school` | Admin of the North branch (also `south`, `east`) |
   | `member1@north.demo.school` | A member (`member1` to `member28`, in each branch) |


Stop it with `docker compose down`. Add `-v` to also delete the data.

### Without internet access (real issue for iranians in 2026 :/)

Download the offline bundle from the
[releases](https://github.com/arvsa/navid-ticketing-system/releases), from
inside `navid-ticketing-system/`, and start it:

```sh
./get-offline-bundle.sh    # or download navid-offline-<version>-<arch>.zip by hand and unzip it
cd navid-offline
docker load -i navid-images-<version>-<arch>.tar.gz
docker compose up -d
```

Then continue from step 3 above.

See [instructions/offline-bundle.md](instructions/offline-bundle.md) for more details.

Follow [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md) for more details on respective services.
