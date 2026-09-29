#!/usr/bin/env sh
# Restores a dump written by scripts/backup.sh into the bundled Postgres,
# replacing the database's current contents. See the "Backups" section of
# docs/deployment.md before running this against production.
#
# Usage: scripts/restore.sh <dump-file> [--yes]
#
# Environment (all optional): COMPOSE_FILE, ENV_FILE, BACKUP_DIR, DB_NAME, as in
# backup.sh. SKIP_SAFETY_BACKUP=1 skips the automatic pre-restore backup.
set -eu

cd "$(dirname "$0")/.."

if [ -z "${COMPOSE_FILE:-}" ]; then
  if [ -f docker-compose.prod.yml ]; then COMPOSE_FILE=docker-compose.prod.yml; else COMPOSE_FILE=docker-compose.yml; fi
fi
ENV_FILE="${ENV_FILE:-.env.prod}"

dump="${1:-}"
confirmed="${2:-}"
if [ -z "$dump" ] || [ ! -f "$dump" ]; then
  echo "usage: scripts/restore.sh <dump-file> [--yes]" >&2
  exit 2
fi

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

# `exec -T` forwards this script's stdin into the container, so calls that
# don't need it read /dev/null. Otherwise they'd swallow the typed confirmation.
db="$(compose exec -T -e DB_NAME="${DB_NAME:-}" postgres sh -c 'printf %s "${DB_NAME:-$POSTGRES_DB}"' < /dev/null)"

compose exec -T postgres pg_restore --list < "$dump" > /dev/null || {
  echo "restore: $dump is not a readable pg_dump custom-format file" >&2
  exit 1
}

if [ "$confirmed" != "--yes" ]; then
  printf 'This replaces ALL data in database "%s" with %s.\nType the database name to continue: ' "$db" "$dump"
  read -r answer
  [ "$answer" = "$db" ] || { echo "restore: aborted" >&2; exit 1; }
fi

if [ "${SKIP_SAFETY_BACKUP:-}" != "1" ]; then
  echo "restore: taking a safety backup of the current data first"
  "$(dirname "$0")/backup.sh" < /dev/null
fi

# Stop the app containers (whichever this compose file defines) so nothing
# writes mid-restore, and bring them back however the restore ends.
app_services="$(compose config --services | grep -E '^(web|worker)$' || true)"
if [ -n "$app_services" ]; then
  # shellcheck disable=SC2086
  compose stop $app_services
  # shellcheck disable=SC2086
  trap 'compose start $app_services' EXIT
fi

# One transaction: a restore that fails partway leaves the old data in place.
compose exec -T -e DB_NAME="$db" postgres sh -c \
  'pg_restore --username="$POSTGRES_USER" --dbname="$DB_NAME" --clean --if-exists --no-owner --single-transaction --exit-on-error' \
  < "$dump"

echo "restore: $db restored from $dump"
