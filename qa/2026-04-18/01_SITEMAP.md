# 01 — SITEMAP (Fase 1 DISCOVERY)

Generated: 2026-04-18 by QA Discovery Agent (Claude Opus 4.7)
Source: read-only static analysis + live probe of `http://localhost:3111`
Baseline: `qa/RECON.md`, `qa/2026-04-18/SESSION.md`, `qa/2026-04-18/INTERNAL_CHECK.md`
Git commit: `e9cc74e811edbd9dcee890af7233125970cc834d` (branch `main`, working tree dirty)

---

## 1. Overview

Methodology: cross-reference (a) `GET /api/admin/routes` as SUPER_ADMIN, (b) grep of `app.(get|post|put|patch|delete|ws|all)` in `src/app.ts`, (c) file scan under `src/frontend/routes/` + `scripts/mcp/tools/` + `prisma/schema.prisma`. The admin routes endpoint reports 86 entries (9 PAGE + 76 API + 1 WS). Grep finds 82 unique method+path combos in `src/app.ts` (81 HTTP + 1 WS). Delta (6 endpoints) is a documentation gap in `GET /api/admin/routes` — all 6 are real live endpoints, flagged in Section 3 and CHANGES TO RECON.

| Surface                               | Count |
| ------------------------------------- | ----- |
| Frontend routes (files)               | 10    |
| Frontend routes (live / non-redirect) | 8     |
| HTTP handlers in `src/app.ts`         | 81    |
| HTTP handlers (live routes)           | 81    |
| WebSocket channels                    | 1 (`/ws/presence`) |
| Prisma models                         | 22    |
| Prisma enums                          | 11    |
| MCP tool modules                      | 16 (`shared.ts` = helpers only, no tools) |
| MCP tools registered                  | 79    |
| External integrations                 | 5 (Google OAuth, GitHub, pm-watch/AW, Redis, MCP) |

---

## 2. Frontend Routes

TanStack Router file-based; all under `src/frontend/routes/`. `beforeLoad` hook does auth gating — on unauthenticated access the route redirects to `/login`; on `user.blocked === true` to `/blocked`; on insufficient role to the appropriate landing route for that role.

| Path         | File                           | Lines | Auth guard                              | Redirect (if any)            | Notes / tabs |
| ------------ | ------------------------------ | ----- | --------------------------------------- | ---------------------------- | ------------ |
| `/`          | `index.tsx` (L42)              | 413   | public                                  | —                            | Landing + theme toggle + "continue" CTA when logged in. |
| `/login`     | `login.tsx` (L9)               | 106   | public; redirects away if session       | → `getDefaultRoute(role)` when already signed in | Email+password form + Google OAuth button. |
| `/blocked`   | `blocked.tsx` (L7)             | 65    | public                                  | —                            | Blocked user landing + direct logout button. |
| `/profile`   | `profile.tsx` (L3)             | 7     | public (always redirects)               | → `/settings`                | Legacy stub. |
| `/dashboard` | `dashboard.tsx` (L3)           | 7     | public (always redirects)               | → `/admin?tab=overview`      | Legacy stub. |
| `/settings`  | `settings.tsx` (L10)           | 160   | session required; blocked→`/blocked`    | → `/login` on missing session | Standalone. Profile info, devices panel (`MyDevicesPanel`), notification bell, logout. Visible nav buttons gated by role: PM (all), Admin (ADMIN+), Dev (SUPER_ADMIN). |
| `/pm`        | `pm.tsx` (L52)                 | 463   | session + not blocked                    | → `/login`, → `/blocked`    | AppShell sidebar, 5 tabs: `overview`, `projects`, `tasks`, `activity` (badge "AW"), `team`. URL search params: `tab`, `projectId`, `detailTab`, `taskId`. Project detail has 6 sub-tabs (see below). |
| `/admin`     | `admin.tsx` (L45)              | 366   | role ∈ {ADMIN, SUPER_ADMIN}              | → `/pm?tab=overview` when USER/QC; → `/login` / `/blocked` | AppShell sidebar, 3 tabs: `overview`, `users`, `analytics`. |
| `/dev`       | `dev.tsx` (L94)                | 3639  | role === SUPER_ADMIN                     | ADMIN → `/admin`; USER/QC → `/pm`; → `/login` / `/blocked` | AppShell sidebar, **10 tabs** (`navItems` at L127): overview, users, agents, webhook-tokens, webhook-monitor, app-logs, user-logs, database, project, settings. |
| `/__root`    | `__root.tsx`                   | 26    | n/a                                     | —                            | Root layout, renders `<Outlet />` only. |

### `/pm` → Project Detail sub-tabs

Source: `src/frontend/components/ProjectDetailView.tsx:56`.
`PROJECT_DETAIL_TABS = ['overview', 'tasks', 'team', 'milestones', 'extensions', 'settings']` — 6 tabs. Reached via `/pm?tab=projects&projectId=<id>&detailTab=<tab>`.

### `/dev` → Project sub-views (React Flow)

Source: `dev.tsx:1573-1622`. `ProjectPanel` renders 10 React-Flow views via a grouped Select (`subView` state, default `api-routes`):

| Group         | Sub-view         | Data source                         |
| ------------- | ---------------- | ----------------------------------- |
| Architecture  | `api-routes`     | `GET /api/admin/routes`             |
| Architecture  | `file-structure` | `GET /api/admin/project-structure`  |
| Architecture  | `user-flow`      | static                              |
| Architecture  | `data-flow`      | static                              |
| DevOps        | `env-map`        | `GET /api/admin/env-map`            |
| DevOps        | `test-coverage`  | `GET /api/admin/test-coverage`      |
| DevOps        | `dependencies`   | `GET /api/admin/dependencies`       |
| DevOps        | `migrations`     | `GET /api/admin/migrations`         |
| Live          | `sessions`       | `GET /api/admin/sessions`           |
| Live          | `live-requests`  | WS `/ws/presence` broadcast         |

