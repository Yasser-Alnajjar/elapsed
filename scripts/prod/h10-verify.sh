#!/usr/bin/env bash
# H-10: read-only verification of the Launch Gate security items on the host.
# Prints PASS / FAIL / MANUAL per check. Never prints a secret value, only
# key names. Changes nothing.
#
# Run on the production host, from the repo checkout (needs git history):
#   scripts/prod/h10-verify.sh [ENV_FILE]           # default .env.prod
# Optional: COMPOSE_FILE (default docker-compose.yml, the file production uses), POSTGRES_SERVICE (postgres)
#
# What it checks
#  1. Every secret that was ever committed in .env.prod's git history differs
#     from its current value (sha256 compare, so nothing is printed).
#  2. The four encryption/session secrets are set and pairwise distinct.
#  3. No stored integration token is still plaintext (enc:v1: prefix).
#  4. Only the expected services run; only nginx publishes host ports; no
#     dev-only ports listen; web runs with NODE_ENV=production.
#  Items a script cannot prove are printed as MANUAL with the exact question.
set -u
cd "$(dirname "$0")/../.."

ENV_FILE="${1:-.env.prod}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
PG_SERVICE="${POSTGRES_SERVICE:-postgres}"
fail=0
pass() { printf 'PASS    %s\n' "$1"; }
bad()  { printf 'FAIL    %s\n' "$1"; fail=1; }
manual() { printf 'MANUAL  %s\n' "$1"; }
sha() { printf '%s' "$1" | shasum -a 256 | cut -d' ' -f1; }
val() { # value of KEY in FILE (last assignment, quotes stripped)
  grep -E "^[[:space:]]*$2=" "$1" 2>/dev/null | tail -1 | sed -E "s/^[^=]*=//; s/^[\"']//; s/[\"']\$//"
}

[ -f "$ENV_FILE" ] || { echo "no $ENV_FILE"; exit 2; }

echo "== 1. Leaked-secret rotation (compared with git history, values never printed)"
# Commits in which .env.prod was tracked (roadmap step 0.4); found from history, not hard-coded.
leaked_commits=$(git log --all --format=%h -- .env.prod 2>/dev/null)
if [ -z "$leaked_commits" ]; then
  manual "git history not available here; run this from a full clone to compare against the leaked file"
else
  keys=$(for c in $leaked_commits; do git show "$c:.env.prod" 2>/dev/null; done \
    | grep -vE '^[[:space:]]*#' | grep '=' | sed -E 's/=.*//' | sort -u)
  for k in $keys; do
    cur=$(val "$ENV_FILE" "$k")
    hist=$(for c in $leaked_commits; do git show "$c:.env.prod" 2>/dev/null | grep -E "^[[:space:]]*$k=" | sed -E "s/^[^=]*=//; s/^[\"']//; s/[\"']\$//"; done | sort -u)
    # skip empty values and non-secrets
    case "$k" in
      POSTGRES_USER|POSTGRES_DB|NEXTAUTH_URL|WORKER_*|OPS_ALERT_EMAIL|OPS_ALERT_SMTP_HOST|OPS_ALERT_SMTP_PORT|OPS_ALERT_SMTP_SECURITY|OPS_ALERT_SMTP_FROM|OPS_ALERT_SMTP_USER) continue ;;
    esac
    [ -z "$hist" ] && continue
    same=0
    while IFS= read -r h; do
      [ -n "$h" ] && [ -n "$cur" ] && [ "$(sha "$h")" = "$(sha "$cur")" ] && same=1
    done <<< "$hist"
    if [ "$same" = 1 ]; then bad "$k still equals a value from the leaked file"
    elif [ -z "$cur" ]; then manual "$k is empty now; confirm the old value was revoked at its provider"
    else pass "$k differs from every leaked value"
    fi
  done
  manual "Third-party credentials cannot be proven rotated from here. The leaked file held SENTRY_DSN and OPS_ALERT_SMTP_PASSWORD (+ user/host): revoke/replace them at their providers and record the date in docs/deployment.md's rotation log. The 2026-09-19 log entry lists only POSTGRES_PASSWORD, NEXTAUTH_SECRET, INTEGRATION_CONFIG_ENCRYPTION_KEY, SMTP_ENCRYPTION_KEY."
