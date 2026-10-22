#!/usr/bin/env bash
# Builds navid-offline/: the images and compose file for running without
# internet access. See instructions/offline-bundle.md.
#   ./build-offline-bundle.sh [-v version] [amd64|arm64]
#   -v, --version   image tag and file version (default 0.0.1)
#   architecture    target platform (default amd64)
set -euo pipefail
cd "$(dirname "$0")"

usage() { echo "usage: $0 [-v version] [amd64|arm64]" >&2; exit 1; }

arch=amd64
version=0.0.1
while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version) [ $# -ge 2 ] || usage; version="$2"; shift 2 ;;
    amd64|arm64) arch="$1"; shift ;;
    *) usage ;;
  esac
done
platform="linux/$arch"
images="navid-offline/navid-images-$version-$arch.tar.gz"

docker build --platform "$platform" -t navid-backend:$version backend
docker build --platform "$platform" -t navid-frontend:$version frontend
docker pull --platform "$platform" postgres:16

mkdir -p navid-offline
docker save --platform "$platform" postgres:16 navid-backend:$version navid-frontend:$version | gzip > "$images"
# Point the compose file at this version's images.
sed -E "s/(navid-(backend|frontend)):[^[:space:]]+/\1:$version/" docker-compose.offline.yml > navid-offline/docker-compose.yml
cp instructions/offline-bundle.md navid-offline/

# Only this build's files, so older archives in the folder stay out. -0: the
# images are already compressed.
zipfile="navid-offline/navid-offline-$version-$arch.zip"
rm -f "$zipfile"
zip -0 "$zipfile" "$images" navid-offline/docker-compose.yml navid-offline/offline-bundle.md

echo "Images: $PWD/$images"
echo "Upload: $PWD/$zipfile"
