Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Server

Elysia.js as the HTTP framework, running on Bun. API routes are in `src/app.ts` (exported as `createApp()`), frontend serving and dev tools are in `src/index.tsx`.

- `src/app.ts` — Elysia app factory with all API routes (auth, admin, logs, presence, hello, health, Google OAuth). Testable via `app.handle(request)`.
- `src/index.tsx` — Server entry. Adds Vite middleware (dev) or static file serving (prod), click-to-source editor integration, audit log rotation, and `.listen()`.
- `src/serve.ts` — Dev entry (`bun --watch src/serve.ts`). Dynamic import workaround for Bun EADDRINUSE race.

## Database

PostgreSQL via Prisma v6. Client generated to `./generated/prisma` (gitignored).

- Schema: `prisma/schema.prisma`
  - `User` (id, name, email, password, role, blocked, timestamps)
  - `Session` (id, token, userId, expiresAt)
  - `AuditLog` (id, userId, action, detail, ip, createdAt)
  - `Agent` (id, agentId, hostname, osUser, status, claimedById, lastSeenAt, timestamps) — pm-watch ActivityWatch ingestion agent
  - `ActivityEvent` (id, agentId, bucketId, eventId, timestamp, duration, data, createdAt) — raw AW events, unique per (agentId, bucketId, eventId)
  - `WebhookToken` (id, name, tokenHash, tokenPrefix, status, expiresAt, lastUsedAt, createdById, timestamps) — DB-backed webhook auth tokens
  - `WebhookRequestLog` (id, tokenId?, agentId?, statusCode, reason, ip, eventsIn, createdAt) — audit trail for `/webhooks/aw`
  - `Project` (id, name, description, ownerId, status, priority, startsAt, endsAt, originalEndAt, archivedAt, githubRepo?, timestamps) — `githubRepo` unique, normalized `owner/repo`
  - `ProjectGithubEvent` (id, projectId, kind, actorLogin, actorEmail?, matchedUserId?, title, url, sha?, prNumber?, metadata?, createdAt, ingestedAt) — unique per (projectId, kind, sha, prNumber)
  - `GithubWebhookLog` (id, projectId?, deliveryId?, event, statusCode, reason?, ip?, eventsIn, createdAt) — audit trail for `/webhooks/github`
  - `ProjectMember` (projectId, userId, role) — unique per (projectId, userId)
  - `ProjectMilestone`, `ProjectExtension` — planning + audited deadline pushes
  - `Task` (id, projectId, kind, title, description, status, priority, route?, reporterId, assigneeId?, startsAt?, dueAt?, estimateHours?, progressPercent?, closedAt?, timestamps)
  - `Tag` (id, projectId, name, color) — unique per (projectId, name)
  - `TaskTag` — m2m between Task and Tag
  - `TaskDependency` (id, taskId, blockedById) — self-relation on Task via named relations `TaskDependents`/`TaskBlockers`; unique per (taskId, blockedById)
  - `TaskChecklistItem` (id, taskId, title, done, order, timestamps)
  - `TaskStatusChange` (id, taskId, authorId?, fromStatus, toStatus, createdAt) — written by PATCH /api/tasks/:id whenever status changes, used by activity timeline
  - `TaskComment`, `TaskEvidence` — comments + attachments on tasks
- Enums: `Role` = `USER | QC | ADMIN | SUPER_ADMIN` (default `USER`); `TaskKind` = `TASK | BUG | QC`; `TaskStatus` = `OPEN | IN_PROGRESS | READY_FOR_QC | REOPENED | CLOSED`; `TaskPriority` = `LOW | MEDIUM | HIGH | CRITICAL`; `AgentStatus` = `PENDING | APPROVED | REVOKED`; `WebhookTokenStatus` = `ACTIVE | DISABLED | REVOKED`; `GithubEventKind` = `PUSH_COMMIT | PR_OPENED | PR_CLOSED | PR_MERGED | PR_REVIEWED`
- Client singleton: `src/lib/db.ts` — import `{ prisma }` from here
- Seed: `prisma/seed.ts` — demo users (superadmin, admin, user) with `Bun.password.hash` bcrypt
- Commands: `bun run db:migrate`, `bun run db:seed`, `bun run db:generate`

## Redis

Bun native `Bun.RedisClient` — no external package needed.

