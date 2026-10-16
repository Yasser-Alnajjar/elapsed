#!/usr/bin/env bash
# H-10: read-only verification of the Launch Gate security items on the
# production host. Prints one PASS / FAIL / MANUAL line per check, then a
# summary. Never prints a secret value (only key names, counts and hashes are
# compared in memory), never writes to the database, changes nothing.
#
# Run on the production host, from the repo checkout (section 1 needs git
# history):
#   scripts/prod/h10-verify.sh [ENV_FILE]     # default .env.prod, else .env
# or, without updating the host checkout, from a workstation:
#   ssh -i KEY ubuntu@13.62.74.24 'cd ~/elapsed && bash -s' < scripts/prod/h10-verify.sh
# Optional environment:
#   COMPOSE_FILE      compose file production runs     (docker-compose.yml)
#   POSTGRES_SERVICE  compose service of the database  (postgres)
#   H10_TIMEOUT       seconds allowed per docker/psql call (30)
#
# Exit status: 0 every check PASS; 1 at least one FAIL; 3 no FAIL but MANUAL
# items remain; 2 usage error.
#
# A check that could not run (no docker, query error, timeout, unexpected
# schema) is a FAIL ("not verified"), never a PASS. MANUAL is only used for
# what a script cannot observe: provider-side revocation and owner decisions.
set -u

# xtrace would print every secret this script reads (it happened once; see
# docs/h-phase-close-out.md, H-10). Refuse rather than leak.
case $- in *x*) echo "refusing to run with xtrace (bash -x): it would print secret values" >&2; exit 2 ;; esac
set +x

# From a file: run at the repo root. Streamed (`ssh host 'cd ~/elapsed && bash -s' < h10-verify.sh`): stay in the current directory.
src="${BASH_SOURCE[0]:-}"
if [ -n "$src" ] && [ -f "$src" ]; then cd "$(dirname "$src")/../.." || exit 2; fi

if [ $# -ge 1 ]; then ENV_FILE="$1"
elif [ -f .env.prod ]; then ENV_FILE=.env.prod
else ENV_FILE=.env
fi
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
PG_SERVICE="${POSTGRES_SERVICE:-postgres}"
H10_TIMEOUT="${H10_TIMEOUT:-30}"

[ -f "$ENV_FILE" ] || { echo "no env file: $ENV_FILE" >&2; exit 2; }

n_pass=0; n_fail=0; n_manual=0
pass()   { printf 'PASS    %s\n' "$1"; n_pass=$((n_pass + 1)); }
bad()    { printf 'FAIL    %s\n' "$1"; n_fail=$((n_fail + 1)); }
manual() { printf 'MANUAL  %s\n' "$1"; n_manual=$((n_manual + 1)); }
info()   { printf '        %s\n' "$1"; }
sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
strip() { sed -E "s/^[^=]*=//; s/\r\$//; s/^[\"']//; s/[\"']\$//"; }
val() { grep -E "^[[:space:]]*(export[[:space:]]+)?$2=" "$1" 2>/dev/null | tail -1 | strip; }
# Every docker call gets its own stdin (a heredoc or /dev/null): when this script is streamed with `bash -s`,
# a docker command left on the shared stdin swallows the rest of the script (seen on the host 2026-10-16).
# Kills the command after H10_TIMEOUT seconds (perl is on both macOS and Ubuntu; coreutils timeout is not on macOS).
with_timeout() { perl -e 'alarm shift @ARGV; exec @ARGV or exit 127' "$H10_TIMEOUT" "$@"; }

echo "H-10 verification  env=$ENV_FILE  compose=$COMPOSE_FILE  $(date -u +%Y-%m-%dT%H:%MZ)  $(git rev-parse --short HEAD 2>/dev/null || echo no-git)"

echo "== 1. No value from .env.prod's public git history is still in use (under any name)"
# Commits in which .env.prod was tracked (1ec4936, c3393fa, af08635; the repo is public). Found from history, not hard-coded.
is_config() { # configuration, not secrets
  case "$1" in
    POSTGRES_USER|POSTGRES_DB|NEXTAUTH_URL|WORKER_*|OPS_ALERT_EMAIL|OPS_ALERT_SMTP_HOST|OPS_ALERT_SMTP_PORT|OPS_ALERT_SMTP_SECURITY|OPS_ALERT_SMTP_FROM|OPS_ALERT_SMTP_USER) return 0 ;;
    DEPLOYMENT_SMTP_HOST|DEPLOYMENT_SMTP_PORT|DEPLOYMENT_SMTP_SECURITY|DEPLOYMENT_SMTP_FROM|DEPLOYMENT_SMTP_USER|PLATFORM_ADMIN_EMAILS|GUARD_OVERRIDE_OPERATOR_EMAILS|CUSTOM_PROVIDER_*|SSL_CERT_DIR|WEB_BIND) return 0 ;;
  esac
  return 1
}
leaked_commits=$(git log --all --format=%h -- .env.prod 2>/dev/null)
if [ -z "$leaked_commits" ]; then
  bad "not verified: no git history of .env.prod here; run from a full (non-shallow) clone"
