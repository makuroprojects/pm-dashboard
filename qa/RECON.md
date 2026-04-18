# RECON — Project Reconnaissance

Generated: 2026-04-18 oleh AI QA Agent (Claude Opus 4.7)
Last verified: 2026-04-18
Source: analisa otonom dari codebase + environment (read-only)

---

## 1. Tech Stack

| Komponen        | Teknologi                   | Versi              | Catatan                                                |
| --------------- | --------------------------- | ------------------ | ------------------------------------------------------ |
| Runtime         | Bun                         | latest (workspace) | `bun --watch` untuk dev; `bun` runs .ts/.tsx native    |
| HTTP Framework  | Elysia.js                   | ^1.4.28            | App factory `createApp()` di `src/app.ts`              |
| ORM             | Prisma                      | v6                 | Client di-generate ke `./generated/prisma` (gitignore) |
| Database        | PostgreSQL                  | (runtime)          | Via `DATABASE_URL`                                     |
| Cache / Logs    | Redis                       | Bun native         | `Bun.RedisClient`, no npm package                      |
| Auth            | Session cookies (DB) + bcrypt + Google OAuth | custom | `Bun.password.hash/verify`; token UUID      |
| Frontend        | React                       | ^19                | Mantine UI v8, `@mantine/modals`, react-icons          |
| Router (FE)     | TanStack Router             | ^1.168.10          | File-based + `@tanstack/router-vite-plugin`            |
| State           | TanStack React Query        | ^5.95.2            |                                                        |
| Bundler         | Vite                        | ^8.0.3             | `@vitejs/plugin-react` v6, middleware mode in dev      |
| Graph UI        | @xyflow/react               | ^12.10.2           | React Flow untuk dev-console ER & project views        |
| Charts          | echarts + echarts-for-react | ^6.0.0             |                                                        |
| MCP             | @modelcontextprotocol/sdk   | ^1.29.0            | `scripts/mcp/server.ts`, tool modules                  |
| Lint            | @biomejs/biome              | ^2.4.10            | `bun run lint`                                         |
| Tests           | `bun test`                  | built-in           | `tests/unit/` + `tests/integration/`                   |
| TypeScript      | typescript                  | ^6.0.2             | `bun run typecheck`                                    |

**Entry points**
- Server prod: `src/index.tsx` (`bun src/index.tsx`)
- Server dev: `src/serve.ts` (dynamic import workaround) → `src/index.tsx`
- Elysia app factory: `src/app.ts` (`createApp()`) — testable via `app.handle(request)`
- Frontend entry: `src/frontend.tsx` (renders App → MantineProvider + Router)

**Scripts (`package.json`)**

| Script                 | Command                                | Catatan                          |
| ---------------------- | -------------------------------------- | -------------------------------- |
| `bun run dev`          | `bun --watch src/serve.ts`             | Dev server dengan HMR via Vite   |
| `bun run build`        | `vite build`                           | Produksi bundle ke `dist/`       |
| `bun run start`        | `NODE_ENV=production bun src/index.tsx`| Produksi                         |
| `bun run typecheck`    | `tsc --noEmit`                         |                                  |
| `bun run test`         | `bun test`                             | Semua tests                      |
| `bun run test:unit`    | `bun test tests/unit`                  |                                  |
| `bun run test:integration` | `bun test tests/integration`       |                                  |
| `bun run lint`         | `biome check src/`                     |                                  |
| `bun run db:migrate`   | `bunx prisma migrate dev`              |                                  |
| `bun run db:seed`      | `bun run prisma/seed.ts`               | Seed demo user                   |
| `bun run db:studio`    | `bunx prisma studio`                   |                                  |
| `bun run db:generate`  | `bunx prisma generate`                 |                                  |
| `bun run db:push`      | `bunx prisma db push`                  |                                  |

---

## 2. Environment

**Target URL**: `http://localhost:3111` (port dari `.env`, default di `env.ts` = 3000)
**Health check**: `GET /health` → `{ status: "ok" }` (public, no auth)

### Env keys yang relevan (source: `src/lib/env.ts` + `.env.example`)

Required (throws saat boot jika missing):
- `DATABASE_URL` — PostgreSQL URL (local `.env` = `postgresql://bip:***@localhost:5432/pm-dashboard`)
- `REDIS_URL` — default `redis://localhost:6379`
- `GOOGLE_CLIENT_ID` — OAuth
- `GOOGLE_CLIENT_SECRET` — OAuth

