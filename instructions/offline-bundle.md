# Offline bundle

Run the whole app from one archive, with no internet access: nothing is
downloaded from Docker Hub, npm or crates.io. You only need Docker.

The bundle is a folder, `navid-offline/`, containing:

| File | What |
|---|---|
| `navid-images.tar.gz` | The postgres, backend and frontend images (linux/amd64) |
| `docker-compose.yml` | Starts the three images |
| `offline-bundle.md` | This file |

## Run it

1. **Load the images** (once, takes a minute):

   ```sh
   docker load -i navid-images.tar.gz
   ```

2. **Start everything** from inside `navid-offline/`:

   ```sh
   docker compose up -d
   ```

3. **Add demo data:**

   ```sh
   docker compose exec backend admin seed-demo
   ```

4. **Open http://localhost:8000** and sign in. Every demo account has the
   password `demo-password`:

   | Account | Role |
   |---|---|
   | `superadmin@demo.school` | Super admin (all branches) |
   | `admin@north.demo.school` | Admin of the North branch (also `south`, `east`) |
   | `member1@north.demo.school` | A member (`member1` to `member28`, in each branch) |

Stop it with `docker compose down`. Add `-v` to also delete the data.

### Another port

If port 8000 is taken, set both values, for example to 9000:

```sh
APP_PORT=9000 APP_ORIGIN=http://localhost:9000 docker compose up -d
```

`APP_ORIGIN` must match the address in the browser, or sign-in fails.

## Build the bundle

On a machine with internet access, from the repository root. The backend
binaries come from the GitHub release matching the code (here `v0.1.1`):
extract `backend-linux-amd64.tar.gz` into `backend/dist/`.

```sh
docker build --platform linux/amd64 -f backend/Dockerfile.prebuilt -t navid-backend:0.1.1 backend
docker build --platform linux/amd64 -t navid-frontend:0.1.1 frontend
docker pull --platform linux/amd64 postgres:16

mkdir -p navid-offline
docker save postgres:16 navid-backend:0.1.1 navid-frontend:0.1.1 | gzip > navid-offline/navid-images.tar.gz
cp docker-compose.offline.yml navid-offline/docker-compose.yml
cp instructions/offline-bundle.md navid-offline/
```

When the version changes, update the image tags here and in
`docker-compose.offline.yml`.
