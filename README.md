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

3. **Add demo data** (optional):

   ```sh
   docker compose exec backend admin seed-demo
   ```

4. **Open http://localhost:8000** and sign in with a demo account or create an account. Every one
   has the password `demo-password`:

   | Account | Role |
   |---|---|
   | `superadmin@demo.school` | Super admin: runs the app (branches, people, groups) |
   | `admin@north.demo.school` | Admin of the North branch (also `south`, `east`) |
   | `member1@north.demo.school` | A member (`member1` to `member28`, in each branch) |


Stop it with `docker compose down`. Add `-v` to also delete the data.

### Running a release (no build, no downloads)

In case of MANY, MANY, MANY internet issues (Iranians internet in 2026 :/):
a release has the images built already, so once you have it nothing is
compiled or downloaded. Get it with the script, or manually from the
[releases](https://github.com/arvsa/navid-ticketing-system/releases), and start it:

```sh
./get-release.sh    # or manually
cd navid-release
docker load -i navid-images-<version>-<arch>.tar.gz
docker compose up -d
```

It starts empty, with one super admin. See
[instructions/running-a-release.md](instructions/running-a-release.md) for
signing in, changing the settings and building a release yourself.

### Changing the settings

Put a `.env` file in `config/` (copy [`config/.env.example`](config/.env.example)).
Its values win over `docker-compose.yml`, and the backend restarts with them
on its own a few seconds after the file changes, once nothing holds a lock on
the database.

Follow [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md) for more details on respective services.