Optional:
- `PORT` — default `3000`; local `.env` = `3111`
- `NODE_ENV` — default `development`
- `REACT_EDITOR` — default `code`; local = `zed` (affects Ctrl+Shift+Cmd+C click-to-source)
- `SUPER_ADMIN_EMAIL` — comma-separated emails auto-promoted ke `SUPER_ADMIN` saat login. Local value: `kurosakiblackangel@gmail.com`
- `AUDIT_LOG_RETENTION_DAYS` — default `90`
- `MCP_SECRET` — readonly scope for `/mcp` & local MCP server
- `MCP_SECRET_ADMIN` — admin (write) scope for `/mcp`
- `PMW_WEBHOOK_TOKEN` — fallback shared secret for `/webhooks/aw`
- `PMW_EVENT_BATCH_MAX` — default `500` (413 on overflow)
- `WEBHOOK_LOG_RETENTION_DAYS` — default `7`
- `GITHUB_WEBHOOK_SECRET` — HMAC secret for `/webhooks/github`
- `UPLOADS_DIR` — default `./uploads`
- `UPLOAD_MAX_BYTES` — default `10 MiB` (10 * 1024 * 1024)
- `DIRECT_URL` — Prisma direct URL (same DB)
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` — present in `.env.example` tapi **tidak dibaca** di `env.ts` → legacy / tidak aktif
- `TELEGRAM_NOTIFY_TOKEN`, `TELEGRAM_NOTIFY_CHAT_ID` — present di `.env.example`, tidak dipakai di server code (likely Claude Code notification hook)

### Dev-only endpoints

- `POST /__open-in-editor` — dev inspector open file di editor (`src/index.tsx:206`). Body: `{ relativePath, lineNumber, columnNumber }`. **Hanya aktif bila `NODE_ENV !== 'production'`**.

### Port yang dipakai

- `3111` — server Elysia (API + frontend via Vite middleware in dev)
- `6379` — Redis (from `.env`)
- `5432` — Postgres (from `.env`) — **HEALTHY** (verified Fase 0 2026-04-18)

### Known blockers (untuk Fase 0)

- ~~**PostgreSQL localhost:5432 OFFLINE**~~ — **CORRECTED 2026-04-18 di Fase 0.** Klaim awal bahwa DB offline adalah **artefak sandbox**: Bash tool default sandbox memblok TCP ke localhost, jadi `bun -e "prisma.$queryRaw\`SELECT 1\`"` gagal dengan `P1001 Can't reach database server at localhost:5432` meskipun DB sebenarnya hidup. Diverifikasi via HTTP (sandbox-off): `GET /api/admin/users` mengembalikan 4 user rows, `POST /api/auth/login` sukses untuk `superadmin@example.com`, `admin@example.com`, dan `user@example.com`, `GET /api/auth/session` meng-hydrate session dari `User` + `Session` table. **DB, seed data, dan koneksi semua sehat.** Pelajaran: untuk perintah apa pun yang memanggil localhost (curl :3111, psql, redis-cli, bun script yang pakai Prisma/Redis), gunakan `dangerouslyDisableSandbox: true` sejak percobaan pertama.

---

## 3. Role & Hierarki

**Source**: `prisma/schema.prisma:11-16` → `enum Role { USER  QC  ADMIN  SUPER_ADMIN }` — default `USER`.

| Level | Role           | Deskripsi                                                             | Scope data                                    | Auth method                         |
| ----- | -------------- | --------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| 0     | guest/public   | Belum login                                                           | Hanya public routes (`/`, `/login`, `/health`, webhook endpoints) | tidak ada            |
| 1     | USER           | Default untuk user baru                                               | Profile sendiri, project di mana ia member   | Email/password or Google OAuth      |
| 2     | QC             | Quality control (ref CLAUDE.md: QC-scoped tasks only on `/dashboard`) | Sama seperti USER + visibility QC-scope (belum ada guard kode khusus di `app.ts`; QC kebanyakan dicek di UI) | Email/password or Google OAuth |
| 3     | ADMIN          | Admin umum                                                            | Default route `/admin`. **Tidak** punya akses `/api/admin/*` (itu SUPER_ADMIN only) | Email/password or Google OAuth |
| 4     | SUPER_ADMIN    | Full-access, bypass project membership checks                         | Semua project, semua users, semua dev console | Email/password, Google OAuth, or auto-promote via `SUPER_ADMIN_EMAIL` |

### Hierarki logic (penting!)

Role guards di `src/app.ts` dicek **dengan equality**, BUKAN level. Tidak ada helper `requireRole(min)`. Pola yang dipakai:
- `session.user.role !== 'SUPER_ADMIN'` → 403 (hampir semua `/api/admin/*` endpoints)
- `auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN'` (activity endpoints, WS presence admin flag)
- `auth.role === 'SUPER_ADMIN'` (agents, webhook-tokens, webhooks/stats, webhooks/logs)
- Project-scoped: cek `ProjectMember.role ∈ {OWNER, PM, MEMBER, VIEWER}` dengan guard `if (!membership && auth.role !== 'SUPER_ADMIN')` → SUPER_ADMIN bypass project membership

**Konsekuensi**: ADMIN role HAMPIR tidak punya privileges unik di API — sebagian besar dev-console endpoints SUPER_ADMIN-only. ADMIN cuma bisa lihat `/admin` frontend page. **Flag: cek apakah ini by-design atau gap.**

### Project-scoped role hierarchy (source: `prisma/schema.prisma:30-35`)

`enum ProjectMemberRole { OWNER  PM  MEMBER  VIEWER }`

- Delete project: OWNER only (or SUPER_ADMIN)
- Update project, add/remove members, extend deadline, CRUD milestones, CRUD tags, delete tasks, CRUD dependencies/checklist: OWNER atau PM
- Create/update task, comment, evidence: any role except VIEWER
- View: any member (including VIEWER) + SUPER_ADMIN bypass

### User status flow