- Client singleton: `src/lib/redis.ts` — connects to `REDIS_URL`
- App logs: stored as Redis List (`app:logs`), max 500 entries via `LTRIM`, persists across restart
- App log module: `src/lib/applog.ts` — `appLog(level, message, detail?)`, `getAppLogs(options?)`, `clearAppLogs()`

## Auth

Session-based auth with HttpOnly cookies stored in DB.

- Login: `POST /api/auth/login` — finds user by email, verifies password with `Bun.password.verify`, checks blocked status, creates Session record. Logs to audit trail.
- Google OAuth: `GET /api/auth/google` → Google → `GET /api/auth/callback/google` — upserts user, creates session
- Session: `GET /api/auth/session` — looks up session by cookie token, returns user (including role & blocked) or 401, auto-deletes expired
- Logout: `POST /api/auth/logout` — deletes session from DB, clears cookie
- Blocked users: login returns 403, existing sessions are invalidated on block, frontend redirects to `/blocked`

## Admin API (SUPER_ADMIN only)

- `GET /api/admin/users` — list all users with role, blocked status, createdAt
- `PUT /api/admin/users/:id/role` — change role to USER or ADMIN (cannot change self or to SUPER_ADMIN)
- `PUT /api/admin/users/:id/block` — block/unblock user (deletes all sessions on block)
- `GET /api/admin/presence` — list online user IDs
- `GET /api/admin/logs/app` — app logs from Redis (filter: level, limit, afterId)
- `GET /api/admin/logs/audit` — audit logs from DB (filter: userId, action, limit)
- `DELETE /api/admin/logs/app` — clear all app logs from Redis
- `DELETE /api/admin/logs/audit` — clear all audit logs from DB
- `GET /api/admin/routes` — all routes metadata (method, path, auth level, category, description) with summary stats
- `GET /api/admin/project-structure` — scans `src/`, `prisma/`, `tests/` — returns files with line counts, exports, imports, categories + directory tree
- `GET /api/admin/env-map` — environment variables with set/unset status, required/optional, default values, consuming files
- `GET /api/admin/test-coverage` — source files + test files mapping, coverage status (covered/partial/uncovered)
- `GET /api/admin/dependencies` — NPM packages from package.json with version, type (runtime/dev), category, importing files
- `GET /api/admin/migrations` — Prisma migration timeline with parsed SQL changes and date info
- `GET /api/admin/sessions` — all active sessions with user info, online status, expiry, role breakdown
- `GET /api/admin/agents` — list pm-watch agents with claimedBy user + event counts
- `POST /api/admin/agents/:id/approve` — approve PENDING agent and assign to a user
- `POST /api/admin/agents/:id/revoke` — revoke APPROVED agent (events preserved, reversible)
- `GET /api/admin/webhook-tokens` — list webhook tokens (hashes never returned)
- `POST /api/admin/webhook-tokens` — create token (plaintext returned **once** only)
- `PATCH /api/admin/webhook-tokens/:id` — toggle ACTIVE/DISABLED or rename
- `POST /api/admin/webhook-tokens/:id/revoke` — permanently revoke token
- `GET /api/admin/webhooks/stats` — aggregate stats (24h + 7d windows): total/success/fail/auth-fail/events, perToken, perAgent
- `GET /api/admin/webhooks/logs?status=all|ok|fail|auth&limit=N` — recent webhook request logs with token/agent relations

## pm-watch Integration

ActivityWatch agents push events to `/webhooks/aw` → events land in `ActivityEvent` table, attributed to the user assigned to the `Agent`.

- **Webhook endpoint**: `POST /webhooks/aw` — accepts `{ agentId, hostname, osUser, events: [{ bucketId, eventId, timestamp, duration, data }] }`. Upserts agent on first contact (status `PENDING`). Rejects events until approved. Deduped via unique `(agentId, bucketId, eventId)`.
- **Batch cap**: `PMW_EVENT_BATCH_MAX` (default 500) — returns 413 on overflow
- **Auth**: DB-backed `WebhookToken` (SHA-256 hash). Falls back to `PMW_WEBHOOK_TOKEN` env var when no DB tokens are active. Revoked/expired/disabled tokens → 403 with reason.
- **Token lifecycle**: create → plaintext shown ONCE → store in agent config. Toggle ACTIVE/DISABLED anytime. Revoke is permanent.
- **Request logging**: every call (success or failure) writes a `WebhookRequestLog` row with `tokenId`, `agentId`, `statusCode`, `reason`, `eventsIn`. Retention `WEBHOOK_LOG_RETENTION_DAYS` (default 7), auto-cleanup on startup + every 24h.
- **Helpers**: `src/lib/webhook-tokens.ts` — `hashToken()`, `verifyToken()`, `generateToken()` (`whk_` prefix + random hex). Verify result includes `tokenId` on failure for attribution.

