# Acme Desk lab: authentication (kept out of the config JSON)

- Connection step: **Authentication = Bearer token**, **API address = `http://127.0.0.1:4100`** (needs `CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1` on the web app and worker).
- Token: the lab's `API_TOKEN` (default in `/Users/yasseralnajjar/Workspace/ideas/custom-provider/readme.md`). Enter it in the **Bearer token** field only.
- The lab also accepts `X-Api-Key`, but the config uses `Authorization: Bearer`. `/health` and `/elapsed-config.json` need no auth; every `/api/*` route returns 401 without it.
- Config: `acme-desk.custom-rest.config.json`. Verify: `LAB_TOKEN=<token> CUSTOM_PROVIDER_ALLOW_PRIVATE_HOSTS=1 pnpm --filter @sla/custom-ticket exec tsx dev/verify-acme-desk-config.ts`