Each view persists positions + viewport to `localStorage` via `useFlowAutoSave(key)`.

### Role → Default route mapping

`getDefaultRoute(role)` in `src/frontend/hooks/useAuth.ts`:
- SUPER_ADMIN, ADMIN → `/admin`
- USER, QC → `/pm`

`CLAUDE.md` says SUPER_ADMIN default route is `/dev`; actual code points to `/admin`. See CHANGES TO RECON.

---

## 3. HTTP API Routes

All handlers live in `src/app.ts` (4,461 lines). Below table groups by path prefix; source line is the `.method('/path', ...)` location. Auth columns:

| Code                | Meaning |
| ------------------- | ------- |
| `public`            | No auth check                      |
| `session`           | Any valid session (blocked → 401)  |
| `super_admin`       | Equality check `role === 'SUPER_ADMIN'` |
| `admin+`            | `role === 'ADMIN' || 'SUPER_ADMIN'` |
| `project-member`    | `requireProjectMember(projectId, userId)` (SUPER_ADMIN bypass) |
| `project-owner`     | `ProjectMember.role === 'OWNER'` (or SUPER_ADMIN) |
| `project-write`     | `ProjectMember.role ∈ {OWNER, PM}` (or SUPER_ADMIN) |
| `webhook-token`     | Bearer token via `WebhookToken` table + `PMW_WEBHOOK_TOKEN` fallback |
| `hmac-signature`    | `X-Hub-Signature-256` HMAC SHA-256 against `GITHUB_WEBHOOK_SECRET` |
| `mcp-secret`        | `MCP_SECRET` (readonly) / `MCP_SECRET_ADMIN` (admin) via Bearer or `x-mcp-secret` |

Lines below refer to `src/app.ts`.

### 3.1 Auth — `/api/auth/*`

| Method | Path                         | Auth                  | Line  | Purpose                                                       |
| ------ | ---------------------------- | --------------------- | ----- | ------------------------------------------------------------- |
| POST   | `/api/auth/login`            | public                | 241   | Email+password, verifies via `Bun.password.verify`, returns session cookie (`HttpOnly; SameSite=Lax; Max-Age=86400`, no `Secure`). Writes `AuditLog` (LOGIN / LOGIN_FAILED / LOGIN_BLOCKED). |
| POST   | `/api/auth/logout`           | session (implicit)    | 270   | Deletes session row matching cookie. Audited LOGOUT.          |
| GET    | `/api/auth/session`          | public (401 if bad)   | 286   | Hydrates session from cookie → user row. Auto-deletes expired sessions. Returns 401 if user blocked or session stale. |
| GET    | `/api/auth/google`           | public                | 306   | 302 redirect to Google's OAuth endpoint.                      |
| GET    | `/api/auth/callback/google`  | public                | 320   | Exchanges code → profile → upsert `User`. SUPER_ADMIN auto-promotion via `SUPER_ADMIN_EMAIL`. Creates session cookie. |

### 3.2 Admin (SUPER_ADMIN) — `/api/admin/*`

All equality-gated on `role === 'SUPER_ADMIN'` → 403 otherwise (verified Fase 0).

| Method | Path                                     | Line | Purpose |
| ------ | ---------------------------------------- | ---- | ------- |
| GET    | `/api/admin/users`                       | 395  | List all users (id, name, email, role, blocked, createdAt). |
| PUT    | `/api/admin/users/:id/role`              | 417  | Change role. **Accepts only `USER` or `ADMIN`** (body validated in-handler). Blocks self-change and SUPER_ADMIN target. |
| PUT    | `/api/admin/users/:id/block`             | 457  | Block/unblock; deletes all sessions on block. |
| GET    | `/api/admin/presence`                    | 525  | Online userIds (REST — paired with `/ws/presence`). |
| GET    | `/api/admin/logs/app`                    | 544  | Redis ring-buffer logs. `?level=`, `?limit=`, `?afterId=`. |
| GET    | `/api/admin/logs/audit`                  | 566  | DB audit log. `?userId=`, `?action=`, `?limit=` (max 500). |
| DELETE | `/api/admin/logs/app`                    | 599  | Wipes Redis app-log list. |
| DELETE | `/api/admin/logs/audit`                  | 619  | `TRUNCATE` AuditLog. |
| GET    | `/api/admin/schema`                      | 640  | Parsed `prisma/schema.prisma` (via `parseSchema` from `src/lib/schema-parser.ts`). |
| GET    | `/api/admin/routes`                      | 667  | Self-documenting route list (**only 76 API routes reported — 6 missing, see below**). |
| GET    | `/api/admin/project-structure`           | 1290 | File tree + imports + line counts. |
| GET    | `/api/admin/env-map`                     | 1447 | Env vars with set/unset + usedBy. **Only reports 10 of 16 env keys** — missing MCP_SECRET, MCP_SECRET_ADMIN, PMW_WEBHOOK_TOKEN, PMW_EVENT_BATCH_MAX, GITHUB_WEBHOOK_SECRET, UPLOADS_DIR, UPLOAD_MAX_BYTES. See CHANGES TO RECON. |
| GET    | `/api/admin/test-coverage`               | 1614 | source ↔ tests mapping. |
| GET    | `/api/admin/dependencies`                | 1739 | `package.json` parse + importers. |
| GET    | `/api/admin/migrations`                  | 1840 | `prisma/migrations/*` parse. Empty in this repo (db-push workflow). |
| GET    | `/api/admin/sessions`                    | 1917 | Active Session rows + user + online flag. |
| GET    | `/api/admin/agents`                      | 4046 | pm-watch agents + claimedBy + event count. |
| POST   | `/api/admin/agents/:id/approve`          | 4066 | Approve PENDING agent; assigns to userId. |
| POST   | `/api/admin/agents/:id/revoke`           | 4100 | Revoke APPROVED agent; events preserved. |
| GET    | `/api/admin/webhook-tokens`              | 4125 | List tokens (hash never exposed). |
| POST   | `/api/admin/webhook-tokens`              | 4153 | Create token; returns plaintext ONCE. |
| PATCH  | `/api/admin/webhook-tokens/:id`          | 4209 | Toggle ACTIVE/DISABLED or rename. |
| DELETE | `/api/admin/webhook-tokens/:id`          | 4248 | Revoke token (terminal). |
| GET    | `/api/admin/webhooks/stats`              | 4270 | 24h/7d aggregates: total/success/fail/auth-fail/events + perToken + perAgent. |
| GET    | `/api/admin/webhooks/logs`               | 4387 | Recent `WebhookRequestLog` rows. `?status=all|ok|fail|auth&limit=`. |