### Frontend pm-watch panels

- `src/frontend/components/AgentsPanel.tsx` — agent approval dashboard. Stats cards (pending/live/offline/events ingested), pending-approval alert banner, live-indicator dots (teal+pulse <5m, green <1h, gray stale, red revoked), inline Approve CTA on PENDING rows, approve modal with info card + user Select (confirm button disabled until user picked), revoke modal with consequences list, agent-ID tooltip + copy. Auto-refresh 15s.
- `src/frontend/components/WebhookTokensPanel.tsx` — token CRUD with show-once creation flow, expiry presets (never/7d/30d/90d/1yr).
- `src/frontend/components/WebhookMonitorPanel.tsx` — webhook activity monitor. 5 summary cards (requests/success+rate/failures/auth-fails/events over 24h), top tokens + top agents tables, recent-requests table with All/Success/Failures/Auth-fails filter. Auto-refresh 10s.

All three mount as `/dev` sidebar tabs (`Agents`, `Webhook Tokens`, `Webhook Monitor`).

## GitHub Integration

Projects can be linked 1:1 to a GitHub repo via `Project.githubRepo` (stored canonical `owner/repo`). GitHub pushes/PRs/reviews flow in via webhook and are surfaced as project-level activity without requiring commit-message conventions.

- **Schema**:
  - `Project.githubRepo String? @unique` — normalized `owner/repo`, null until linked.
  - `ProjectGithubEvent` (id, projectId, kind, actorLogin, actorEmail?, matchedUserId?, title, url, sha?, prNumber?, metadata?, createdAt, ingestedAt). Unique on `(projectId, kind, sha, prNumber)` for dedup across webhook redeliveries.
  - `GithubWebhookLog` (id, projectId?, deliveryId?, event, statusCode, reason?, ip?, eventsIn, createdAt) — audit trail.
  - Enum `GithubEventKind = PUSH_COMMIT | PR_OPENED | PR_CLOSED | PR_MERGED | PR_REVIEWED`.
- **Webhook endpoint**: `POST /webhooks/github` — HMAC-SHA256 verified via `X-Hub-Signature-256` against `GITHUB_WEBHOOK_SECRET` (shared across all repos). `ping` → 200 pong. `push` → one `PUSH_COMMIT` per commit. `pull_request` → `PR_OPENED` / `PR_CLOSED` / `PR_MERGED` depending on action+merged. `pull_request_review` → `PR_REVIEWED`. 404 if repo not linked to any project. Returns `{ ok, event, received, inserted }`.
- **User attribution**: commit author `email` is matched to `User.email` → `ProjectGithubEvent.matchedUserId` populated on insert (batch query). Null otherwise.
- **Open PR derivation**: GitHub doesn't send "still open" events, so open PR count = set-difference of `PR_OPENED.prNumber` minus union of `PR_CLOSED.prNumber` + `PR_MERGED.prNumber`.
- **Helpers**: `src/lib/github.ts` — `normalizeGithubRepo(input)` (accepts https URL, git SSH, `owner/repo`, with/without `.git`), `verifyGithubSignature(rawBody, header, secret)` (timing-safe).
- **API**:
  - `PATCH /api/projects/:id` accepts `githubRepo` (normalized server-side). `null` to unlink. 409 on duplicate link to another project.
  - `GET /api/projects/:id/github/summary` — `{ linked, repo, stats: { commits7d, commits30d, contributors30d, openPrs, lastPushAt, lastPushBy }, contributors, openPrs, recent }`.
  - `GET /api/projects/:id/github/feed?limit=N&kind=X` — paginated events with `matchedUser` joined.
- **Frontend**:
  - Settings tab (`ProjectDetailView.tsx` → `GithubIntegrationCard`) — repo URL input with normalize preview, link/update/unlink buttons, webhook setup hint (endpoint URL + `Copy URL` + direct link to `Settings/hooks/new`).
  - Overview tab (`GithubActivityCard`) — 4 mini-stats (commits/7d, contributors/30d, open PRs, last push) + latest 10 events with per-kind badge colors. Empty state when repo not linked.

