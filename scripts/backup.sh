#!/usr/bin/env sh
# Dumps the bundled Postgres to a timestamped, compressed file and prunes old
# dumps. Meant for cron on the host running docker-compose.prod.yml; see the
# "Backups" section of docs/deployment.md.
#
# Environment (all optional):
#   COMPOSE_FILE    compose file with the `postgres` service  (docker-compose.prod.yml, else docker-compose.yml)
#   ENV_FILE        env file passed to compose                (.env.prod, if it exists)
#   BACKUP_DIR      where dumps are written                   (./backups)
#   RETENTION_DAYS  dumps older than this are deleted         (14)
#   DB_NAME         database to dump            (the container's $POSTGRES_DB)
#   OFFSITE_COPY_CMD  shell command run after each good dump, with the dump path
#                   as $1, to copy it off the host, e.g.
#                   'aws s3 cp "$1" s3://my-bucket/sla/'  or  'rclone copy "$1" remote:sla'
#                   If it fails the script exits non-zero (the local dump is kept).
set -eu

cd "$(dirname "$0")/.."

if [ -z "${COMPOSE_FILE:-}" ]; then
  if [ -f docker-compose.prod.yml ]; then COMPOSE_FILE=docker-compose.prod.yml; else COMPOSE_FILE=docker-compose.yml; fi
fi
ENV_FILE="${ENV_FILE:-.env.prod}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/sla-$stamp.dump"
partial="$final.partial"
trap 'rm -f "$partial"' EXIT

# Custom format is compressed and lets pg_restore do a clean, selective
# restore. Credentials come from the container's own POSTGRES_* env, so none
# appear on this host's command line.
umask 077
compose exec -T -e DB_NAME="${DB_NAME:-}" postgres sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="${DB_NAME:-$POSTGRES_DB}" --format=custom --no-owner' \
  < /dev/null > "$partial"

# A dump that pg_restore can't list is not a backup. Fail loudly (non-zero exit
# for cron to report) instead of rotating good dumps out for a broken one.
if ! compose exec -T postgres pg_restore --list < "$partial" > /dev/null; then
  echo "backup: pg_restore could not read $partial; keeping previous backups" >&2
  exit 1
fi

mv "$partial" "$final"
trap - EXIT
echo "backup: wrote $final ($(du -h "$final" | cut -f1))"

find "$BACKUP_DIR" -name 'sla-*.dump' -type f -mtime +"$RETENTION_DAYS" -print -delete \
  | sed 's/^/backup: pruned /'

if [ -n "${OFFSITE_COPY_CMD:-}" ]; then
  if sh -c "$OFFSITE_COPY_CMD" backup-offsite "$final"; then
    echo "backup: copied $final off-site"
  else
    echo "backup: OFF-SITE COPY FAILED for $final" >&2
    exit 1
  fi
fi
