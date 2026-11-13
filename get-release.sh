#!/usr/bin/env bash
# Downloads and unzips a release (images and compose file) from the GitHub
# releases. See instructions/running-a-release.md.
#   ./get-release.sh [-v version] [amd64|arm64]
#   -v, --version   release to download (default: the latest release)
#   architecture    target platform (default: this machine's)
set -euo pipefail

repo=arvsa/navid-ticketing-system

usage() { echo "usage: $0 [-v version] [amd64|arm64]" >&2; exit 1; }

case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  *) arch=amd64 ;;
esac
version=
while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version) [ $# -ge 2 ] || usage; version="${2#v}"; shift 2 ;;
    amd64|arm64) arch="$1"; shift ;;
    *) usage ;;
  esac
done

if [ -z "$version" ]; then
  # github.com/.../releases/latest redirects to .../releases/tag/vX.Y.Z.
  latest=$(curl -fsSL --retry 5 -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")
  version="${latest##*/v}"
  [ "$version" != "$latest" ] || { echo "Couldn't find the latest release." >&2; exit 1; }
fi

# Check it exists first: curl's exit code can't tell "not found" from a
# dropped connection. Asks for one byte only.
http_code() { curl -sL --retry 5 -r 0-0 -o /dev/null -w '%{http_code}' "$1" || true; }

# Earlier releases named the archive and its folder navid-offline.
folder=
for name in navid-release navid-offline; do
  zipfile="$name-$version-$arch.zip"
  url="https://github.com/$repo/releases/download/v$version/$zipfile"
  if [ -f "$zipfile" ] && unzip -tq "$zipfile" >/dev/null 2>&1; then
    folder=$name
    break
  fi
  code=$(http_code "$url")
  case "$code" in
    200|206) folder=$name; break ;;
    404) ;;
    *) echo "Can't reach GitHub (HTTP $code). Check the connection and try again." >&2; exit 1 ;;
  esac
done
[ -n "$folder" ] || { echo "Not found: $url (check the version and architecture on the releases page)" >&2; exit 1; }

if [ -f "$zipfile" ] && unzip -tq "$zipfile" >/dev/null 2>&1; then
  echo "Already downloaded: $zipfile"
else
  echo "Downloading $zipfile"
  # -C - resumes a partial download, so a dropped connection (or re-running
  # the script) continues where it stopped.
  attempt=1
  until curl -fL --retry 10 --retry-delay 5 -C - -o "$zipfile" "$url"; do
    [ "$attempt" -lt 30 ] || { echo "Gave up after $attempt attempts. Run the script again to resume." >&2; exit 1; }
    attempt=$((attempt + 1))
    echo "Download interrupted, resuming in 5 seconds..." >&2
    sleep 5
  done
fi

unzip -o "$zipfile"
echo
echo "Done. Next:"
echo "  cd $folder"
echo "  docker load -i navid-images-$version-$arch.tar.gz"
echo "  docker compose up -d"
