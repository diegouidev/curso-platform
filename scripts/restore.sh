#!/usr/bin/env bash
# Replaces the database and covers with those of a backup archive (scripts/backup.sh).
#
#   scripts/restore.sh backups/curso-platform-AAAAMMDD-HHMMSS.tar.gz [compose-file]
#
# Stops the backend meanwhile. Everything currently in the database is replaced.
set -euo pipefail
cd "$(dirname "$0")/.."

archive=${1:?Uso: scripts/restore.sh backups/arquivo.tar.gz [compose-file]}
compose_file=${2:-docker-compose.prod.yml}
compose=(docker compose -f "$compose_file")
[ -f "$archive" ] || { echo "Arquivo não encontrado: $archive" >&2; exit 1; }

# Refuse to cut an import in half.
if [ -n "$("${compose[@]}" ps -q --status running backend 2>/dev/null)" ]; then
  "${compose[@]}" exec -T backend python manage.py imports_idle
fi

"${compose[@]}" stop backend
# A one-off backend container mounts the same /data volume; root to fix ownership.
"${compose[@]}" run --rm --no-deps -T --user root \
  -v "$(realpath "$archive"):/restore.tar.gz:ro" \
  --entrypoint sh backend -c \
  'rm -rf /data/db.sqlite3 /data/db.sqlite3-wal /data/db.sqlite3-shm /data/media &&
   tar -xzf /restore.tar.gz -C /data && chown -R app:app /data'
"${compose[@]}" up -d --wait backend
echo "Restaurado: $archive"
