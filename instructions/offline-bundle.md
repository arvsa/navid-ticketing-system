# Offline bundle

Run the whole app from one archive, with no internet access: nothing is
downloaded from Docker Hub, npm or crates.io. You only need Docker.

The bundle is a folder, `navid-offline/`, containing:

| File | What |
|---|---|
| `navid-images-<version>-<arch>.tar.gz` | The postgres, backend and frontend images, e.g. `navid-images-0.0.1-amd64.tar.gz` |
| `docker-compose.yml` | Starts the three images |
| `offline-bundle.md` | This file |

## Run it

1. **Load the images** (once, takes a minute):

   ```sh
   docker load -i navid-images-0.0.1-amd64.tar.gz
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

The images are built from the checked-out code:

```sh
./build-offline-bundle.sh                # amd64, 0.0.1
./build-offline-bundle.sh -v 0.0.2 arm64

# After shipping for a different architecture
# docker pull postgres:16
```

The version tags the images and names the files. Building amd64 on an ARM
machine (or the reverse) runs under emulation and is slow the first time.