else
  history_file() { for c in $leaked_commits; do git show "$c:.env.prod" 2>/dev/null; done; }
  # "sha256 KEY" for every non-empty secret value ever committed; held in memory only.
  leaked=$(history_file | grep -vE '^[[:space:]]*#' | grep '=' | while IFS= read -r line; do
    k=$(printf '%s' "$line" | sed -E 's/=.*//; s/^[[:space:]]*(export[[:space:]]+)?//')
    is_config "$k" && continue
    v=$(printf '%s\n' "$line" | strip)
    [ -n "$v" ] && printf '%s %s\n' "$(sha "$v")" "$k"
  done | sort -u)
  # (a) Each leaked secret key, by name.
  for k in $(printf '%s\n' "$leaked" | awk '{print $2}' | sort -u); do
    if [ "$k" = SENTRY_DSN ]; then info "SENTRY_DSN: out of scope by owner decision (BL-08, 2026-10-16: Sentry removed, nothing reads it)"; continue; fi
    cur=$(val "$ENV_FILE" "$k")
    if [ -n "$cur" ] && printf '%s\n' "$leaked" | grep -qx "$(sha "$cur") $k"; then bad "$k still equals a value from the public git history; rotate it"
    elif [ -z "$cur" ] && [ "$k" = OPS_ALERT_SMTP_PASSWORD ]; then
      manual "OPS_ALERT_SMTP_PASSWORD is no longer configured, but its old value is public: confirm the password was changed (or the app password revoked) at the mail provider, and give the date"
    elif [ -z "$cur" ]; then manual "$k is not set now; confirm its old value was revoked where it was issued"
    else pass "$k differs from every value in the git history"
    fi
  done
  # (b) Every current secret, against every leaked value under any other name (DC-20: the leaked ops SMTP password lived on as DEPLOYMENT_SMTP_PASSWORD).
  reused=""
  for k in $(grep -vE '^[[:space:]]*#' "$ENV_FILE" | grep '=' | sed -E 's/=.*//; s/^[[:space:]]*(export[[:space:]]+)?//' | sort -u); do
    is_config "$k" && continue
    cur=$(val "$ENV_FILE" "$k")
    [ -z "$cur" ] && continue
    from=$(printf '%s\n' "$leaked" | awk -v h="$(sha "$cur")" -v k="$k" '$1 == h && $2 != k {print $2}' | sort -u | tr '\n' ' ')
    [ -n "$from" ] && { bad "$k reuses the leaked value of: $from(rotate it at its provider)"; reused=1; }
  done
  [ -z "$reused" ] && pass "no current secret reuses a leaked value under another name"
  unset cur leaked
fi

echo "== 2. Session and encryption secrets set and pairwise distinct"
seen=""
for k in NEXTAUTH_SECRET INTEGRATION_CONFIG_ENCRYPTION_KEY SMTP_ENCRYPTION_KEY INTEGRATION_TOKEN_ENCRYPTION_KEY; do
  v=$(val "$ENV_FILE" "$k")
  if [ -z "$v" ]; then bad "$k is not set"; continue; fi
  h=$(sha "$v")
  case " $seen " in *" $h "*) bad "$k equals another of these secrets" ;; *) pass "$k set, distinct" ;; esac
  seen="$seen $h"