- Register: hanya via Google OAuth (`/api/auth/google` → callback auto-upsert sebagai `USER` kecuali email ada di `SUPER_ADMIN_EMAIL`) ATAU via seed. **Tidak ada `/api/auth/register` endpoint.**
- Block: `blocked: Boolean` di `User` model (default `false`). PUT `/api/admin/users/:id/block` oleh SUPER_ADMIN. Saat diblok: semua session user di-delete.
- Frontend: blocked user di-redirect ke `/blocked` dari semua protected route.
- Session expired / deleted → frontend redirect ke `/login`.

---

## 4. Akun Test

**Source**: `prisma/seed.ts` (seeds 3 demo users with `Bun.password.hash` bcrypt).

| Role         | Email                     | Password (lihat `prisma/seed.ts`) | Login via           | Blocked | Status                                                     |
| ------------ | ------------------------- | --------------------------------- | ------------------- | ------- | ---------------------------------------------------------- |
| SUPER_ADMIN  | superadmin@example.com    | see `prisma/seed.ts`              | email+password POST `/api/auth/login` | false | VERIFIED 2026-04-18 (Fase 0) — cookie in `qa/2026-04-18/cookies/superadmin.txt` |
| ADMIN        | admin@example.com         | see `prisma/seed.ts`              | email+password POST `/api/auth/login` | false | VERIFIED 2026-04-18 (Fase 0) — cookie in `qa/2026-04-18/cookies/admin.txt`      |
| USER         | user@example.com          | see `prisma/seed.ts`              | email+password POST `/api/auth/login` | false | VERIFIED 2026-04-18 (Fase 0) — cookie in `qa/2026-04-18/cookies/user.txt`       |
| SUPER_ADMIN  | kurosakiblackangel@gmail.com | via Google OAuth + `SUPER_ADMIN_EMAIL` env | Google OAuth | false | User row present (SUPER_ADMIN); OAuth flow not exercised in Fase 0 |

