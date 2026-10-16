#!/usr/bin/env sh
# Restore drill: restores a dump into a scratch database next to the
# development database, times it, checks row counts, drops the scratch
# database and appends a line to the drill log. LOCAL DEVELOPMENT ONLY
# (roadmap section 7, "Testing environment"): it fails closed unless it is
# pointed at the local docker-compose.dev.yml database through a local Docker
# daemon, so it cannot reach production or any remote host.
#
# Usage: scripts/restore-drill.sh <dump-file>     (a dump copied to this machine)
#        scripts/restore-drill.sh                 (the newest sla-*.dump in BACKUP_DIR)
#
# Environment (all optional): BACKUP_DIR (default ./backups, git-ignored);
# DRILL_LOG (default $BACKUP_DIR/restore-drills.log). There is no COMPOSE_FILE
# or ENV_FILE override: the compose file is always docker-compose.dev.yml.
set -eu

cd "$(dirname "$0")/.."

COMPOSE_FILE="docker-compose.dev.yml"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DRILL_LOG="${DRILL_LOG:-$BACKUP_DIR/restore-drills.log}"
scratch="sla_restore_drill"

refuse() {
  echo "drill: refused: $1 (local development only; see roadmap section 7)" >&2
  exit 2
}

# Fail closed: a local Docker daemon only, never a remote one.
[ -z "${DOCKER_HOST:-}" ] || case "$DOCKER_HOST" in unix://*) ;; *) refuse "DOCKER_HOST points at a non-local daemon" ;; esac
docker_endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
case "$docker_endpoint" in unix://*|npipe://*) ;; *) refuse "the active Docker context is not a local daemon" ;; esac
[ -f "$COMPOSE_FILE" ] || refuse "$COMPOSE_FILE not found (run from the repository)"

compose() {
  docker compose -p Elapsed-dev -f "$COMPOSE_FILE" "$@"
}

dump="${1:-$(ls "$BACKUP_DIR"/sla-*.dump 2>/dev/null | sort | tail -1)}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "drill: no dump found (pass the path of a dump on this machine)" >&2
  exit 2
fi

# Only the throwaway development database user/instance defined in docker-compose.dev.yml is accepted.
[ "$(compose exec -T postgres sh -c 'printf %s "$POSTGRES_USER:$POSTGRES_PASSWORD"' < /dev/null 2>/dev/null)" = "user:password" ] \
  || refuse "the postgres service is not the development database from $COMPOSE_FILE (is it running?)"

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
mkdir -p "$(dirname "$DRILL_LOG")"
echo "$line" >> "$DRILL_LOG"