done
pg_pw=$(val "$ENV_FILE" POSTGRES_PASSWORD)
db_url=$(val "$ENV_FILE" DATABASE_URL)
if [ -z "$pg_pw" ]; then bad "POSTGRES_PASSWORD is not set"
else
  case "$db_url" in *":$pg_pw@"*) pass "DATABASE_URL uses POSTGRES_PASSWORD" ;; *) bad "DATABASE_URL does not contain POSTGRES_PASSWORD (the app and the database disagree)" ;; esac
fi
unset v pg_pw db_url

# --- database helpers -------------------------------------------------------
dc=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
db_ok=0
db_why=""
# The application's database and role come from DATABASE_URL, not POSTGRES_DB:
# on the host POSTGRES_DB names an empty default database (C-15), so querying
# it would make every count 0 and pass vacuously.
db_url=$(val "$ENV_FILE" DATABASE_URL)
app_db=$(printf '%s' "$db_url" | sed -nE 's#^[a-z]+://[^/]*/([^/?]+).*#\1#p')
app_role=$(printf '%s' "$db_url" | sed -nE 's#^[a-z]+://([^:@/]+)[:@].*#\1#p')
unset db_url
if [ -z "$app_db" ] || [ -z "$app_role" ]; then db_why="DATABASE_URL in $ENV_FILE has no database name or user"
elif ! command -v docker >/dev/null 2>&1; then db_why="docker is not installed here"
elif [ ! -f "$COMPOSE_FILE" ]; then db_why="$COMPOSE_FILE not found"
else
  running=$(with_timeout "${dc[@]}" ps --services --status running </dev/null 2>/dev/null)
  if printf '%s\n' "$running" | grep -qx "$PG_SERVICE"; then db_ok=1
  else db_why="the $PG_SERVICE service is not running here (not the production host?)"
  fi
fi
err_file=$(mktemp "${TMPDIR:-/tmp}/h10.XXXXXX"); trap 'rm -f "$err_file"' EXIT
# Runs one read-only query (SQL on stdin) and puts its single output line in
# $q_out. Returns non-zero, with the reason in $q_out, on any error or timeout.
query() {
  local rc
  q_out=$(with_timeout "${dc[@]}" exec -T "$PG_SERVICE" sh -c \
    'exec psql -X -q -v ON_ERROR_STOP=1 -U "$1" -d "$2" -tA -c "set default_transaction_read_only = on" -f -' \
    sh "$app_role" "$app_db" 2>"$err_file")
  rc=$?
  q_out=$(printf '%s' "$q_out" | tr -d '\r' | sed '/^$/d' | tail -1)
  if [ "$rc" -ne 0 ]; then
    [ "$rc" -eq 142 ] && q_out="timed out after ${H10_TIMEOUT}s" || q_out="query failed (exit $rc): $(head -1 "$err_file")"
    return 1
  fi
}
# "<bad> <total>" -> PASS/FAIL. $1 label, $2 noun for the total.
count_check() {
  local label="$1" noun="$2" nbad ntotal
  if ! query; then bad "not verified: $label: $q_out"; return; fi
  read -r nbad ntotal <<< "$q_out"
  case "$nbad$ntotal" in ''|*[!0-9]*) bad "not verified: $label: unexpected output"; return ;; esac
  if [ "$nbad" -eq 0 ]; then pass "$label: 0 of $ntotal $noun"
  else bad "$label: $nbad of $ntotal $noun"
  fi
}
# Ciphertext shapes from packages/db/src/crypto.ts: base64url(12-byte IV).base64url(16-byte tag).base64url(ciphertext).
GCM='[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]*'
ENC="^enc:v1:$GCM\$"   # integration tokens, Slack token, custom secrets
RAW="^$GCM\$"          # IntegrationConfig.clientSecret, OrganizationEmailSettings.password (no prefix)

