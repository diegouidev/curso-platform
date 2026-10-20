#!/usr/bin/env bash
# Consistent snapshot of the database and covers into backups/, keeping the newest $KEEP.
#
#   scripts/backup.sh [compose-file]       (default: docker-compose.prod.yml)
#
# Safe while the app is running. Restore with scripts/restore.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

compose_file=${1:-docker-compose.prod.yml}
keep=${KEEP:-14}
name="curso-platform-$(date +%Y%m%d-%H%M%S).tar.gz"
compose=(docker compose -f "$compose_file")

mkdir -p backups
"${compose[@]}" exec -T backend python manage.py backup_data "/tmp/$name" >/dev/null
"${compose[@]}" cp "backend:/tmp/$name" "backups/$name"
"${compose[@]}" exec -T backend rm -f "/tmp/$name"

# Rotation: newest first, delete from the (keep+1)-th on.
ls -1t backups/curso-platform-*.tar.gz | tail -n +$((keep + 1)) | xargs -r rm --
echo "backups/$name"
