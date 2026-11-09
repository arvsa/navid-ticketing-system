#!/bin/sh
# The backend container's entrypoint: runs the backend and watches an env
# file (ENV_FILE, default /config/.env, mounted from ./config on the host).
# When the file is added, changed or removed, it waits until nothing holds a
# lock on the database (`health --db-idle`), then restarts the backend with
# the new settings. Values in the file win over the compose file's.
set -u

env_file="${ENV_FILE:-/config/.env}"
interval="${ENV_WATCH_INTERVAL:-2}"
pid=

fingerprint() { cksum "$env_file" 2>/dev/null || echo none; }

start() {
  (
    if [ -f "$env_file" ]; then
      # Every variable the file sets is exported to the backend. CRLF line
      # endings (files saved on Windows) are fine.
      set -a
      eval "$(tr -d '\r' < "$env_file")"
      set +a
    fi
    exec backend
  ) &
  pid=$!
}

stop() {
  kill -TERM "$pid" 2>/dev/null
  wait "$pid" 2>/dev/null
}

# Waits for the database to be idle. A database that can't be reached has
# nothing of ours locked; the new settings may be what fixes it.
wait_for_idle() {
  waited=0
  while :; do
    out=$(health --db-idle 2>&1)
    case $? in
      0) return ;;
      2) echo "env watch: $out; restarting anyway"; return ;;
    esac
    if [ $((waited % 30)) -eq 0 ]; then
      echo "env watch: waiting for the database to be idle"
      echo "$out"
    fi
    sleep 1
    waited=$((waited + 1))
    # The backend stopped by itself meanwhile: restart it now.
    kill -0 "$pid" 2>/dev/null || return
  done
}

trap 'stop; exit 0' TERM INT

seen=$(fingerprint)
[ -f "$env_file" ] && echo "env watch: using $env_file"
start
while :; do
  # In the background, so a stop signal doesn't wait for the sleep.
  sleep "$interval" &
  wait $!
  # The backend exited on its own (a crash or bad settings): exit with it so
  # Docker's restart policy takes over.
  if ! kill -0 "$pid" 2>/dev/null; then
    wait "$pid"
    exit $?
  fi
  now=$(fingerprint)
  [ "$now" = "$seen" ] && continue
  # Give whoever is writing the file a moment to finish.
  sleep 1
  seen=$(fingerprint)
  echo "env watch: $env_file changed; restarting the backend when the database is idle"
  wait_for_idle
  stop
  start
done
