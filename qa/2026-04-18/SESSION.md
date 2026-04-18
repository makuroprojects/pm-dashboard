# QA Session Snapshot — 2026-04-18

## Run metadata

| Field              | Value                                                    |
| ------------------ | -------------------------------------------------------- |
| Session ID         | `qa/2026-04-18`                                          |
| Phase              | Fase 0 — ENV_PRECHECK                                    |
| Timestamp (start)  | 2026-04-18 05:41 UTC (first successful login response)   |
| Git commit SHA     | `e9cc74e811edbd9dcee890af7233125970cc834d`               |
| Branch             | `main`                                                   |
| Working tree       | dirty (see `git status` in RECON / top of conversation)  |
| Bun version        | `1.3.6`                                                  |
| Node version       | `v22.16.0` (not used by app; reported for env snapshot)  |
| Dev server         | `http://localhost:3111` (already running, not restarted) |
| Health endpoint    | `GET /health` → `200 {"status":"ok"}`                    |
| Operator           | `kurosakiblackangel@gmail.com`                           |

## Roles to test

Per `prisma/schema.prisma` enum `Role`: `USER`, `QC`, `ADMIN`, `SUPER_ADMIN`.

From the seed script (`prisma/seed.ts`) only three roles are seeded. Passwords are documented there — **never pasted in QA artifacts**. See `prisma/seed.ts` for values.

| Role        | Seed email                     | Seeded? | Notes                                                                                      |
| ----------- | ------------------------------ | ------- | ------------------------------------------------------------------------------------------ |
| SUPER_ADMIN | `superadmin@example.com`       | yes     | Password in `prisma/seed.ts`                                                               |
| SUPER_ADMIN | `kurosakiblackangel@gmail.com` | yes     | Auto-promoted via `SUPER_ADMIN_EMAIL` env var; Google OAuth only, no password in QA path   |
| ADMIN       | `admin@example.com`            | yes     | Password in `prisma/seed.ts`                                                               |
| USER        | `user@example.com`             | yes     | Password in `prisma/seed.ts`                                                               |
| QC          | —                              | **NO**  | **Gap.** `QC` enum exists but no seed row. `PUT /api/admin/users/:id/role` only accepts `USER`/`ADMIN`. To test QC, promote manually via direct DB (`UPDATE "User" SET role='QC' WHERE email=...`). |

## Login smoke test — `POST /api/auth/login`

Cookies saved to `qa/2026-04-18/cookies/<role>.txt` (gitignored).

| Role        | HTTP | `Set-Cookie` session? | Response body role claim | Cookie file                  |
| ----------- | ---- | --------------------- | ------------------------ | ---------------------------- |
| SUPER_ADMIN | 200  | yes (HttpOnly, SameSite=Lax, Max-Age=86400) | `SUPER_ADMIN` | `cookies/superadmin.txt` |
| ADMIN       | 200  | yes (HttpOnly, SameSite=Lax, Max-Age=86400) | `ADMIN`       | `cookies/admin.txt`      |
| USER        | 200  | yes (HttpOnly, SameSite=Lax, Max-Age=86400) | `USER`        | `cookies/user.txt`       |
| QC          | —    | SKIPPED (no seed)     | —                        | —                        |

Cookie flags observed: `Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`. No `Secure` flag — acceptable in local dev over http; **flag for production hardening review** (would need HTTPS + `Secure`).

## Protected endpoint smoke — `GET /api/auth/session` with cookie

| Role        | HTTP | Body summary                                                     |
| ----------- | ---- | ---------------------------------------------------------------- |
| SUPER_ADMIN | 200  | `{ user: { id, name: "Super Admin", email, role: "SUPER_ADMIN", blocked: false } }` |
| ADMIN       | 200  | `{ user: { id, name: "Admin", email, role: "ADMIN", blocked: false } }`             |
| USER        | 200  | `{ user: { id, name: "User", email, role: "USER", blocked: false } }`               |

All three cookies are valid and the `/api/auth/session` handler returns the user + role. Cookie-based auth verified end-to-end.

## RBAC sanity — `GET /api/admin/users`

Quick bonus probe to confirm guard is in place (not just that login works).

| Role        | HTTP | Body                                   |
| ----------- | ---- | -------------------------------------- |
| SUPER_ADMIN | 200  | 4 users returned (superadmin, admin, user, kurosaki...) |
| ADMIN       | 403  | `{"error":"Forbidden"}`                |
| USER        | 403  | `{"error":"Forbidden"}`                |

Matches RECON section 3: `/api/admin/*` is equality-gated on `SUPER_ADMIN`. ADMIN is correctly denied, confirming RECON's observation that ADMIN role has almost no unique API privileges.

## Infra health (live verification, sandbox-off)

- **Postgres**: HEALTHY. `GET /api/admin/users` returns 4 DB rows, `GET /api/auth/session` hits `Session` + `User` tables. The "DB offline" claim in the initial RECON was a Bash-sandbox artifact (`bun -e` hitting localhost was blocked), not a real outage.
- **Redis**: presumed healthy — the app boots, `onAfterResponse` hook depends on `appLog()` which writes to Redis, and no 500s observed. Not separately queried in this phase.
- **Counts from DB** (per the assignment context): 4 users, 2 projects, 2 tasks, 6 agents, 6 webhook tokens — consistent with `GET /api/admin/users` returning 4.

## SPA serving — RECON-001 probe

- `GET /` → **200**, `Content-Type: text/html`, valid `<!doctype html>` + Vite HMR client (`/@vite/client`, `/@react-refresh`) + Mantine pre-paint color-scheme script + splash markup.
- Verdict: **UNREPRODUCIBLE** in this session. The previous observation #986 ("API routes functional while SPA frontend serving fails") does not reproduce on commit `e9cc74e` with the currently running dev server.
- BUG REGISTRY updated: `RECON-001` → `UNREPRODUCIBLE`.

## Pass / fail summary

| Check                                               | Result |
| --------------------------------------------------- | ------ |
| Dev server reachable on :3111 (`/health`)           | PASS   |
| SUPER_ADMIN login + session                         | PASS   |
| ADMIN login + session                               | PASS   |
| USER login + session                                | PASS   |
| QC login + session                                  | N/A — seed gap documented |
| RBAC denies non-SUPER_ADMIN on `/api/admin/users`   | PASS   |
| SPA `GET /` returns HTML                            | PASS (RECON-001 unreproducible) |
| DB reachable                                        | PASS (RECON false-blocker corrected) |

## Gaps / follow-ups for later phases

1. **QC role not seeded.** Blocks RBAC matrix row for QC unless a test QC user is provisioned via direct DB update. Decide in Fase 1/2: either add a seed row or document manual promotion step in checklist.
2. **Cookie lacks `Secure` flag.** Fine for localhost, flag for production checklist (CH-5 SECURITY).
3. **No CSRF token observed on login** (relies on `SameSite=Lax`). Flag for CH-5.
4. **No rate limiting on `/api/auth/login`.** Already noted in RECON; verify under brute-force probe in CH-5.
5. **Google OAuth path not exercised** in this phase (requires real browser + live client). Leave for UI phase or skip per automation scope.
