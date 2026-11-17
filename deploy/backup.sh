#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
compose=(docker compose --env-file deploy/.env)
backup_root="${HELIX_BACKUP_PATH:-/srv/helix/backups}"
if [[ -f deploy/.env ]]; then
    configured_path="$(sed -n 's/^HELIX_BACKUP_PATH=//p' deploy/.env | tail -n 1)"
    backup_root="${configured_path:-$backup_root}"
fi
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_root/daily" "$backup_root/weekly"
chown 10001:10001 "$backup_root" "$backup_root/daily" "$backup_root/weekly"
trap '"${compose[@]}" up -d app' EXIT
"${compose[@]}" stop app
"${compose[@]}" run --rm --no-deps app python tools/web_manage.py backup --output "/backups/daily/helix-$stamp.tar.gz"
if [[ "$(date -u +%u)" == 7 ]]; then
    cp "$backup_root/daily/helix-$stamp.tar.gz" "$backup_root/weekly/helix-$stamp.tar.gz"
fi
find "$backup_root/daily" -maxdepth 1 -name 'helix-*.tar.gz' -type f | sort -r | tail -n +8 | xargs -r rm --
find "$backup_root/weekly" -maxdepth 1 -name 'helix-*.tar.gz' -type f | sort -r | tail -n +5 | xargs -r rm --