echo "== 3. Stored credentials encrypted at rest (checked against the Prisma schema)"
if [ "$db_ok" = 0 ]; then
  bad "not verified: $db_why"
else
  info "application database (from DATABASE_URL): $app_db"
  if query <<<'select count(*) from _prisma_migrations where finished_at is not null and rolled_back_at is null;'; then
    case "$q_out" in ''|*[!0-9]*|0) bad "not verified: $app_db has no applied Prisma migrations (wrong database?)" ;; *) pass "$app_db has $q_out applied migrations" ;; esac
  else bad "not verified: migration lookup in $app_db: $q_out"
  fi
  query <<'SQL'
select count(*) from (values
  ('integrations','credentials','jsonb'),
  ('custom_provider_drafts','secrets','jsonb'),
  ('slack_integrations','accessToken','text'),
  ('integration_configs','clientSecret','text'),
  ('organization_email_settings','password','text')) e(t, c, ty)
join information_schema.columns ic
  on ic.table_schema = current_schema() and ic.table_name = e.t and ic.column_name = e.c and ic.data_type = e.ty;
SQL
  if [ $? -ne 0 ]; then bad "not verified: schema lookup: $q_out"; schema_ok=0
  elif [ "$q_out" = 5 ]; then pass "schema has the 5 credential columns with the expected types"; schema_ok=1
  else bad "not verified: schema has $q_out of the 5 expected credential columns; the checks below would be wrong"; schema_ok=0
  fi
  if [ "$schema_ok" = 1 ]; then
    count_check "integrations.credentials accessToken/refreshToken not enc:v1 ciphertext" "tokens" <<SQL
select count(*) filter (where (i.credentials->>f.k) !~ '$ENC') || ' ' || count(*)
from integrations i cross join (values ('accessToken'), ('refreshToken')) f(k)
where jsonb_typeof(i.credentials) = 'object' and jsonb_typeof(i.credentials->f.k) = 'string';
SQL
    count_check "integrations.credentials.secrets (custom source) values not enc:v1 ciphertext" "secret values" <<SQL
