#!/bin/sh
set -eu

# Root-owned systemd jobs use the running app's exact image and data volume.
# No API keys or entrance credentials are passed into the maintenance container.
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
backup_root=$(CDPATH= cd -- "$project_root/.." && pwd)/backups
exec 9>/run/lock/material-review-operations.lock
flock -n 9 || exit 0

app_id=$(docker compose --env-file "$project_root/.env.deploy" -f "$project_root/deploy/compose.private.yaml" ps -q app)
[ -n "$app_id" ] || { echo 'Application container unavailable.'; exit 1; }
image_id=$(docker inspect --format '{{.Image}}' "$app_id")
data_volume=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$app_id")
[ -n "$data_volume" ] || { echo 'Persistent data volume unavailable.'; exit 1; }
public_origin=$(docker exec "$app_id" node -p 'process.env.APP_PUBLIC_ORIGIN')
install -d -m 700 -o 1000 -g 1000 "$backup_root"

case "${1:-}" in
  '') set -- ;;
  --backup) set -- --with-backup ;;
  *) echo 'Usage: run-operations.sh [--backup]'; exit 1 ;;
esac

docker run --rm --name material-review-operations \
  --network host --user 1000:1000 --memory 384m --pids-limit 64 \
  --read-only --security-opt no-new-privileges:true \
  --env "APP_PUBLIC_ORIGIN=$public_origin" \
  --mount "type=volume,source=$data_volume,target=/data" \
  --mount "type=bind,source=$backup_root,target=/backups" \
  --mount "type=bind,source=$project_root/scripts/lib/operations.mjs,target=/app/scripts/lib/operations.mjs,readonly" \
  "$image_id" node scripts/operations.mjs \
  --data-dir /data --backup-dir /backups \
  --health-url http://127.0.0.1:3000/api/health --retain-days 14 "$@"
