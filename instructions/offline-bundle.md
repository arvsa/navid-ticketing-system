# Offline bundle

Run the whole app from one archive, with no internet access: nothing is
downloaded from Docker Hub, npm or crates.io. You only need Docker.

The bundle is a folder, `navid-offline/`, containing:

| File | What |
|---|---|
| `navid-images-<version>-<arch>.tar.gz` | The postgres, backend and frontend images, e.g. `navid-images-1.0.1-amd64.tar.gz` |
| `docker-compose.yml` | Starts the three images |
| `offline-bundle.md` | This file |

## Run it

1. **Load the images** (once, takes a minute):

   ```sh
   docker load -i navid-images-1.0.1-amd64.tar.gz
   ```

2. **Start everything** from inside `navid-offline/`:

   ```sh
   docker compose up -d
   ```

   The database starts empty. On the first start the backend creates one
   root user, `superadmin@school.local`. To use your own email instead,
   start it the first time with
   `FIRST_SUPER_ADMIN_EMAIL=you@your.school docker compose up -d`.

3. **Get the temporary password:**

   ```sh
   docker compose logs backend | grep -A1 "First root user"
   ```

   It is shown only on that first start.

4. **Open http://localhost:8000** and sign in with that email and the
   temporary password; you choose your own password straight away. From
   there, open the branches, import their people and appoint the admins.

Stop it with `docker compose down`. Add `-v` to also delete the data; the
next start is then a new, empty school with a new root user.

Lost the temporary password before signing in? Make a new one:
`docker compose exec backend admin reset-password --email superadmin@school.local`.

### Another port

If port 8000 is taken, set both values, for example to 9000:

```sh
APP_PORT=9000 APP_ORIGIN=http://localhost:9000 docker compose up -d
```

`APP_ORIGIN` must match the address in the browser, or sign-in fails.

## Build the bundle

The images are built from the checked-out code:

```sh
./build-offline-bundle.sh                # amd64, 1.0.1
./build-offline-bundle.sh -v 1.0.2 arm64

# After shipping for a different architecture
# docker pull postgres:16
```

The version tags the images and names the files. Building amd64 on an ARM
machine (or the reverse) runs under emulation and is slow the first time.
