# Running a release

Run the whole app from one release archive: the images are built already, so
nothing is compiled and nothing is downloaded from Docker Hub, npm or
crates.io. You only need Docker, and no internet access once you have the
archive.

Get the archive with `./get-release.sh` (or from the
[releases](https://github.com/arvsa/navid-ticketing-system/releases) page,
`navid-release-<version>-<arch>.zip`). It unzips to a folder, `navid-release/`
(`navid-offline/` in earlier releases), containing:

| File | What |
|---|---|
| `navid-images-<version>-<arch>.tar.gz` | The postgres, backend and frontend images, e.g. `navid-images-1.0.1-amd64.tar.gz` |
| `docker-compose.yml` | Starts the three images |
| `config/.env.example` | Settings you can change; see [Change the settings](#change-the-settings) |
| `running-a-release.md` | This file |

## Run it

1. **Load the images** (once, takes a minute):

   ```sh
   docker load -i navid-images-1.0.1-amd64.tar.gz
   ```

2. **Start everything** from inside `navid-release/`:

   ```sh
   docker compose up -d
   ```

   The database starts empty. On the first start the backend creates one
   super admin, `superadmin@school.local`. To use your own email instead,
   start it the first time with
   `FIRST_SUPER_ADMIN_EMAIL=you@your.school docker compose up -d`.

3. **Get the temporary password:**

   ```sh
   docker compose logs backend | grep -A1 "First super admin"
   ```

   It is shown only on that first start.

4. **Open http://localhost:8000** and sign in with that email and the
   temporary password; you choose your own password straight away. From
   there, open the branches, import their people and appoint the admins.

Stop it with `docker compose down`. Add `-v` to also delete the data; the
next start is then a new, empty school with a new super admin.

Lost the temporary password before signing in? Make a new one:
`docker compose exec backend admin reset-password --email superadmin@school.local`.

### Another port

If port 8000 is taken, set both values, for example to 9000:

```sh
APP_PORT=9000 APP_ORIGIN=http://localhost:9000 docker compose up -d
```

`APP_ORIGIN` must match the address in the browser, or sign-in fails.

## Change the settings

Copy `config/.env.example` to `config/.env` and edit it. Its values win over
the ones in `docker-compose.yml`. The backend container watches the file:
within a few seconds of it being added, changed or removed, it waits until
nothing holds a lock on the database (a background job or a change being
saved), then restarts the backend with the new settings. Follow it with
`docker compose logs -f backend`; lines start with `env watch:`. Settings
that can't start the backend (say, a missing `APP_ORIGIN`) show up there too:
fix the file and it restarts again.

`APP_PORT` is the exception: it's the port Docker publishes, so set it when
starting, as below.

## Build the release archive

The images are built from the checked-out code:

```sh
./build-release.sh                # amd64, 1.0.1
./build-release.sh -v 1.0.2 arm64

# After shipping for a different architecture
# docker pull postgres:16
```

The version tags the images and names the files. Building amd64 on an ARM
machine (or the reverse) runs under emulation and is slow the first time.