**Tidak ada user role `QC`** yang di-seed default. Harus dibuat manual (via Prisma Studio atau INSERT DB, atau update role existing user via `PUT /api/admin/users/:id/role` — **namun endpoint ini hanya menerima `USER` atau `ADMIN`**, tidak ada path untuk promote ke `QC` via API. **Flag untuk Fase 0**: kalau perlu test role QC, harus `UPDATE "user" SET role='QC' WHERE email=...` langsung ke DB.

### Cara setup (TO BE verified di Fase 0 setelah DB hidup)

```bash
# 1. Start Postgres (user action)
# 2. Push schema & seed:
bun run db:push     # atau: bunx prisma migrate dev
bun run db:seed
# 3. Verify login:
curl -s -c "$TMPDIR/qa-super.txt" -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@example.com","password":"superadmin123"}' \
  http://localhost:3111/api/auth/login
# 4. Verify session:
curl -s -b "$TMPDIR/qa-super.txt" http://localhost:3111/api/auth/session
```

Catatan session cookie: nama `session`, HttpOnly, value = UUID (`crypto.randomUUID()`), expiry 30 hari (lihat `createSession()` di `app.ts` — belum dibaca detail; TO DO verify di Fase 0).

---

## 5. Tenant Model

- **Multi-tenant**: **TIDAK**. Single-tenant secara arsitektural.
- **Project-scoped**, bukan tenant-scoped — data diisolasi per `Project` via `ProjectMember` m2m. Pattern: setiap endpoint write membaca `ProjectMember.role` via helper `requireProjectMember(projectId, userId)` di `src/app.ts:178`.
- **Isolasi data**: where-clause filter di Prisma queries (`projectId: { in: [...visibleProjectIds] }`). Tidak ada RLS Postgres.
- **Tenant di-resolve via**: URL param `:id` pada `/api/projects/:id/*`, atau body.projectId untuk create task.
- **Cross-tenant roles**: `SUPER_ADMIN` bypass semua project membership checks (`auth.role !== 'SUPER_ADMIN'`).
- **Single-tenant roles**: USER, QC, ADMIN — hanya lihat project di mana jadi owner atau member.

---

## 6. API Endpoints

Total: **144 HTTP handlers + 1 WebSocket (`/ws/presence`) + 1 catch-all MCP (`POST /mcp`)** (dari grep di `src/app.ts`). Enumerasi lengkap di-catalog di `GET /api/admin/routes` (self-documenting endpoint).

### Public (no auth)

| METHOD | Path                       | Fungsi                                                      |
| ------ | -------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                  | Health check `{ status: 'ok' }`                             |
| POST   | `/api/auth/login`          | Email+password login, returns session cookie                |
| POST   | `/api/auth/logout`         | Delete session by cookie                                    |
| GET    | `/api/auth/session`        | Get current session (401 if invalid/expired/blocked)        |
| GET    | `/api/auth/google`         | OAuth redirect to Google                                    |
| GET    | `/api/auth/callback/google`| OAuth callback, upsert user, create session                 |
| GET    | `/api/hello`               | Demo                                                        |
| PUT    | `/api/hello`               | Demo                                                        |
| GET    | `/api/hello/:name`         | Demo                                                        |
| POST   | `/webhooks/aw`             | pm-watch ingestion (auth via Bearer `WebhookToken` SHA-256 or `PMW_WEBHOOK_TOKEN` fallback) |
| POST   | `/webhooks/github`         | GitHub webhook (auth via HMAC SHA-256 signature + `GITHUB_WEBHOOK_SECRET`) |
| ALL    | `/mcp`                     | MCP over HTTP (auth via `MCP_SECRET` readonly / `MCP_SECRET_ADMIN` full) |

### Auth-protected (requires session cookie)

**SUPER_ADMIN-only** (explicit `role !== 'SUPER_ADMIN'` → 403):
- `GET /api/admin/users`, `PUT /api/admin/users/:id/role`, `PUT /api/admin/users/:id/block`
- `GET /api/admin/presence`
- `GET|DELETE /api/admin/logs/app`, `GET|DELETE /api/admin/logs/audit`
- `GET /api/admin/schema`, `GET /api/admin/routes`, `GET /api/admin/project-structure`, `GET /api/admin/env-map`, `GET /api/admin/test-coverage`, `GET /api/admin/dependencies`, `GET /api/admin/migrations`, `GET /api/admin/sessions`
- `GET /api/admin/agents`, `POST /api/admin/agents/:id/approve`, `POST /api/admin/agents/:id/revoke`
- `GET|POST /api/admin/webhook-tokens`, `PATCH|DELETE /api/admin/webhook-tokens/:id`
- `GET /api/admin/webhooks/stats`, `GET /api/admin/webhooks/logs`

**ADMIN+ (ADMIN or SUPER_ADMIN)**:
- `GET /api/activity/agents`, `GET /api/activity`, `GET /api/activity/calendar`, `GET /api/activity/heatmap`, `GET /api/activity/summary` — endpoint non-admin pun boleh lihat data milik sendiri; admin-flag expand scope.

**Any authenticated (project-scoped)**:
- `GET /api/users`
- `GET|POST /api/projects`
- `GET|PATCH|DELETE /api/projects/:id` (PATCH = OWNER/PM; DELETE = OWNER or SUPER_ADMIN)
- `GET /api/projects/:id/github/summary`, `GET /api/projects/:id/github/feed`
- `POST|DELETE /api/projects/:id/members`, `DELETE /api/projects/:id/members/:userId` (OWNER-only for remove)
- `POST /api/projects/:id/extend`, `GET /api/projects/:id/extensions`
- `GET|POST /api/projects/:id/milestones`, `GET /api/milestones`, `PATCH|DELETE /api/milestones/:id` (OWNER/PM)
- `GET|POST /api/projects/:id/tags`, `PATCH|DELETE /api/tags/:id`
- `GET|POST /api/tasks`, `GET|PATCH|DELETE /api/tasks/:id`
- `POST /api/tasks/:id/comments`, `POST /api/tasks/:id/evidence`, `POST /api/tasks/:id/evidence/upload`
- `GET /api/evidence/:file` (file streaming)
- `POST|DELETE /api/tasks/:id/dependencies[/ :blockedById]`
- `POST /api/tasks/:id/checklist`, `PATCH|DELETE /api/checklist/:id`
- `GET /api/me/agents`, `GET /api/me/notifications`, `GET /api/me/notifications/unread-count`, `POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`, `DELETE /api/me/notifications/:id`

### WebSocket

| Path          | Auth               | Event types                                              |
| ------------- | ------------------ | -------------------------------------------------------- |
| `/ws/presence`| cookie session     | Admin subscribers receive online-user list + `{ type: 'request', method, path, status, duration }` from `onAfterResponse` hook |

### Endpoints TANPA auth guard (risiko!) — baca dari kode

- `/webhooks/aw` dan `/webhooks/github` punya auth khusus (bearer token DB / HMAC). Bukan session-based. Secara teknis "public" tapi ada gate.
- `/api/hello*` — demo, truly public no auth. **Tidak berbahaya** (hardcoded response).
- `/mcp` — punya gate `MCP_SECRET` / `MCP_SECRET_ADMIN`. Kalau dua-duanya kosong → 503 "MCP not configured".
- `/__open-in-editor` — dev-only (guarded by `!isProduction`), tapi **tidak ada auth**. Kalau NODE_ENV accidentally set dev di prod, bisa spawn editor. **Low-risk dalam dev, worth flag.**

### Catatan response-timing hook

Semua request ke `/api/*` di-log via `onAfterResponse` + di-broadcast ke admin WS subscribers sebagai `{ type: 'request', ... }`. Bukan guard, tapi berpotensi bocor status/path info ke admin.

---

## 7. Frontend Routes

TanStack Router file-based, di `src/frontend/routes/`. Setiap route punya `beforeLoad` untuk auth gate.

| Path          | Auth guard                                         | Shell/Layout        | Catatan                                                              |
| ------------- | -------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| `/`           | none                                               | Standalone landing  | Shows login CTA or "continue to dashboard" if session                 |
| `/login`      | redirect ke default route kalau sudah login        | Standalone          | Email+password form + Google OAuth button                            |
| `/blocked`    | none (public)                                      | Standalone          | Shown when `user.blocked === true`. Direct logout button.            |
| `/profile`    | `beforeLoad` → `redirect({ to: '/settings' })`     | N/A (redirect)      | Legacy path, always redirects                                        |
| `/dashboard`  | `beforeLoad` → `redirect({ to: '/admin' })`        | N/A (redirect)      | Legacy path, always redirects                                        |
| `/settings`   | session required, not blocked                      | Header + content    | Profile, device list, notification bell, logout. All authed users.  |
| `/pm`         | session required, not blocked                      | AppShell sidebar    | 5 tabs: overview, projects, tasks, activity, team                    |
| `/admin`      | role ∈ {ADMIN, SUPER_ADMIN}                        | AppShell sidebar    | 3 tabs: overview, users, analytics                                   |
| `/dev`        | role === SUPER_ADMIN                               | AppShell sidebar    | 10 tabs: overview, users, agents, webhook-tokens, webhook-monitor, app-logs, user-logs, database, project, settings |

**Default redirect map** (`getDefaultRoute()` di `src/frontend/hooks/useAuth.ts:14`):
- SUPER_ADMIN / ADMIN → `/admin`
- USER / QC → `/pm`

**Discrepancy vs `CLAUDE.md`**: CLAUDE.md mentions `/dashboard` with QC-scoped view but the actual `/dashboard` route is a redirect stub to `/admin`. Real PM work area for non-admin is `/pm`. `/profile` also redirects to `/settings`. **CLAUDE.md is stale**.

---

## 8. Permission System

### Role-level permissions

Tidak ada sub-permission system (no `can()`, `ability`, `hasPermission` helper). Semua gate adalah equality check role string langsung. Ada:
- Global role check (Role enum)
- Project-scoped role check via `ProjectMember.role` (OWNER > PM > MEMBER > VIEWER) — juga equality, bukan hierarki level integer

### Sub-permissions

Tidak ada.

### Feature flags / toggles per tenant

Tidak ada.

---

## 9. Special Mechanisms

### Rate Limiting

**TIDAK ADA** rate limiter yang explicit (grep `rate_limit|throttle` = 0 hits). Satu-satunya cap: `PMW_EVENT_BATCH_MAX=500` per request `/webhooks/aw` (413 on overflow).

### Mode khusus

- **Block mode** — `user.blocked = true` invalidates semua session + redirect ke `/blocked`.
- **Agent revocation** — `Agent.status = REVOKED` → `/webhooks/aw` returns 403 (events preserved).
- **Webhook token status** — `ACTIVE | DISABLED | REVOKED`. DISABLED reversible, REVOKED permanent.
- **Impersonation / sudo**: TIDAK ADA.
- **Maintenance mode**: TIDAK ADA.

### Background jobs (`src/index.tsx`)

- `cleanupAuditLogs` — on boot + every 24h. Deletes `AuditLog` where `createdAt < now - AUDIT_LOG_RETENTION_DAYS` (default 90).
- `cleanupWebhookLogs` — on boot + every 24h. Deletes `WebhookRequestLog` where `createdAt < now - WEBHOOK_LOG_RETENTION_DAYS` (default 7).
- `sweepDueTasks` (`src/lib/notifications.ts:runDueSoonSweep`) — on boot + every 1h. Sweeps tasks due soon / overdue → creates `Notification` rows.

### Real-time / WebSocket

- `WS /ws/presence` — cookie auth. Tracks `in-memory` connection map (`src/lib/presence.ts`). On connect/disconnect broadcasts online user list to admin subscribers. Admin subscribers also receive per-request telemetry (`{ type: 'request' }`).

### Incoming webhooks

- `POST /webhooks/aw` — ActivityWatch agents → `ActivityEvent` rows. Dedupe `(agentId, bucketId, eventId)`. Batch cap 500. Every call logs `WebhookRequestLog`.
- `POST /webhooks/github` — GitHub repo events (HMAC SHA-256 verified). Writes `ProjectGithubEvent` + `GithubWebhookLog`. Matches `githubRepo` on `Project`.

### MCP

- Local MCP registered in `.mcp.json` as `pm-dashboard` (spawns `bun run scripts/mcp/server.ts` with `MCP_SECRET`).
- HTTP fallback `POST /mcp` on same port.
- Tool modules in `scripts/mcp/tools/`: `admin`, `agents`, `code`, `db`, `dev`, `github`, `health`, `logs`, `milestones`, `presence`, `project`, `projects`, `redis`, `shared`, `tasks`, `webhooks`.
- **Per instruksi QA session**: MCP `pm-dashboard` tidak boleh dipakai untuk QA. Playwright MCP registered but not needed in RECON phase.

### File uploads

- `POST /api/tasks/:id/evidence/upload` — multipart, saved under `UPLOADS_DIR` (`./uploads`). Max size `UPLOAD_MAX_BYTES` (10 MiB). Served via `GET /api/evidence/:file`.

---

## 10. Known Issues & Scope

### Bug yang masih open (dari sesi sebelumnya)

Tidak ada sesi QA sebelumnya (folder `qa/` hanya punya `README.md`). Belum ada `BUG REGISTRY` historis.

### Dari observations / CLAUDE.md:
- **2026-04-18 12:32p — "API routes functional while SPA frontend serving fails"** (observation #986). Artinya: endpoint `/api/*` work tapi SPA hang/404 di dev. **Fokus regresi Fase 0**: verify SPA serving dengan Vite middleware mode (lihat `src/index.tsx:serveFrontend`).
- **2026-04-17 10:44p** — webhook request log retention feature recently merged.

### Out of scope (per user instruksi session ini)

- Tidak ada modifikasi kode.
- Tidak start dev server dari RECON (akan start di Fase 0).

### Known limitations / gotchas (dari CLAUDE.md + code reading)

- Prisma client di-generate ke `./generated/prisma` (bukan default `node_modules/@prisma/client`). Import `{ prisma }` dari `src/lib/db.ts`.
- `.env.example` menyebut `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` tapi kode pakai session cookie custom, bukan better-auth. Legacy / unused.
- `TELEGRAM_NOTIFY_*` di `.env` kemungkinan untuk Claude Code notification hook, bukan server.
- Session token format: UUID (`crypto.randomUUID()`) — not JWT.
- No CSRF token — relies on SameSite cookie (TO DO verify flag Strict/Lax di Fase 0).
- Tidak ada rate limiting — login brute-force possible.

### Known blockers (Fase 0 ready-check)

1. ~~**Postgres OFFLINE**~~ **CLEARED 2026-04-18 Fase 0.** DB is healthy; the earlier failure was a sandbox artifact (Bash tool blocks localhost by default). See section 2 and `qa/2026-04-18/SESSION.md`.
2. **Redis** — still not directly probed. Boot succeeds and `onAfterResponse` hook depends on Redis via `appLog`, so it's probably fine, but confirm with `GET /api/admin/logs/app` in Fase 1.
3. **No QC seed user** — still open. `prisma/seed.ts` only seeds `SUPER_ADMIN`, `ADMIN`, `USER`. The role-change API (`PUT /api/admin/users/:id/role`) accepts only `USER`/`ADMIN`, so to test QC you must run a direct DB update (`UPDATE "User" SET role='QC' WHERE email=...`). Consider filing this as a product gap.
4. **Google OAuth** — requires live `GOOGLE_CLIENT_ID/SECRET` + correct redirect URI configured at Google. Not bookmark-able in automation; prefer email+password login for test. Not exercised in Fase 0.
5. ~~**SPA serving regression**~~ **CLEARED 2026-04-18 Fase 0.** `GET /` returns 200 with a valid HTML shell (Vite dev client + Mantine pre-paint + splash). See `RECON-001` in BUG REGISTRY.

---

## 11. BUG REGISTRY — Fingerprint Lintas Sesi

Fingerprint dedup lintas-sesi. Format: `[ID] [SEVERITY] [STATUS] fingerprint — ringkasan (sesi asal → sesi verifikasi)`

### Active (OPEN / REOPENED) — sinced di `qa/2026-04-18/04_REPORT.md`

**P0 (ship-blockers for public deploy)** — all 7 CLOSED 2026-04-18 Fase 5 (see `qa/2026-04-18/05_VERIFICATION.md`)
- `[BUG-001] [P0] [FIXED 2026-04-18]` — `PATCH /api/admin/webhook-tokens/:id` leaks `tokenHash` in response body
- `[BUG-002] [P0] [FIXED 2026-04-18]` — `/webhooks/aw` ingests events from PENDING agents (approve-gate not enforced)
- `[BUG-003] [P0] [FIXED 2026-04-18]` — GitHub `push` webhook re-delivery inserts duplicate `ProjectGithubEvent` rows (NULL-distinct unique index)
- `[BUG-004] [P0] [FIXED 2026-04-18]` — `POST /api/auth/login` with empty body → 500
- `[BUG-005] [P0] [FIXED 2026-04-18]` — `GET /api/tasks?status=INVALID` → 500
- `[BUG-006] [P0] [FIXED 2026-04-18]` — `POST /api/tasks` with unknown `tagIds` → 500
- `[BUG-007] [P0] [FIXED 2026-04-18]` — Login page embeds seed credentials (superadmin/admin/user) in DOM

**HIGH**
- `[BUG-008] [HIGH] [FIXED 2026-04-18]` — `getDefaultRoute()` drifts from docs — CLAUDE.md updated to match code
- `[BUG-009] [HIGH] [OPEN 2026-04-18]` — Admin Console is a stub (all 3 tabs show "Coming in Phase 2") — deferred (requires feature work)
- `[BUG-010] [HIGH] [FIXED 2026-04-18]` — `POST /api/admin/agents/:id/approve` with unknown id → 500

**MED / LOW** — see `qa/2026-04-18/04_REPORT.md` §3 for BUG-011 … BUG-028 (18 more). Closed in Fase 6: BUG-011, BUG-012, BUG-013, BUG-014, BUG-015, BUG-016, BUG-017, BUG-018, BUG-019, BUG-020, BUG-021, BUG-022, BUG-023, BUG-024, BUG-025, BUG-026, BUG-027, BUG-028 (all 18). Only BUG-009 (feature work) remains open.

### Unreproducible / cannot reproduce

- `[RECON-001] [UNKNOWN] [UNREPRODUCIBLE 2026-04-18 Fase 0] spa_serving:fails_in_dev:vite_middleware` — Observation #986 (2026-04-18 12:32p) noted "API routes functional while SPA frontend serving fails". Re-probed in Fase 0 on commit `e9cc74e`: `curl http://localhost:3111/` → `HTTP 200`, `Content-Type: text/html`, returns valid `<!doctype html>` with `/@vite/client` + `/@react-refresh` injected, Mantine pre-paint script, splash markup. SPA serving works. If regression returns, reopen with exact repro (URL, headers, output) before declaring OPEN.

### Fase 0 cross-cutting findings (NEW, non-bug)

- `[FASE0-001] [INFO] [NOTED] gitignore:missing:qa_session_cookies` — `qa/*/cookies/` was not gitignored; could have leaked live session tokens. Fixed in Fase 0: added `qa/*/cookies/` to `.gitignore`.
- `[FASE0-002] [LOW] [OPEN] seed:missing:qc_role` — `prisma/seed.ts` seeds `USER`/`ADMIN`/`SUPER_ADMIN` only. `QC` enum exists in schema and has UI affordances (per CLAUDE.md) but no seed row, and `PUT /api/admin/users/:id/role` rejects `QC`. Testing QC requires direct DB `UPDATE`. Likely product gap. File in Fase 3 if confirmed.
- `[FASE0-003] [LOW] [OPEN] cookie:no_secure_flag_on_login` — `Set-Cookie: session=...; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`. No `Secure` flag. Acceptable on localhost http; verify HTTPS/prod path adds `Secure`. Parked for CH-5 SECURITY.
- `[FASE0-004] [INFO] [NOTED] recon:false_blocker:postgres_offline_was_sandbox_artifact` — Initial RECON declared Postgres offline due to `bun -e` under sandboxed Bash failing with `P1001`. DB was always up; this was a tooling/sandbox constraint, not infra. RECON corrected.

### Fixed (verified)

**2026-04-18 Fase 5 — all 7 P0 bugs closed** (evidence: `qa/2026-04-18/05_VERIFICATION.md`)

- `[BUG-001]` fixed in `src/app.ts` PATCH webhook-tokens — response now uses same filtered shape as list; `tokenHash` / raw `createdById` never returned. Verified via curl: response includes only `id, name, tokenPrefix, status, expiresAt, lastUsedAt, createdBy{}, createdAt`.
- `[BUG-002]` fixed in `src/app.ts` `/webhooks/aw` — added PENDING-status gate. Returns `202 {ok:true, inserted:0, skipped:N, reason:'agent_pending'}`. Integration test rewritten to assert correct behavior.
- `[BUG-003]` fixed in `src/app.ts` GitHub webhook — pre-query dedupe on `(projectId, kind='PUSH_COMMIT', sha)` to work around Postgres NULL-distinct unique index. Replay verified: 1st `inserted:1`, 2nd `inserted:0`.
- `[BUG-004]` fixed in `src/app.ts` `/api/auth/login` — try/catch around `request.json()` + explicit email/password string validation. 500→400 with Indonesian error.
- `[BUG-005]` fixed in `src/app.ts` `/api/tasks` — `TASK_STATUS_VALUES` / `TASK_KIND_VALUES` enum whitelists, returns 400 with enumerated list.
- `[BUG-006]` fixed in `src/app.ts` `POST /api/tasks` — pre-check `prisma.tag.findMany` on `tagIds`, 400 on mismatch.
- `[BUG-007]` fixed in `src/frontend/routes/login.tsx` — seed-creds `<Text>` now gated behind `{import.meta.env.DEV && (...)}`. Vite eliminates the block in prod builds via dead-code elimination.

**2026-04-18 Fase 6 — HIGH + MED tranche** (evidence: `qa/2026-04-18/06_VERIFICATION.md`)

- `[BUG-008]` fixed in `CLAUDE.md` — role-routing table now matches actual `getDefaultRoute()` (SUPER_ADMIN/ADMIN → `/admin`; QC/USER → `/pm`; legacy `/dashboard` and `/profile` noted as redirect stubs).
- `[BUG-010]` fixed in `src/app.ts` — agent approve/revoke handlers now `findUnique` before `update`, returning 404 instead of 500 on unknown id.
- `[BUG-011]` already fixed by BUG-001 work — PATCH accepts rename-only payload (both `status` and `name` optional, at least one required).
- `[BUG-014]` fixed in `src/app.ts` — DELETE webhook-token now `findUnique` before `delete`, eliminating P2025 prisma stderr noise during test run.
- `[BUG-016]` non-issue — `DIRECT_URL` was already present in `.env.example`.
- `[BUG-017]` fixed in `src/app.ts` `/api/admin/env-map` — added 8 missing entries (MCP_SECRET, MCP_SECRET_ADMIN, PMW_WEBHOOK_TOKEN, PMW_EVENT_BATCH_MAX, GITHUB_WEBHOOK_SECRET, UPLOADS_DIR, UPLOAD_MAX_BYTES, DIRECT_URL). Live probe: `present (8/8)`.
- `[BUG-018]` fixed in `src/app.ts` `/api/admin/routes` — added 7 missing entries (POST `/webhooks/github`, POST `/mcp`, GET `/api/evidence/:file`, GET `/api/projects/:id/github/summary`, GET `/api/projects/:id/github/feed`, POST `/api/tasks/:id/evidence/upload`, DELETE `/api/tasks/:id`).
- `[BUG-019]` fixed in `src/app.ts` `POST /api/tasks/:id/dependencies` — added BFS cycle-check walking `blockedById` edges from the proposed blocker; 400 with "would create a cycle" if the reverse path reaches the task. Live probe: A→B OK, B→A blocked.
- `[BUG-020]` fixed in `src/app.ts` — in-memory IP-keyed throttle on `/api/auth/login`: 10 failed attempts per 15-minute window → 429 with Indonesian message. Cleared on successful login. Live probe: attempts 1-10 returned 401, attempts 11-12 returned 429.
- `[BUG-025]` fixed in earlier RECON edit — STOP GATE entry corrected from "144 handlers" to "82 HTTP handlers + 1 WS".
- `[BUG-026]` fixed in `src/app.ts` — implemented `DELETE /api/tasks/:id` with OWNER/PM/SUPER_ADMIN guard (matches what CLAUDE.md documented); also added a routes-meta entry. Live probe: 200 for owned task, 404 for unknown id.

### Won't fix / by-design

(kosong — sesi pertama)

---

## 12. Gotcha & Tips

- **Prisma client path** — import dari `src/lib/db.ts` (`{ prisma }`), bukan `@prisma/client`. Generated output di `generated/prisma/`.
- **Port 3111**, bukan 3000 — cek `.env` dulu sebelum curl ke `:3000`.
- **`SUPER_ADMIN_EMAIL`** auto-promotes user ke SUPER_ADMIN saat login (keduanya lokal & Google OAuth). Kalau seed user di-login dengan email yang ada di env var ini, role USER akan naik jadi SUPER_ADMIN otomatis.
- **Role `QC`** tidak punya seed default. Harus di-set via direct DB update.
- **DELETE project**: only OWNER or SUPER_ADMIN. PM tidak bisa hapus project.
- **Transisi task status** dicek di helper `getAllowedTaskTransitions()` di `app.ts:35-54`. Different rules untuk `TASK` vs `BUG/QC`. Catat ini saat test task workflow.
- **Evidence upload** → lihat `UPLOAD_MAX_BYTES` sebelum test boundary. Default 10 MiB.
- **pm-watch webhook** — kalau `PMW_WEBHOOK_TOKEN` kosong dan tidak ada DB token, endpoint return 503. Jangan lupa buat token lewat `POST /api/admin/webhook-tokens` dulu.
- **Git status saat RECON**: working tree dirty (M `.env.example`, `package.json`, `prisma/schema.prisma`, `src/app.ts`, `src/frontend/routes/dev.tsx`, `src/index.tsx`, `src/lib/env.ts`; new `src/frontend/components/AgentsPanel.tsx` + `tests/integration/webhooks-aw.test.ts`). Hati-hati kalau perlu build fresh artifact — mungkin commit dulu.
- **CLAUDE.md agak stale** — menyebut `/dashboard` dan `/profile` sebagai halaman aktif, tapi di kode keduanya di-redirect. Trust the code.
- **No migrations folder** — hanya ada `prisma/migrations/migration_lock.toml`. Project pakai `prisma db push` (schema-first), bukan migration-based workflow. Artinya "migrations timeline" endpoint akan kosong sampai migrasi dibuat.

---

## RECON — STOP GATE

- [x] Tech stack teridentifikasi (Bun, Elysia, Prisma v6, React 19, TanStack, Vite 8)
- [x] Environment lengkap (PORT=3111, DB/Redis URL, OAuth keys, scripts)
- [x] SEMUA role teridentifikasi dari kode (4: USER, QC, ADMIN, SUPER_ADMIN + project-roles OWNER/PM/MEMBER/VIEWER)
- [x] Hierarki role dipahami (equality checks, no min-level; project-scope via ProjectMember)
- [x] Akun test tersedia dan VERIFIED LOGIN untuk 3 dari 4 role (SUPER_ADMIN, ADMIN, USER) — Fase 0 2026-04-18 via `POST /api/auth/login` + `GET /api/auth/session`. QC role belum ada seed dan `PUT /api/admin/users/:id/role` tidak menerima nilai QC, jadi butuh direct DB update sebelum bisa ditest. Tracked as `FASE0-002`.
- [x] Tenant model dipahami (single-tenant, project-scoped isolation, no RLS)
- [x] API endpoints ter-enumerate — 82 HTTP handlers + 1 WS in `src/app.ts` (prior "~144" claim was an overcount; corrected via `01_SITEMAP.md` Fase 1)
- [x] Frontend routes ter-enumerate (10 routes, 2 redirect stubs)
- [x] Permission system dipahami (role equality + ProjectMember, no sub-perms)
- [x] Special mechanisms tercatat (no rate limit, block mode, 3 cron jobs, WS presence, 2 webhooks, MCP)
- [x] Bug registry — kosong (sesi pertama), tapi 1 hypothesis terbawa dari observation #986
- [x] RECON.md sudah ditulis lengkap
- [x] Tidak ada placeholder "isi nanti" yang belum di-tag UNKNOWN
