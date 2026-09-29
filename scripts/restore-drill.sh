#!/usr/bin/env sh
# Restore drill: restores a dump into a scratch database next to the real one,
# times it, checks row counts, drops the scratch database and appends a line to
# the drill log. Unlike restore.sh it never touches the live database or stops
# web/worker. See "Test the restore" in docs/deployment.md.
#
# Usage: scripts/restore-drill.sh [dump-file]   (default: the newest dump in BACKUP_DIR)
#
# Environment (all optional): COMPOSE_FILE, ENV_FILE, BACKUP_DIR as in
# backup.sh; DRILL_LOG (default: docs/restore-drills.log).
set -eu

cd "$(dirname "$0")/.."

if [ -z "${COMPOSE_FILE:-}" ]; then
  if [ -f docker-compose.prod.yml ]; then COMPOSE_FILE=docker-compose.prod.yml; else COMPOSE_FILE=docker-compose.yml; fi
fi
ENV_FILE="${ENV_FILE:-.env.prod}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DRILL_LOG="${DRILL_LOG:-docs/restore-drills.log}"
scratch="sla_restore_drill"

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

dump="${1:-$(ls "$BACKUP_DIR"/sla-*.dump 2>/dev/null | sort | tail -1)}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "drill: no dump found (pass one, or run scripts/backup.sh first)" >&2
  exit 2
fi

psql_scratch() {
  compose exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $scratch -At -c \"$1\"" < /dev/null
}
drop_scratch() {
  compose exec -T postgres sh -c "dropdb -U \"\$POSTGRES_USER\" --if-exists $scratch" < /dev/null
}
trap drop_scratch EXIT

drop_scratch
compose exec -T postgres sh -c "createdb -U \"\$POSTGRES_USER\" $scratch" < /dev/null

start="$(date +%s)"
compose exec -T postgres sh -c \
  "pg_restore --username=\"\$POSTGRES_USER\" --dbname=$scratch --no-owner --single-transaction --exit-on-error" \
  < "$dump"
seconds=$(( $(date +%s) - start ))

# A restore that "succeeds" into an empty schema is still a failed drill.
cases="$(psql_scratch 'select count(*) from cases')"
tables="$(psql_scratch "select count(*) from information_schema.tables where table_schema='public'")"
size="$(du -h "$dump" | cut -f1)"
line="$(date -u +%Y-%m-%dT%H:%M:%SZ) dump=$(basename "$dump") size=$size restore_seconds=$seconds tables=$tables cases=$cases"
echo "drill: $line"
echo "$line" >> "$DRILL_LOG"
