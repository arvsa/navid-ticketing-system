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
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each version |

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

3. **Create the first root user**:

   ```sh
   docker compose exec backend admin create-root-user --email you@school.org --first-name Your --last-name Name
   ```

   It prints a temporary password; you choose your own after signing in.

4. **Open http://localhost:8000** and sign in.

To see every account, with the temporary passwords not yet replaced:

```sh
docker compose exec backend users                    # all
docker compose exec backend users --branch NTH --pending
docker compose exec backend users --help             # every filter
```

Always run these tools inside the backend container: there `DATABASE_URL`
points at the database. With `localhost` in a container they can't reach it.

Stop it with `docker compose down`. Add `-v` to also delete the data.

### In case of MANY, MANY, MANY internet issues (Iranians internet in 2026 :/)

Download the offline bundle via script or manually from the
[releases](https://github.com/arvsa/navid-ticketing-system/releases) and start it:

```sh
./get-offline-bundle.sh    # or manually
cd navid-offline
docker load -i navid-images-<version>-<arch>.tar.gz
docker compose up -d
```

Then continue from step 3 above.

See [instructions/offline-bundle.md](instructions/offline-bundle.md) for more details.

Follow [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md) for more details on respective services.