## MCP Server

Local MCP server lets Claude drive the app remotely. `.mcp.json` registers `pm-dashboard` (runs `scripts/mcp/server.ts`) alongside `playwright`. Requires `MCP_SECRET`; `MCP_SECRET_ADMIN` unlocks write/dev tools.

- Entry: `scripts/mcp/server.ts` + `scripts/mcp/test-client.ts`
- Tool modules (`scripts/mcp/tools/`): `admin`, `agents`, `code`, `db`, `dev`, `github`, `health`, `logs`, `milestones`, `overview`, `presence`, `project`, `projects`, `redis`, `tasks`, `webhooks` (16 modules, 75 tools). `shared.ts` is a helper, not a tool module.
- Agent tools: `agent_list`, `agent_get` (readonly); `agent_approve`, `agent_revoke`, `agent_reassign` (admin)
- Webhook tools: `webhook_token_list`, `webhook_stats`, `webhook_logs` (readonly); `webhook_token_create` (returns plaintext once), `webhook_token_toggle`, `webhook_token_revoke` (admin)
- GitHub tools (readonly): `github_summary`, `github_feed`, `github_webhook_logs` — all accept project id, name, or `owner/repo`
- Overview tools (readonly): `admin_overview` (KPIs across users/projects/tasks/agents/webhooks), `project_health` (per-project score A-F from overdue/blocked/extensions/velocity), `team_load` (per-user open/overdue/estimated hours, flags overloaded), `risk_report` (overdue tasks + stale IN_PROGRESS + past-due projects + pending agents + offline agents + missing env, severity rolled up)
- HTTP fallback: `POST /mcp` — readonly with `MCP_SECRET`, full with `MCP_SECRET_ADMIN`

## WebSocket

- `WS /ws/presence` — real-time user presence. Authenticates via session cookie. Tracks connections in-memory (`src/lib/presence.ts`). Broadcasts online user list to admin subscribers on connect/disconnect.

## Logging

Two log systems:

- **App Logs** (`src/lib/applog.ts`) — Redis-backed ring buffer (500 entries). Logs API requests (via `onAfterResponse` hook), errors, auth events. Auto-rotates via `LTRIM`. Can be cleared manually.
- **Audit Logs** (DB `AuditLog` table) — Persistent user activity trail. Actions: `LOGIN`, `LOGOUT`, `LOGIN_FAILED`, `LOGIN_BLOCKED`, `ROLE_CHANGED`, `BLOCKED`, `UNBLOCKED`. Auto-cleanup of records older than `AUDIT_LOG_RETENTION_DAYS` (default 90) runs on startup + every 24h. Can be cleared manually.
- **Webhook Request Logs** (DB `WebhookRequestLog` table) — Audit trail for `/webhooks/aw`. Every request logs `tokenId`, `agentId`, `statusCode`, `reason`, `eventsIn`, `ip`. Auto-cleanup of records older than `WEBHOOK_LOG_RETENTION_DAYS` (default 7) on startup + every 24h.
- **Pagination** — Dev Console App Logs and User Logs use client-side pagination (25 per page). Avoids rendering hundreds of rows while polling every 5s. Page resets on filter change.

## Role-Based Routing

| Role | Default Route | Can Access |
|------|--------------|------------|
| SUPER_ADMIN | `/admin` | `/dev`, `/admin`, `/pm`, `/settings` |
| ADMIN | `/admin` | `/admin`, `/pm`, `/settings` |
| QC | `/pm` | `/pm` (QC-scoped tasks), `/settings` |
| USER | `/pm` | `/pm`, `/settings` |

- `getDefaultRoute(role)` in `src/frontend/hooks/useAuth.ts` — centralized redirect logic (SUPER_ADMIN/ADMIN → `/admin`; QC/USER → `/pm`)
- Legacy paths `/dashboard` and `/profile` exist as redirect stubs (→ `/admin` and `/settings` respectively)
- Blocked users are redirected to `/blocked` from all protected routes
- Tab state persisted in URL search params (`?tab=`) for `/dev`, `/admin`, and `/pm`

## Frontend

React 19 + Vite 8 (middleware mode in dev). File-based routing with TanStack Router.