fi

echo "== 2. Encryption / session secrets set and distinct"
names="NEXTAUTH_SECRET INTEGRATION_CONFIG_ENCRYPTION_KEY SMTP_ENCRYPTION_KEY INTEGRATION_TOKEN_ENCRYPTION_KEY"
seen=""
for k in $names; do
  v=$(val "$ENV_FILE" "$k")
  if [ -z "$v" ]; then bad "$k is not set"; continue; fi
  h=$(sha "$v")
  case " $seen " in *" $h "*) bad "$k equals another secret" ;; *) pass "$k set, distinct" ;; esac
  seen="$seen $h"
done

echo "== 3. Stored integration tokens encrypted"
dc="docker compose -f $COMPOSE_FILE --env-file $ENV_FILE"
if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  # shellcheck disable=SC2016
  q='select count(*) from integrations where credentials is not null and ((credentials->>'"'"'accessToken'"'"') is not null and (credentials->>'"'"'accessToken'"'"') not like '"'"'enc:v1:%'"'"');'
  n=$($dc exec -T "$PG_SERVICE" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "$0"' "$q" 2>/dev/null | tr -d '[:space:]')
  if [ "$n" = "0" ]; then pass "0 integrations hold a plaintext access token"
  elif [ -n "$n" ]; then bad "$n integrations hold a plaintext access token (run: pnpm db:encrypt-tokens)"
  else manual "could not query the database; run the count by hand"; fi
  s=$($dc exec -T "$PG_SERVICE" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "select count(*) from slack_integrations where \"accessToken\" not like '"'"'enc:v1:%'"'"'"' 2>/dev/null | tr -d '[:space:]')
  [ -n "$s" ] && manual "Slack bot tokens not encrypted: $s (roadmap I-1 lists Slack tokens as plaintext; decide whether this is accepted)"
else
  manual "docker or $COMPOSE_FILE not available here; run this script on the production host"
fi

echo "== 4. No development services in production"
if command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  services=$($dc ps --services --status running 2>/dev/null | sort | tr '\n' ' ')
  if [ -z "${services// /}" ]; then
    manual "no $COMPOSE_FILE services are running on this machine, so nothing was checked here; run this script on the production host"
  else
    echo "        running services: $services"
    for s in $services; do
      case "$s" in postgres|web|worker|nginx|caddy) ;; *) bad "unexpected service running: $s" ;; esac
    done
    published=$($dc ps --format '{{.Service}} {{.Ports}}' 2>/dev/null | grep -E '0\.0\.0\.0:|\[::\]:' | grep -v '^nginx\|^caddy' || true)
    [ -n "$published" ] && bad "non-proxy service publishes a host port: $(echo "$published" | awk '{print $1}' | tr '\n' ' ')" || pass "only the reverse proxy publishes host ports"
    env_web=$($dc exec -T web printenv NODE_ENV 2>/dev/null | tr -d '[:space:]')
    [ "$env_web" = "production" ] && pass "web NODE_ENV=production" || bad "web NODE_ENV is '${env_web:-unset}'"
  fi
else
  manual "compose file not present here"
fi
if command -v ss >/dev/null 2>&1; then
  for p in 5432 3000 3001 9229 1025 8025; do
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "(^|:)$p\$" && bad "port $p is listening on the host"
  done
  pass "dev ports (5432 3000 3001 9229 1025 8025) checked with ss"
fi
manual "Confirm no dev seed/perf data or dev user exists in production: run scripts/prod/h1-provider-pairs.sql table 3 and check the tenant count is the 10 real ones."

echo
[ "$fail" = 0 ] && echo "No FAIL results. Resolve every MANUAL line before ticking H-10." || echo "FAIL results present. Do not tick H-10."
exit "$fail"