select count(*) filter (where jsonb_typeof(s.v) <> 'string' or (s.v #>> '{}') !~ '$ENC') || ' ' || count(*)
from integrations i
cross join lateral jsonb_each(case when jsonb_typeof(i.credentials->'secrets') = 'object' then i.credentials->'secrets' end) s(k, v);
SQL
    count_check "integrations.credentials with a shape the checks above do not cover" "rows with credentials" <<'SQL'
select count(*) filter (where not (
         jsonb_typeof(credentials) = 'null'
      or coalesce(jsonb_typeof(credentials->'accessToken'), '') = 'string'
      or coalesce(jsonb_typeof(credentials->'secrets'), '') = 'object')) || ' ' || count(*)
from integrations where credentials is not null;
SQL
    if query <<'SQL'
select coalesce(string_agg(distinct i.provider::text || ':' || k, ' ' order by i.provider::text || ':' || k), '-')
from integrations i cross join lateral jsonb_object_keys(case when jsonb_typeof(i.credentials) = 'object' then i.credentials end) k;
SQL
    then info "credential JSON keys in use (names only): $q_out"
    else bad "not verified: credential key listing: $q_out"
    fi
    count_check "custom_provider_drafts.secrets values not enc:v1 ciphertext" "draft secret values" <<SQL
select count(*) filter (where jsonb_typeof(s.v) <> 'string' or (s.v #>> '{}') !~ '$ENC') || ' ' || count(*)
from custom_provider_drafts d
cross join lateral jsonb_each(case when jsonb_typeof(d.secrets) = 'object' then d.secrets end) s(k, v);
SQL
    count_check "slack_integrations.accessToken not enc:v1 ciphertext" "Slack bot tokens" <<SQL
select count(*) filter (where "accessToken" !~ '$ENC') || ' ' || count(*) from slack_integrations;
SQL
    count_check "integration_configs.clientSecret not AES-GCM ciphertext" "OAuth client secrets" <<SQL
select count(*) filter (where "clientSecret" !~ '$RAW') || ' ' || count(*) from integration_configs;
SQL
    count_check "organization_email_settings.password not AES-GCM ciphertext" "SMTP passwords" <<SQL
select count(*) filter (where password !~ '$RAW') || ' ' || count(*) from organization_email_settings;
SQL
  fi
fi

echo "== 4. No development services or data in production"
if [ "$db_ok" = 0 ]; then
  bad "not verified: $db_why"
else
  info "running compose services: $(printf '%s ' $running)"
  unexpected=$(with_timeout docker ps --format '{{.Label "com.docker.compose.service"}}|{{.Names}}' </dev/null 2>/dev/null \
    | awk -F'|' '$1 !~ /^(postgres|web|worker|nginx)$/ {print $2}' | tr '\n' ' ')
  if [ -n "${unexpected// /}" ]; then bad "containers outside the production services are running: $unexpected"
  else pass "only postgres, web, worker and nginx containers are running"
  fi
  published=$(with_timeout docker ps --format '{{.Label "com.docker.compose.service"}}|{{.Ports}}' </dev/null 2>/dev/null \
    | awk -F'|' '$1 != "nginx"' | tr ',' '\n' | grep -- '->' | grep -v '127\.0\.0\.1:' | grep -v '\[::1\]:' || true)
  if [ -n "$published" ]; then bad "a non-proxy container publishes a public host port: $(printf '%s' "$published" | tr '\n' ' ')"
  else pass "only nginx publishes host ports"
  fi
  for s in web worker; do
    e=$(with_timeout "${dc[@]}" exec -T "$s" printenv NODE_ENV </dev/null 2>/dev/null | tr -d '[:space:]')
    [ "$e" = "production" ] && pass "$s NODE_ENV=production" || bad "$s NODE_ENV is '${e:-unset or unreachable}'"
  done
  count_check "development seed data (seed-org-*, Perf Baseline orgs, *.elapsed-seed.test users, perf-* cases)" "rows checked" <<'SQL'
select (o.n + u.n + c.n) || ' ' || (o.t + u.t + c.t) from
  (select count(*) filter (where id like 'seed-org-%' or name like 'Perf Baseline%') n, count(*) t from organizations) o,
  (select count(*) filter (where email like '%.elapsed-seed.test' or id like 'seed-user-%') n, count(*) t from users) u,
  (select count(*) filter (where "externalId" like 'perf-%') n, count(*) t from cases) c;
SQL
  query <<<'select count(*) from organizations;' && info "organizations in production: $q_out"
fi
if command -v ss >/dev/null 2>&1; then
  listening=$(ss -ltnH 2>/dev/null | awk '{print $4}')
  hits=""
  for p in 5432 3000 3001 5555 9229 1025 8025; do
    printf '%s\n' "$listening" | grep -qE "(^|:)$p\$" && hits="$hits $p"
  done
  if [ -n "$hits" ]; then bad "development/database ports listening on the host:$hits"
  else pass "no host listener on 5432 3000 3001 5555 9229 1025 8025"
  fi
else
  bad "not verified: ss is not available, host listeners not checked"
fi

echo "== 5. Owner actions a script cannot observe"
manual "Credentials printed by the earlier traced (bash -x) run are exposed: POSTGRES_PASSWORD, DATABASE_URL, NEXTAUTH_SECRET and the three encryption keys. Confirm POSTGRES_PASSWORD/DATABASE_URL and NEXTAUTH_SECRET were rotated after that run (procedure: docs/h-phase-close-out.md, H-10 rotation plan), and record the owner decision on the encryption keys."

echo
printf 'Summary: %d PASS, %d FAIL, %d MANUAL\n' "$n_pass" "$n_fail" "$n_manual"
if [ "$n_fail" -gt 0 ]; then echo "FAIL results present: H-10 cannot be closed."; exit 1
elif [ "$n_manual" -gt 0 ]; then echo "No FAIL. Each MANUAL line needs recorded evidence before H-10 can close."; exit 3
else echo "All checks PASS."; exit 0
fi