- Entry: `src/frontend.tsx` — renders App, removes splash screen, DevInspector in dev
- App: `src/frontend/App.tsx` — MantineProvider (auto color scheme), ModalsProvider (`@mantine/modals`), QueryClientProvider, RouterProvider
- Routes: `src/frontend/routes/`
  - `__root.tsx` — Root layout (renders Outlet only, no floating UI)
  - `index.tsx` — Landing page (theme toggle top-right)
  - `login.tsx` — Login page (email/password + Google OAuth, theme toggle top-right)
  - `dev.tsx` — Dev console with AppShell sidebar (SUPER_ADMIN only): Overview, Users, Agents, Webhook Tokens, Webhook Monitor, App Logs, User Logs, Database (React Flow ER diagram), Project (10 sub-views — all React Flow with auto-save)
  - `admin.tsx` — Admin console (ADMIN + SUPER_ADMIN) — overview, users, analytics tabs
  - `pm.tsx` — Project management shell (all authenticated users) — overview, projects, tasks, activity, team tabs
  - `settings.tsx` — Profile/device/notification settings (all authenticated users)
  - `dashboard.tsx` — Legacy redirect stub → `/admin`
  - `profile.tsx` — Legacy redirect stub → `/settings`
  - `blocked.tsx` — Blocked user page with explanation (theme toggle top-right)
- Components: `src/frontend/components/`
  - `ThemeToggle.tsx` — Shared dark/light mode toggle button (used across all pages)
  - `NotFound.tsx` — 404 page
  - `ErrorPage.tsx` — Error boundary page
- Auth hooks: `src/frontend/hooks/useAuth.ts` — `useSession()`, `useLogin()`, `useLogout()`, `getDefaultRoute()`
- Presence hook: `src/frontend/hooks/usePresence.ts` — WebSocket auto-connect, exposes `onlineUserIds`
- UI: Mantine v8 + `@mantine/modals` (dark/light, auto default from device), react-icons, AppShell layout for dashboard pages
- Sidebar: Collapsible (260px expanded → 60px icon-only minimized with tooltips). State persisted in `localStorage`. Both dev and dashboard use same pattern.
- Logout: Confirm modal via `@mantine/modals` (`modals.openConfirmModal`) on dev, dashboard, and profile pages. Blocked page logs out directly (no confirm).
- Color scheme: `index.html` reads `localStorage` before first paint to prevent flash. Toggle integrated per-page (sidebar footer on AppShell pages, top-right on standalone pages). Persisted by Mantine in `localStorage`.

## Database Schema Visualization

- Dev Console Database tab renders an interactive ER diagram using `@xyflow/react` (React Flow)
- `GET /api/admin/schema` parses `prisma/schema.prisma` into models/fields/relations/enums JSON via `parseSchema()` in `src/app.ts`
- Custom node types: `ModelNode` (table fields with types/attributes) and `EnumNode` (enum values)
- Auto-save to `localStorage`: node positions (`dev:schema:positions`) and viewport/zoom (`dev:schema:viewport`) — debounced 500ms
- On reload, restores last positions and viewport. Falls back to grid layout + fitView if no saved state.

## Project Structure Visualization

- Dev Console Project tab — 10 sub-views switchable via grouped Select dropdown:
  - **Architecture group:**
    - **API Routes**: `GET /api/admin/routes` — all HTTP + WS + frontend routes with method/auth/category badges. Edges show login→redirect flow.
    - **File Structure**: `GET /api/admin/project-structure` — file nodes with import dependency edges. Filter by category. Double-click opens file in editor.
    - **User Flow**: Static — role-based navigation: landing → login → auth → blocked check → role check → destination.
    - **Data Flow**: Static — request lifecycle: client → Elysia → auth → handler → DB/Redis → response. WS + audit flows.
  - **DevOps group:**
    - **Env Variables**: `GET /api/admin/env-map` — env vars with set/unset status, required/optional badges, edges to consuming files.
    - **Test Coverage**: `GET /api/admin/test-coverage` — source files (green/yellow/red coverage) with edges to test files. Filter by coverage status.
    - **Dependencies**: `GET /api/admin/dependencies` — NPM packages by category/type with edges to importing files.
    - **Migrations**: `GET /api/admin/migrations` — horizontal timeline of Prisma migrations with SQL preview and change type badges.
  - **Live group:**
    - **Sessions**: `GET /api/admin/sessions` — active user sessions with online indicator, role mapping. Auto-refresh 10s.
    - **Live Requests**: Real-time API requests via WS broadcast. Hit counters, status color glow, avg response time. Pause/clear controls.