### 3.3 Projects — `/api/projects/*` + `/api/milestones/*`

Auth is `session` unless noted. Write-side gates use `requireProjectMember` at `src/app.ts:178`.

| Method | Path                                       | Auth                | Line | Purpose |
| ------ | ------------------------------------------ | ------------------- | ---- | ------- |
| GET    | `/api/users`                               | session             | 1977 | Lightweight user list for pickers. |
| GET    | `/api/projects`                            | session             | 1991 | Visible projects (owned/member), with task stats. |
| POST   | `/api/projects`                            | session             | 2056 | Create project; creator → OWNER. |
| GET    | `/api/projects/:id`                        | project-member      | 2097 | Full detail (members, milestones, extensions, recent tasks, `myRole`). |
| PATCH  | `/api/projects/:id`                        | project-write       | 2141 | Name/description/status/priority/dates/**githubRepo** (normalized). |
| DELETE | `/api/projects/:id`                        | project-owner       | 2210 | Permanent delete + cascade. Audited. |
| GET    | `/api/projects/:id/github/summary`         | project-member      | 2234 | Commits 7d/30d, contributors, open PRs, last push. **Missing from `/api/admin/routes`**. |
| GET    | `/api/projects/:id/github/feed`            | project-member      | 2318 | Paginated GitHub events. `?limit`, `?kind`. **Missing from `/api/admin/routes`**. |
| POST   | `/api/projects/:id/members`                | project-write       | 2344 | Add member. |
| DELETE | `/api/projects/:id/members/:userId`        | project-owner       | 2600 | Remove member (OWNER only). |
| POST   | `/api/projects/:id/extend`                 | project-write       | 2375 | Extend deadline; writes `ProjectExtension`. |
| GET    | `/api/projects/:id/extensions`             | project-member      | 2440 | Deadline audit trail. |
| GET    | `/api/milestones`                          | session             | 2459 | Across all projects user is a member of. |
| GET    | `/api/projects/:id/milestones`             | project-member      | 2478 | Project milestones. |
| POST   | `/api/projects/:id/milestones`             | project-write       | 2496 | Create milestone. |
| PATCH  | `/api/milestones/:id`                      | project-write       | 2534 | Update/complete milestone. |
| DELETE | `/api/milestones/:id`                      | project-write       | 2576 | Delete milestone. |

### 3.4 Tasks — `/api/tasks/*`, `/api/checklist/*`, `/api/tags/*`, `/api/evidence/*`

`kind`-aware task transitions enforced by `getAllowedTaskTransitions()` at `src/app.ts:35`.

| Method | Path                                              | Auth            | Line | Purpose |
| ------ | ------------------------------------------------- | --------------- | ---- | ------- |
| GET    | `/api/tasks`                                      | session         | 2624 | Filters: `projectId, status, kind, assigneeId, tagId, mine`. Adds `actualHours`, `progressPercent`, tags, counts. |
| POST   | `/api/tasks`                                      | project-member  | 2671 | Create task incl. `startsAt, dueAt, estimateHours, tagIds[]`. Notifies assignee. |
| GET    | `/api/tasks/:id`                                  | project-member  | 2731 | Full detail + comments + evidence + status history. |
| PATCH  | `/api/tasks/:id`                                  | project-member  | 2785 | Status transition gated by `getAllowedTaskTransitions`. Writes `TaskStatusChange`. Notifies on assignment/status change. |
| DELETE | `/api/tasks/:id`                                  | project-write   | —    | (grep shows path in routes meta; DELETE registered as part of task ops near L2785 block) **gap to verify in Fase 3** — grep did not match a literal `.delete('/api/tasks/:id')`. The admin/routes endpoint does NOT list DELETE for tasks either. **FLAG** — possibly unimplemented despite CLAUDE.md + RECON claim. |
| POST   | `/api/tasks/:id/comments`                         | project-member  | 2898 | Comment. Notifies assignee + reporter. |
| POST   | `/api/tasks/:id/evidence`                         | project-member  | 2945 | Attach evidence by URL. |
| POST   | `/api/tasks/:id/evidence/upload`                  | project-member  | 2972 | Multipart upload → `UPLOADS_DIR`; max `UPLOAD_MAX_BYTES` (10 MiB). **Missing from `/api/admin/routes`**. |
| GET    | `/api/evidence/:file`                             | session (?)     | 3039 | Serve uploaded file. Auth semantics TBD in Fase 2. **Missing from `/api/admin/routes`**. |
| GET    | `/api/projects/:id/tags`                          | project-member  | 3077 | List project tags. |
| POST   | `/api/projects/:id/tags`                          | project-write   | 3095 | Create tag. |
| PATCH  | `/api/tags/:id`                                   | project-write   | 3131 | Rename / recolor. |
| DELETE | `/api/tags/:id`                                   | project-write   | 3155 | Delete tag (cascade to TaskTag). |
| POST   | `/api/tasks/:id/dependencies`                     | project-member  | 3177 | Add blocked-by dep (same-project). |
| DELETE | `/api/tasks/:id/dependencies/:blockedById`        | project-member  | 3220 | Remove dep. |
| POST   | `/api/tasks/:id/checklist`                        | project-member  | 3243 | Add checklist item. |
| PATCH  | `/api/checklist/:id`                              | project-member  | 3279 | Toggle / rename. |
| DELETE | `/api/checklist/:id`                              | project-member  | 3307 | Delete item. |

### 3.5 Activity — `/api/activity/*`

Returns own data; admin/super_admin scope expands (see RECON §6). Pulled from `ActivityEvent`.

| Method | Path                        | Auth    | Line | Purpose |
| ------ | --------------------------- | ------- | ---- | ------- |
| GET    | `/api/activity/agents`      | session | 3331 | Approved agents for current user (admin+ expand). |
| GET    | `/api/activity`             | session | 3390 | Event list with filters (from/to/bucket/agent/limit). |
| GET    | `/api/activity/calendar`    | session | 3423 | Per-day counts for month (`YYYY-MM`). |
| GET    | `/api/activity/heatmap`     | session | 3468 | Per-day counts for year (`YYYY`). |
| GET    | `/api/activity/summary`     | session | 3512 | Today/week totals, top apps/windows. |

### 3.6 Me / Notifications — `/api/me/*`

| Method | Path                                    | Auth    | Line | Purpose |
| ------ | --------------------------------------- | ------- | ---- | ------- |
| GET    | `/api/me/agents`                        | session | 3941 | Current user's claimed pm-watch agents. |
| GET    | `/api/me/notifications`                 | session | 3965 | `?limit`, `?unread`. |
| GET    | `/api/me/notifications/unread-count`    | session | 3986 | Counter. |
| POST   | `/api/me/notifications/:id/read`        | session | 3998 | Mark one read. |
| POST   | `/api/me/notifications/read-all`        | session | 4017 | Mark all read. |
| DELETE | `/api/me/notifications/:id`             | session | 4030 | Delete notification. |

### 3.7 Webhooks — `/webhooks/*`

| Method | Path                | Auth            | Line | Purpose |
| ------ | ------------------- | --------------- | ---- | ------- |
| POST   | `/webhooks/aw`      | webhook-token   | 3614 | ActivityWatch ingestion. Bearer against `WebhookToken` (SHA-256) or `PMW_WEBHOOK_TOKEN` fallback. 413 on batch > `PMW_EVENT_BATCH_MAX` (500). Writes `WebhookRequestLog`. |
| POST   | `/webhooks/github`  | hmac-signature  | 3736 | GitHub events (push/pull_request/review/ping). HMAC SHA-256 via `X-Hub-Signature-256` + `GITHUB_WEBHOOK_SECRET`. Writes `GithubWebhookLog` + `ProjectGithubEvent`. **Missing from `/api/admin/routes`**. |

### 3.8 MCP & utility

| Method | Path                | Auth          | Line | Purpose |
| ------ | ------------------- | ------------- | ---- | ------- |
| ALL    | `/mcp`              | mcp-secret    | 4416 | MCP over HTTP. 503 if neither `MCP_SECRET` nor `MCP_SECRET_ADMIN` set; 401 if provided secret doesn't match. Returns transport response with `x-mcp-server`, `x-mcp-scope` headers. **Missing from `/api/admin/routes`**. |
| GET    | `/health`           | public        | 238  | `{ status: 'ok' }`. |
| GET    | `/api/hello`        | public        | 4449 | Demo. |
| PUT    | `/api/hello`        | public        | 4453 | Demo. |
| GET    | `/api/hello/:name`  | public        | 4457 | Demo. |
| POST   | `/__open-in-editor` | dev-only, **no auth** | —    | In `src/index.tsx:206`, guarded only by `NODE_ENV !== 'production'`. Spawns editor. Parked for CH-5. |

### 3.9 Missing from `GET /api/admin/routes` (6 endpoints)

| Endpoint                                  | Real line |
| ----------------------------------------- | --------- |
| POST `/webhooks/github`                   | 3736      |
| GET `/api/projects/:id/github/summary`    | 2234      |
| GET `/api/projects/:id/github/feed`       | 2318      |
| POST `/api/tasks/:id/evidence/upload`     | 2972      |
| GET `/api/evidence/:file`                 | 3039      |
| ALL `/mcp`                                | 4416      |

Root cause: the inline hard-coded list inside the `/api/admin/routes` handler was not updated when these endpoints landed. Documentation drift, not a security issue. Flagged as `FASE1-001` in CHANGES TO RECON.

---

## 4. WebSocket endpoints

| Path           | Auth            | Line | Subscribers / broadcasts |
| -------------- | --------------- | ---- | ------------------------ |
| `/ws/presence` | cookie session  | 494  | Open: validates session, closes `4001 Unauthorized` if missing/expired. `isAdmin = role ∈ {ADMIN, SUPER_ADMIN}`; admin subscribers get `{ type: 'presence', online: [...] }` on connect and every user connect/disconnect. Admin subs **also** receive per-request telemetry `{ type: 'request', method, path, status, duration, timestamp }` from `onAfterResponse` (`src/app.ts:219`). |

Connection map (in-memory) in `src/lib/presence.ts:4`. Sends to admin subs via `broadcastToAdmins`. Sends to user via `broadcastToUser`. WS close deletes from map; on disconnect re-broadcasts.

---

## 5. Prisma Models (22) + Enums (11)

Schema file: `prisma/schema.prisma` (511 lines). All tables `@@map`'d to snake_case.

### 5.1 Enums

| Enum                | Values                                                                   | Default     |
| ------------------- | ------------------------------------------------------------------------ | ----------- |
| `Role`              | `USER, QC, ADMIN, SUPER_ADMIN`                                            | `USER`      |
| `AgentStatus`       | `PENDING, APPROVED, REVOKED`                                              | `PENDING`   |
| `WebhookTokenStatus`| `ACTIVE, DISABLED, REVOKED`                                               | `ACTIVE`    |
| `ProjectMemberRole` | `OWNER, PM, MEMBER, VIEWER`                                               | `MEMBER`    |
| `ProjectStatus`     | `DRAFT, ACTIVE, ON_HOLD, COMPLETED, CANCELLED`                            | `ACTIVE`    |
| `ProjectPriority`   | `LOW, MEDIUM, HIGH, CRITICAL`                                             | `MEDIUM`    |
| `TaskKind`          | `TASK, BUG, QC`                                                           | `TASK`      |
| `TaskStatus`        | `OPEN, IN_PROGRESS, READY_FOR_QC, REOPENED, CLOSED`                       | `OPEN`      |
| `TaskPriority`      | `LOW, MEDIUM, HIGH, CRITICAL`                                             | `MEDIUM`    |
| `NotificationKind`  | `TASK_ASSIGNED, TASK_COMMENTED, TASK_STATUS_CHANGED, TASK_DUE_SOON, TASK_OVERDUE, TASK_MENTIONED` | — |
| `GithubEventKind`   | `PUSH_COMMIT, PR_OPENED, PR_CLOSED, PR_MERGED, PR_REVIEWED`               | —           |

### 5.2 Models

| Model (table)               | Line | Key fields                                                               | Unique / Indexed                                 | Touched by endpoints |
| --------------------------- | ---- | ------------------------------------------------------------------------ | ------------------------------------------------ | -------------------- |
| `User` (`user`)             | 90   | `id, name, email, password, role, blocked`                               | `email` unique                                    | `/api/auth/*`, `/api/admin/users`, `/api/users`, `/api/admin/users/:id/*` |
| `Session` (`session`)       | 118  | `token, userId, expiresAt`                                                | `token` unique, idx `token`                       | `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`, WS `/ws/presence`, `/api/admin/sessions` |
| `AuditLog` (`audit_log`)    | 131  | `action, detail, ip, createdAt`                                           | idx `userId, action, createdAt`                   | `/api/admin/logs/audit`; written by login/logout/role/block handlers |
| `Agent` (`agent`)           | 147  | `agentId (unique), hostname, osUser, status, claimedById, lastSeenAt`    | idx `status, claimedById`                         | `/webhooks/aw`, `/api/admin/agents*`, `/api/me/agents`, `/api/activity/agents` |
| `ActivityEvent` (`activity_event`) | 167 | `agentId, bucketId, eventId, timestamp, duration, data (Json)`        | unique `(agentId, bucketId, eventId)`, idx `timestamp, bucketId` | `/webhooks/aw`, `/api/activity*`, task AW focus computation |
| `WebhookToken` (`webhook_token`) | 186 | `name, tokenHash (unique), tokenPrefix, status, expiresAt, lastUsedAt` | unique `tokenHash`, idx `status, createdById`   | `/api/admin/webhook-tokens*`, `/webhooks/aw` (verify) |
| `Project` (`project`)       | 206  | `name, ownerId, status, priority, startsAt, endsAt, originalEndAt, archivedAt, githubRepo (unique)` | unique `githubRepo`, idx `ownerId, status, endsAt, archivedAt` | `/api/projects*`, `/webhooks/github` (via `githubRepo` lookup) |
| `ProjectMilestone` (`project_milestone`) | 237 | `title, dueAt, completedAt, order`                              | idx `projectId, dueAt`                            | `/api/projects/:id/milestones`, `/api/milestones/:id` |
| `ProjectExtension` (`project_extension`) | 255 | `previousEndAt, newEndAt, reason`                               | idx `projectId, createdAt`                        | `/api/projects/:id/extend`, `/api/projects/:id/extensions` |
| `ProjectMember` (`project_member`) | 272 | `projectId, userId, role, joinedAt`                                  | unique `(projectId, userId)`, idx `userId`        | `/api/projects/:id/members*`, all project-member gates |
| `Task` (`task`)             | 287  | `projectId, kind, title, description, status, priority, reporterId, assigneeId, startsAt, dueAt, estimateHours, progressPercent, closedAt, route` | idx `projectId, status, kind, reporterId, assigneeId, createdAt` | `/api/tasks*`, `/api/activity` (AW focus) |
| `Tag` (`tag`)               | 326  | `projectId, name, color`                                                 | unique `(projectId, name)`, idx `projectId`       | `/api/projects/:id/tags`, `/api/tags/:id` |
| `TaskTag` (`task_tag`)      | 341  | `taskId, tagId`                                                           | pk `(taskId, tagId)`, idx `tagId`                 | task CRUD (replace set via `tagIds`) |
| `TaskDependency` (`task_dependency`) | 353 | `taskId, blockedById`                                              | unique `(taskId, blockedById)`, idx both          | `/api/tasks/:id/dependencies*` |
| `TaskChecklistItem` (`task_checklist_item`) | 368 | `taskId, title, done, order`                                 | idx `taskId`                                      | `/api/tasks/:id/checklist`, `/api/checklist/:id` |
| `TaskStatusChange` (`task_status_change`) | 383 | `taskId, authorId, fromStatus, toStatus`                       | idx `taskId, createdAt`                           | Written by `PATCH /api/tasks/:id` on status change; shown in task detail timeline |
| `TaskComment` (`task_comment`) | 399 | `taskId, authorId, authorTag, body`                                   | idx `taskId`                                      | `/api/tasks/:id/comments` |
| `TaskEvidence` (`task_evidence`) | 414 | `taskId, kind, url, note`                                            | idx `taskId`                                      | `/api/tasks/:id/evidence*`, `/api/evidence/:file` |
| `Notification` (`notification`) | 428 | `recipientId, actorId, kind, taskId, projectId, title, body, readAt` | idx `(recipientId, readAt), (recipientId, createdAt), taskId` | `/api/me/notifications*`; written by task assign/comment/status and `sweepDueTasks` cron |
| `WebhookRequestLog` (`webhook_request_log`) | 449 | `tokenId, agentId, statusCode, reason, ip, eventsIn`          | idx `tokenId, agentId, createdAt, statusCode`     | Written by `/webhooks/aw`; read by `/api/admin/webhooks/{stats,logs}` |
| `ProjectGithubEvent` (`project_github_event`) | 469 | `projectId, kind, actorLogin, actorEmail, matchedUserId, title, url, sha, prNumber, metadata (Json)` | unique `(projectId, kind, sha, prNumber)`, idx `(projectId, createdAt), kind, matchedUserId` | Written by `/webhooks/github`; read by `/api/projects/:id/github/*` |
| `GithubWebhookLog` (`github_webhook_log`) | 494 | `projectId, deliveryId, event, statusCode, reason, ip, eventsIn` | idx `projectId, createdAt, statusCode`            | Written by `/webhooks/github`; not yet surfaced in admin API (flag) |

### 5.3 Cascade map (onDelete behavior)

- `User` delete → cascades `Session, ActivityEvent(via Agent), ProjectMember, Task(reporter), TaskComment(SetNull), TaskStatusChange(SetNull), ownedProjects(Cascade)`, etc.
- `Project` delete → cascades ALL project children (members, tasks, milestones, extensions, tags, github events, github logs).
- `Task` delete → cascades comments, evidence, checklist, status changes, tags (TaskTag), dependencies (both directions).
- `Agent` delete → cascades `ActivityEvent`.
- `WebhookToken` delete → sets `WebhookRequestLog.tokenId = null`.

---

## 6. MCP Tools

Registered in `scripts/mcp/server.ts` (69 lines). Each tool module exports `{ name, scope, register(server) }`. 16 modules, 79 tools total.

| Module (file)               | Scope    | Tools |
| --------------------------- | -------- | ----- |
| `admin.ts`                  | admin    | `admin_set_user_role`, `admin_block_user`, `admin_unblock_user`, `admin_revoke_sessions`, `admin_create_user`, `admin_reset_password` (6) |
| `agents.ts` (readonly)      | readonly | `agent_list`, `agent_get` (2) |
| `agents.ts` (admin)         | admin    | `agent_approve`, `agent_revoke`, `agent_reassign` (3) |
| `code.ts`                   | readonly | `code_read_file`, `code_grep`, `code_stat` (3) |
| `db.ts`                     | readonly | `db_list_users`, `db_get_user`, `db_list_sessions`, `db_list_audit_logs`, `db_count_by_table` (5) |
| `dev.ts`                    | admin    | `dev_typecheck`, `dev_lint`, `dev_test`, `dev_db_migrate`, `dev_db_seed`, `dev_db_generate` (6) |
| `github.ts` (readonly)      | readonly | `github_summary`, `github_feed`, `github_webhook_logs` (3) |
| `health.ts`                 | readonly | `health_full` (1) |
| `logs.ts` (readonly)        | readonly | `logs_app`, `logs_audit` (2) |
| `logs.ts` (admin)           | admin    | `logs_clear_app`, `logs_clear_audit` (2) |
| `milestones.ts` (readonly)  | readonly | `milestone_list` (1) |
| `milestones.ts` (admin)     | admin    | `milestone_create`, `milestone_update`, `milestone_delete` (3) |
| `presence.ts`               | readonly | `presence_online` (1) |
| `project.ts`                | readonly | `project_routes`, `project_schema`, `project_dependencies`, `project_migrations`, `project_env_map`, `project_structure` (6) |
| `projects.ts` (readonly)    | readonly | `project_list`, `project_get` (2) |
| `projects.ts` (admin)       | admin    | `project_create`, `project_update`, `project_extend`, `project_add_member`, `project_remove_member`, `project_delete`, `project_archive` (7) |
| `redis.ts`                  | admin    | `redis_get`, `redis_set`, `redis_del`, `redis_keys`, `redis_info` (5) |
| `shared.ts`                 | helpers  | (no tools, utility module) |
| `tasks.ts` (readonly)       | readonly | `task_list`, `task_get` (2) |
| `tasks.ts` (admin)          | admin    | `task_create`, `task_update`, `task_comment`, `task_add_evidence`, `task_delete` (5) |
| `webhooks.ts` (readonly)    | readonly | `webhook_token_list`, `webhook_stats`, `webhook_logs` (3) + **1 extra** readonly (see file L121, `webhook_agents_recent` or similar — 4 readonly total in the source; recount below) |
| `webhooks.ts` (admin)       | admin    | `webhook_token_create`, `webhook_token_toggle`, `webhook_token_revoke` (3) |

Recount from grep: 79 `registerTool(` calls (admin:14 + readonly scope modules). Total = 79. See `scripts/mcp/tools/webhooks.ts:15,51,121` for the readonly trio + `webhooks.ts:121` for the 4th readonly if present — verify at Fase 2 if any tool enumeration is needed.

Loaded per scope by `createMcpServer(scope)` (`scripts/mcp/server.ts`). Both the stdio MCP (via `.mcp.json`) and the HTTP fallback (`ALL /mcp`) share this factory.

---

## 7. External Integrations

| Integration           | Entry                                    | Config                                    | Notes |
| --------------------- | ---------------------------------------- | ----------------------------------------- | ----- |
| Google OAuth          | `/api/auth/google`, `/api/auth/callback/google` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (required) | Upserts user on callback. Auto-promotes to SUPER_ADMIN via `SUPER_ADMIN_EMAIL` comma-list. |
| GitHub webhooks       | `/webhooks/github`                       | `GITHUB_WEBHOOK_SECRET` (optional in env.ts — falls back to empty) | HMAC SHA-256 timing-safe (`src/lib/github.ts`). Ping/push/pull_request/pull_request_review supported. Repo resolves via `Project.githubRepo` (normalized `owner/repo`). |
| pm-watch / ActivityWatch | `/webhooks/aw`                         | `PMW_WEBHOOK_TOKEN` fallback, `PMW_EVENT_BATCH_MAX` (500), `WEBHOOK_LOG_RETENTION_DAYS` (7) | Agent auto-register on first contact (status `PENDING`). Must be APPROVED to accept events. Per-batch cap 413. Every call logs to `WebhookRequestLog`. |
| Redis                 | `src/lib/redis.ts` (via `Bun.RedisClient`) | `REDIS_URL` (required)                 | Stores app log ring buffer (`app:logs`, LTRIM 500). |
| MCP                   | `.mcp.json` (`pm-dashboard`) + `ALL /mcp` | `MCP_SECRET` (readonly), `MCP_SECRET_ADMIN` (admin) | 503 if unconfigured; 401 on secret mismatch. |

Not wired: `TELEGRAM_NOTIFY_TOKEN`, `TELEGRAM_NOTIFY_CHAT_ID` (present in `.env.example` only; no server consumer). `BETTER_AUTH_*` (legacy, unused).

---

## 8. Env Variables

Cross-check `.env.example` (36 lines) vs `src/lib/env.ts` (32 lines) vs `/api/admin/env-map`. `env.ts` exposes 16 keys; `env-map` reports only 10 (**gap**).

| Key                          | In env.ts | In .env.example | In env-map API | Required? | Default                         | Purpose |
| ---------------------------- | --------- | --------------- | -------------- | --------- | ------------------------------- | ------- |
| `DATABASE_URL`               | yes       | yes             | yes            | **YES**   | —                               | Postgres DSN |
| `REDIS_URL`                  | yes       | yes             | yes            | **YES**   | —                               | Redis DSN |
| `GOOGLE_CLIENT_ID`           | yes       | yes             | yes            | **YES**   | —                               | OAuth |
| `GOOGLE_CLIENT_SECRET`       | yes       | yes             | yes            | **YES**   | —                               | OAuth |
| `PORT`                       | yes       | yes             | yes            | no        | `3000`                          | Server port (`.env` = 3111 locally) |
| `NODE_ENV`                   | yes       | implicit        | yes            | no        | `development`                   | Mode |
| `REACT_EDITOR`               | yes       | yes             | yes            | no        | `code`                          | Click-to-source editor |
| `SUPER_ADMIN_EMAIL`          | yes       | yes             | yes            | no        | `""`                            | Comma-list for role auto-promotion |
| `AUDIT_LOG_RETENTION_DAYS`   | yes       | no              | yes            | no        | `90`                            | Cron cleanup window |
| `WEBHOOK_LOG_RETENTION_DAYS` | yes       | no              | yes            | no        | `7`                             | Cron cleanup window |
| `MCP_SECRET`                 | yes       | yes             | **no**         | no        | `""`                            | MCP readonly scope |
| `MCP_SECRET_ADMIN`           | yes       | no              | **no**         | no        | `""`                            | MCP admin scope |
| `PMW_WEBHOOK_TOKEN`          | yes       | yes             | **no**         | no        | `""`                            | `/webhooks/aw` fallback |
| `PMW_EVENT_BATCH_MAX`        | yes       | yes             | **no**         | no        | `500`                           | AW batch cap |
| `GITHUB_WEBHOOK_SECRET`      | yes       | yes             | **no**         | no        | `""`                            | HMAC `/webhooks/github` |
| `UPLOADS_DIR`                | yes       | no              | **no**         | no        | `./uploads`                     | Evidence directory |
| `UPLOAD_MAX_BYTES`           | yes       | no              | **no**         | no        | `10 * 1024 * 1024`              | Upload size cap |
| `DIRECT_URL`                 | no        | yes             | n/a            | n/a       | —                               | Prisma migration URL (consumed by Prisma CLI, not runtime env.ts) |
| `BETTER_AUTH_SECRET`         | no        | yes             | n/a            | n/a       | —                               | **Legacy** — not consumed anywhere |
| `BETTER_AUTH_URL`            | no        | yes             | n/a            | n/a       | —                               | **Legacy** — not consumed anywhere |
| `TELEGRAM_NOTIFY_TOKEN`      | no        | yes             | n/a            | n/a       | —                               | External hook, not server |
| `TELEGRAM_NOTIFY_CHAT_ID`    | no        | yes             | n/a            | n/a       | —                               | External hook, not server |

Observations:
- `env-map` gap (7 keys missing) — affects the Dev Console Env Variables view. Flagged as `FASE1-002`.
- `.env.example` drift — missing `AUDIT_LOG_RETENTION_DAYS`, `WEBHOOK_LOG_RETENTION_DAYS`, `MCP_SECRET_ADMIN`, `UPLOADS_DIR`, `UPLOAD_MAX_BYTES`. Partial (chore) commit `738988a` synced some but not all.

---

## 9. Surfaces Grouped by Priority for Fase 2

### P0 — security / identity critical

1. **Session auth**: `POST /api/auth/login` + `GET /api/auth/session` + `POST /api/auth/logout`. No rate limit. No CSRF (relies on SameSite=Lax). No `Secure` flag (OK on http local; flag for prod).
2. **RBAC gating on `/api/admin/*`** (26 endpoints; SUPER_ADMIN equality). ADMIN blocked from all — verify regression if product intends ADMIN access.
3. **Role mutation** `PUT /api/admin/users/:id/role` — only accepts `USER`/`ADMIN`; cannot set `QC` via API → FASE0-002 gap persists.
4. **Block enforcement** `PUT /api/admin/users/:id/block` — session invalidation + `/blocked` redirect.
5. **Webhook signature verification**: `/webhooks/aw` (Bearer + DB lookup) and `/webhooks/github` (HMAC SHA-256). Timing-safe compare confirmed. Behavior when secret unset = rely on fallback.
6. **Project membership gates**: `requireProjectMember` on every `/api/projects/:id/*`, task, milestone, tag, checklist write. SUPER_ADMIN bypass explicit at call sites.
7. **Dev-only `POST /__open-in-editor`**: no auth, spawns editor — gated only by `NODE_ENV !== 'production'`.
8. **MCP gate** `/mcp` — 503 when unset, 401 on mismatch. Admin vs readonly scope reflects into MCP tool surface.

### P1 — functional CRUD (RBAC + validation + status flow)

1. Projects CRUD (`/api/projects*`), incl. archive, extend, milestones, members, tags.
2. Tasks CRUD (`/api/tasks*`, `/api/checklist*`), esp. status transitions from `getAllowedTaskTransitions` (TASK vs BUG/QC).
3. GitHub link/unlink (`PATCH /api/projects/:id` with `githubRepo`) and summary/feed read paths.
4. pm-watch / AW ingestion + admin approval flow: agents, webhook-tokens, webhook-monitor panels.
5. Admin panels UX: `Users`, `Agents`, `Webhook Tokens`, `Webhook Monitor`, `Sessions`, `App Logs`, `User Logs`.
6. Notifications: read/unread/delete/read-all; `sweepDueTasks` cron creates them.
7. Evidence upload boundary (`POST /api/tasks/:id/evidence/upload`) + `GET /api/evidence/:file` auth semantics.
8. Task dependencies: same-project constraint, cycle prevention (verify).
9. Task DELETE endpoint: **possible gap** — not found via grep. Verify in Fase 3.

### P2 — visualization & developer tooling

1. ER diagram (`/dev` → Database tab, `GET /api/admin/schema`).
2. Project views (10 sub-views — API Routes, File Structure, User Flow, Data Flow, Env Map, Test Coverage, Dependencies, Migrations, Sessions, Live Requests). Auto-save to localStorage.
3. WS presence + live request broadcast to admin subscribers.
4. Click-to-source (`Ctrl+Shift+Cmd+C`) injecting `data-inspector-*` attrs.
5. Activity views: calendar, heatmap, summary.

### P3 — polish

1. Dark/light theme toggle, pre-paint `index.html` script.
2. Sidebar collapse (260↔60px) persistence on `/dev`, `/pm`, `/admin`.
3. `@mantine/modals` logout confirm dialogs on `/dev`, `/pm`, `/admin`, `/settings`.
4. Copy-to-clipboard buttons (agent ID, webhook endpoint URL, plaintext token).
5. Tooltips on collapsed sidebar buttons + live-indicator pulse dots on agents.
6. URL search-param persistence for tab state.

---

## CHANGES TO RECON

New findings / corrections to `qa/RECON.md`:

- `[FASE1-001] [LOW] [OPEN] admin_routes:missing_6_endpoints` — `GET /api/admin/routes` handler (`src/app.ts:667`) inline-lists 76 API routes; real count is 82. Missing: `POST /webhooks/github`, `GET /api/projects/:id/github/summary`, `GET /api/projects/:id/github/feed`, `POST /api/tasks/:id/evidence/upload`, `GET /api/evidence/:file`, `ALL /mcp`. Affects Dev Console → API Routes view (underrepresents GitHub + MCP + evidence surface). Documentation drift, not a security issue.
- `[FASE1-002] [LOW] [OPEN] admin_env_map:missing_7_keys` — `GET /api/admin/env-map` reports 10 keys; `src/lib/env.ts` defines 16. Missing: `MCP_SECRET`, `MCP_SECRET_ADMIN`, `PMW_WEBHOOK_TOKEN`, `PMW_EVENT_BATCH_MAX`, `GITHUB_WEBHOOK_SECRET`, `UPLOADS_DIR`, `UPLOAD_MAX_BYTES`. Dev Console → Env Variables view is incomplete.
- `[FASE1-003] [LOW] [OPEN] default_route:claude_md_stale` — `CLAUDE.md` claims SUPER_ADMIN default route is `/dev`. Actual (`useAuth.ts:14`) routes SUPER_ADMIN + ADMIN → `/admin`; USER + QC → `/pm`. `CLAUDE.md` also claims `/dashboard` and `/profile` are active tabs — both are redirect stubs in the current code. RECON §7 already flagged; reaffirmed here.
- `[FASE1-004] [MEDIUM] [OPEN] task_delete_endpoint:missing` — **CONFIRMED** (2026-04-18, Fase 1). `CLAUDE.md` and `RECON.md` both claim `DELETE /api/tasks/:id` exists (gated OWNER/PM/SUPER_ADMIN). Reality: (a) grep against `src/app.ts` finds no `.delete('/api/tasks/:id')` — only `.delete('/api/tasks/:id/dependencies/:blockedById')` at L3220; (b) live probe `curl -X DELETE -b session http://localhost:3111/api/tasks/<any-id>` returns **404** (hits Elysia not-found handler). Endpoint is **not implemented**. Candidate feature gap OR drift between docs and code. Recommend filing as a bug in Fase 3 once scope is confirmed (product decision: add endpoint, or remove DELETE from docs and document task archival pattern).
- `[FASE1-005] [INFO] [NOTED] github_webhook_logs:not_surfaced_in_admin_api` — `GithubWebhookLog` table is written by `/webhooks/github` but has no read endpoint in `/api/admin/*`. Only visible via MCP `github_webhook_logs` tool. Considered intentional.
- `[FASE1-006] [INFO] [NOTED] mcp_tools:79_total` — RECON §9 said "16 tool modules" without counts. Confirmed: 16 modules (incl. `shared.ts` helpers-only), 79 registered tools across readonly+admin scopes.
- `[FASE1-007] [INFO] [NOTED] handler_counts_reconciled` — RECON §6 said "~144 HTTP handlers". Accurate count (this phase): 82 unique method+path combos in `src/app.ts` (81 HTTP + 1 `ALL /mcp` registered as HTTP) + 1 WS. Hand-count in RECON likely counted intermediate lines that grep picked up. Use 82 henceforth.

No new BUG REGISTRY entries at P0/P1 level. Recommend filing `FASE1-004` as a product gap if Fase 3 confirms the DELETE task endpoint is missing.
