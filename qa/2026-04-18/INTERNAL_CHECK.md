# Fase 0 INTERNAL_CHECK — 2026-04-18

Contract for what Fase 0 verified, so downstream phases know what they can trust vs. what they must re-probe.

## In scope (verified by Fase 0)

- Dev server is live on `http://localhost:3111` (port from `.env`, not the `env.ts` default 3000).
- `GET /health` returns `200 {"status":"ok"}` with no auth.
- Postgres is reachable — proven by `GET /api/admin/users` returning 4 real user rows and `GET /api/auth/session` resolving a session cookie to a `User` row.
- Seed data exists for 3 of 4 roles (`SUPER_ADMIN`, `ADMIN`, `USER`) at the emails listed in `prisma/seed.ts`.
- `POST /api/auth/login` with email+password works for those 3 roles, returns a `session` cookie (HttpOnly, SameSite=Lax, Max-Age=86400) and a JSON user payload with the correct role string.
- `GET /api/auth/session` accepts the cookie and returns `{ user }` with `blocked: false` for all 3 seeded users.
- `/api/admin/users` guard correctly denies `ADMIN` and `USER` (403) and allows `SUPER_ADMIN` (200). Confirms RECON's claim that admin routes are SUPER_ADMIN-gated by equality.
- SPA root `GET /` returns a valid HTML document with Vite dev client injected — **RECON-001 does not reproduce**.
- The earlier RECON claim of "Postgres OFFLINE" was a false blocker caused by the Bash tool's default sandbox blocking localhost TCP from `bun -e` scripts. RECON.md has been corrected.
- Bun `1.3.6`, Node `v22.16.0` on the host; git HEAD `e9cc74e811edbd9dcee890af7233125970cc834d` (branch `main`, working tree dirty).
- `.gitignore` now excludes `qa/*/cookies/` so session tokens captured for later phases are never committed.

## Out of scope (DO NOT assume verified)

- **Role `QC`** — no seed user, not logged in. Any QC behavior is untested until a QC user is provisioned (direct DB `UPDATE` is required because `PUT /api/admin/users/:id/role` only whitelists `USER`/`ADMIN`).
- **Google OAuth flow** (`/api/auth/google`, `/api/auth/callback/google`) — not exercised (needs browser + real Google). Auto-promotion via `SUPER_ADMIN_EMAIL` is therefore also unverified end-to-end; only the seed-path `SUPER_ADMIN` was used.
- **Blocked user flow** — no user was blocked/unblocked. `/blocked` route, session-deletion-on-block, 403-on-blocked-login all remain untested.
- **Redis** — not directly probed. Inferred healthy because app boots and responds, but `appLog` / `getAppLogs` were not called. Fase 1 should hit `GET /api/admin/logs/app` as a Redis smoke.
- **WebSocket `/ws/presence`** — not connected in this phase.
- **Webhook endpoints** `/webhooks/aw` and `/webhooks/github` — not exercised. Auth paths (DB token, HMAC) untested.
- **MCP `/mcp`** — not exercised.
- **Write mutations** on any project / task / user — none performed. DB state is unchanged by this phase except for 3 new `Session` rows created by the login probes.
- **Rate limiting, CSRF, XSS, injection, tenant isolation** — all deferred to CH-5 SECURITY in a later phase.
- **UI rendering beyond `GET /` first byte** — no Playwright, no screenshots, no hydration check. Only the raw HTML response was inspected.
- **Performance / load** — single-request smoke only; no timing thresholds set.
- **Mobile viewport / responsive** — not applicable to headless phase.

## Known gaps to address in Fase 1+

1. Provision a `QC` user (direct DB update) OR document that RBAC matrix skips the QC row with a justified stub.
2. Decide whether `PUT /api/admin/users/:id/role` should accept `QC` — likely a product bug worth filing once confirmed.
3. Add a `/api/admin/logs/app` probe to Fase 1 DISCOVERY to confirm Redis is fully wired.
4. The password-based login lacks `Secure` cookie flag and lacks rate limiting — both deferred to SECURITY phase but noted here so they are not forgotten.

## Artifacts produced by Fase 0

- `qa/2026-04-18/SESSION.md` — run snapshot + login/RBAC results
- `qa/2026-04-18/INTERNAL_CHECK.md` — this file
- `qa/2026-04-18/cookies/superadmin.txt` — live session cookie (gitignored)
- `qa/2026-04-18/cookies/admin.txt` — live session cookie (gitignored)
- `qa/2026-04-18/cookies/user.txt` — live session cookie (gitignored)
- Edits to `qa/RECON.md` — corrected the false "Postgres OFFLINE" blocker and flipped `RECON-001` to `UNREPRODUCIBLE` in the BUG REGISTRY
- Edits to `.gitignore` — added `qa/*/cookies/` exclusion

## Trust handoff to Fase 1

Fase 1 DISCOVERY may assume:
- Dev server at `http://localhost:3111` is up throughout the session.
- The three cookie files in `qa/2026-04-18/cookies/` are valid for ~24h (Max-Age=86400s).
- The three seeded users + 1 Google-auto-promoted SUPER_ADMIN exist in the `User` table.
- No data was mutated beyond creating 3 Session rows; safe to diff counts against RECON's earlier totals (4 users, 2 projects, 2 tasks, 6 agents, 6 webhook tokens).