- Each sub-view has independent auto-save (positions + viewport) via `useFlowAutoSave(key)` hook
- All dynamic views have reload buttons. File nodes support double-click to open in editor.
- Request broadcast: `onAfterResponse` hook sends `{ type: 'request', method, path, status, duration }` to admin WS subscribers via `broadcastToAdmins()` in `src/lib/presence.ts`

## Projects + Tasks

Projects and tasks are project-scoped; all write endpoints gate on `requireProjectMember`. Role hierarchy (inside a project): `OWNER > PM > MEMBER > VIEWER`. `SUPER_ADMIN` bypasses membership checks.

- `GET /api/projects` — list projects visible to current user (owned or member of); counts and task stats
- `POST /api/projects` — create (auto-adds creator as `OWNER`)
- `GET /api/projects/:id` — full detail (members, milestones, extensions, recent tasks) + `myRole`
- `PATCH /api/projects/:id` — update fields (OWNER/PM)
- `DELETE /api/projects/:id` — permanent delete with cascade (OWNER or SUPER_ADMIN). Audited.
- Project members, milestones, extensions — usual CRUD under `/api/projects/:id/*`
- `GET/POST /api/projects/:id/tags` — list/create per-project tags; unique by (projectId, name)
- `PATCH/DELETE /api/tags/:id` — rename/recolor or delete (cascades to TaskTag)
- `GET /api/tasks` — list with filters (`projectId`, `status`, `kind`, `assigneeId`, `tagId`). Response enriches each task with `actualHours`, `progressPercent`, `tags`, counts for blockedBy/blocks/checklist.
- `POST /api/tasks` — create, accepts `startsAt`, `dueAt`, `estimateHours`, `tagIds[]`
- `GET /api/tasks/:id` — full detail incl. tags, blockedBy, blocks, checklist, statusChanges, comments, evidence + computed `actualHours`/`progressPercent`
- `PATCH /api/tasks/:id` — updates (status writes `TaskStatusChange`). Accepts `tagIds` (replace set), `progressPercent`, `estimateHours`, dates.
- `DELETE /api/tasks/:id` — OWNER/PM/SUPER_ADMIN
- `POST /api/tasks/:id/comments`, `POST /api/tasks/:id/evidence` — add-only
- `POST /api/tasks/:id/dependencies` (body: `blockedById`) / `DELETE /api/tasks/:id/dependencies/:blockedById`
- `POST /api/tasks/:id/checklist`, `PATCH/DELETE /api/checklist/:id`

Computed fields (not stored):
- `actualHours` = `closedAt − (startsAt ?? createdAt)` in hours, rounded to 2dp. `null` until closed.
- `progressPercent`: 100 if `CLOSED`; else ratio of checklist.done / checklist.length if checklist non-empty; else manual `progressPercent` column value.

## Dev Tools

- Click-to-source: `Ctrl+Shift+Cmd+C` toggles inspector. Custom Vite plugin (`inspectorPlugin` in `src/vite.ts`) injects `data-inspector-*` attributes. Reads original file from disk for accurate line numbers.
- HMR: Vite 8 with `@vitejs/plugin-react` v6. `dedupeRefreshPlugin` fixes double React Refresh injection.
- Editor: `REACT_EDITOR` env var. `zed` and `subl` use `file:line:col`, others use `--goto file:line:col`.

## Testing

Tests use `bun:test`. Three levels:

```bash
bun run test              # All tests
bun run test:unit         # tests/unit/ — env, db connection, bcrypt
bun run test:integration  # tests/integration/ — API endpoints via app.handle()
```

- `tests/helpers.ts` — `createTestApp()`, `seedTestUser()`, `createTestSession()`, `cleanupTestData()`
- Integration tests use `createApp().handle(new Request(...))` — no server needed

## APIs

- `Bun.password.hash()` / `Bun.password.verify()` for bcrypt
- `Bun.RedisClient` for Redis (native, no package)
- `Bun.file()` for static file serving in production
- `Bun.which()` / `Bun.spawn()` for editor integration
- `crypto.randomUUID()` for session tokens
