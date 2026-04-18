# Base Template

Full-stack web application template built with Bun, Elysia, React 19, and Vite.

## Tech Stack

- **Runtime**: [Bun](https://bun.com)
- **Server**: [Elysia.js](https://elysiajs.com) with Vite middleware mode (dev) / static serving (prod)
- **Frontend**: React 19 + [TanStack Router](https://tanstack.com/router) (file-based routing) + [TanStack Query](https://tanstack.com/query)
- **UI**: [Mantine v8](https://mantine.dev) (dark/light mode, auto default) + [Mantine Modals](https://mantine.dev/x/modals/) + [react-icons](https://react-icons.github.io/react-icons/)
- **Database**: PostgreSQL via [Prisma v6](https://www.prisma.io)
- **Cache/Logs**: Redis via Bun native `Bun.RedisClient`
- **Auth**: Session-based (bcrypt + HttpOnly cookies) + Google OAuth
- **Real-time**: WebSocket presence (Bun native)
- **Dev Tools**: Click-to-source inspector (Ctrl+Shift+Cmd+C), HMR, Biome linter
- **MCP**: Local MCP server (`scripts/mcp/*`) — lets Claude drive the app (tickets, admin, db, logs, dev)
- **pm-watch Integration**: ActivityWatch agent approval + webhook token management + request monitoring
- **Testing**: bun:test (unit + integration)

## Prerequisites

- [Bun](https://bun.sh) >= 1.3
- PostgreSQL running on `localhost:5432`
- Redis running on `localhost:6379`

## Setup

```bash
# Install dependencies
bun install

# Configure environment
cp .env.example .env
# Edit .env with your DATABASE_URL, REDIS_URL, Google OAuth credentials, etc.

# Setup database
bun run db:migrate
bun run db:seed
```

## Development

```bash
bun run dev
```

Server starts at `http://localhost:3000` (configurable via `PORT` in `.env`).

Features in dev mode:

- Hot Module Replacement (HMR) via Vite
- Click-to-source inspector: `Ctrl+Shift+Cmd+C` to toggle, click any component to open in editor
- Splash screen adapts to dark/light mode, prevents flash on reload

## Production

```bash
bun run build    # Build frontend with Vite
bun run start    # Start production server
```

## Scripts

| Script                     | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `bun run dev`              | Start dev server with HMR                        |
| `bun run build`            | Build frontend for production                    |
| `bun run start`            | Start production server                          |
| `bun run test`             | Run all tests                                    |
| `bun run test:unit`        | Run unit tests                                   |
| `bun run test:integration` | Run integration tests                            |
| `bun run typecheck`        | TypeScript type check                            |
| `bun run lint`             | Lint with Biome                                  |
| `bun run lint:fix`         | Lint and auto-fix                                |
| `bun run db:migrate`       | Run Prisma migrations                            |
| `bun run db:seed`          | Seed demo users                                  |
| `bun run db:studio`        | Open Prisma Studio                               |
| `bun run db:generate`      | Regenerate Prisma client                         |
| `bun run db:push`          | Push schema to DB without migration              |

## Project Structure

```
src/
  index.tsx          # Server entry — Vite middleware, frontend serving, audit log rotation
  app.ts             # Elysia app — API routes (auth, admin, logs, presence, hello, health)
  serve.ts           # Dev entry (workaround for Bun EADDRINUSE)
  vite.ts            # Vite dev server config, inspector plugin, dedupe plugin
  frontend.tsx       # React entry — root render, splash removal, HMR
  lib/
    db.ts            # Prisma client singleton
    env.ts           # Environment variables
    redis.ts         # Bun native Redis client singleton
    applog.ts        # App log module (Redis-backed ring buffer)
    presence.ts      # WebSocket presence tracker (in-memory)
  frontend/
    App.tsx           # Root component — MantineProvider, ModalsProvider, QueryClient, Router
    DevInspector.tsx  # Click-to-source overlay (dev only)
    components/
      ThemeToggle.tsx         # Shared dark/light mode toggle button
      NotFound.tsx            # 404 page
      ErrorPage.tsx           # Error boundary page
      TicketsPanel.tsx        # Shared ticket list (Dev + Dashboard, QC-scoped)
      AgentsPanel.tsx         # pm-watch agent approval dashboard
      WebhookTokensPanel.tsx  # Webhook token CRUD with show-once plaintext
      WebhookMonitorPanel.tsx # Webhook activity monitor (24h/7d stats + logs)
    hooks/
      useAuth.ts     # useSession, useLogin, useLogout, getDefaultRoute
      usePresence.ts # WebSocket presence hook (real-time online status)
    routes/
      __root.tsx     # Root layout (Outlet only)
      index.tsx      # Landing page
      login.tsx      # Login page (email/password + Google OAuth)
      dev.tsx        # Dev console — SUPER_ADMIN (users, tickets, agents, tokens, monitor, logs, DB, project)
      dashboard.tsx  # Admin dashboard — ADMIN/QC (tickets, analytics)
      profile.tsx    # User profile — all authenticated users
      blocked.tsx    # Blocked user info page
prisma/
  schema.prisma      # DB schema (User, Session, AuditLog, Ticket*, Agent, ActivityEvent, WebhookToken, WebhookRequestLog)
  seed.ts            # Seed script (superadmin, admin, user with bcrypt)
  migrations/        # Prisma migrations
tests/
  helpers.ts         # Test utilities (seedTestUser, createTestSession, cleanup)
  unit/              # Unit tests (env, db, password)
  integration/       # Integration tests (auth, health, hello API)
```

## Roles & Routing

Three roles with hierarchical access:

| Role | Default Route | Can Access | Description |
|------|--------------|------------|-------------|
| `SUPER_ADMIN` | `/dev` | `/dev`, `/dashboard`, `/profile` | Full system access, user management, logs |
| `ADMIN` | `/dashboard` | `/dashboard`, `/profile` | Dashboard access with analytics |
| `QC` | `/dashboard` | `/dashboard` (QC-scoped tickets), `/profile` | Verifies tickets in `READY_FOR_QC` state |
| `USER` | `/profile` | `/profile` | Profile only |

- Default role for new users is `USER`
- `SUPER_ADMIN` is assigned via seeder or `SUPER_ADMIN_EMAIL` env variable
- Blocked users are redirected to `/blocked` and their sessions are invalidated
- Tab state persisted in URL (`?tab=`) — survives page reload

## Auth

- **Email/password**: POST `/api/auth/login` — bcrypt verification, blocked check, creates DB session
- **Google OAuth**: GET `/api/auth/google` — redirects to Google, callback at `/api/auth/callback/google`
- **Session check**: GET `/api/auth/session` — returns current user (with role & blocked status) or 401
- **Logout**: POST `/api/auth/logout` — deletes session from DB

Demo users (seeded):

| Email | Password | Role |
|-------|----------|------|
| `superadmin@example.com` | `superadmin123` | SUPER_ADMIN |
| `admin@example.com` | `admin123` | ADMIN |
| `user@example.com` | `user123` | USER |

## Admin API

SUPER_ADMIN-only endpoints:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List all users |
| `PUT` | `/api/admin/users/:id/role` | Change user role (USER/ADMIN) |
| `PUT` | `/api/admin/users/:id/block` | Block/unblock user |
| `GET` | `/api/admin/presence` | List online user IDs |
| `GET` | `/api/admin/logs/app` | App logs (filter: level, limit, afterId) |
| `GET` | `/api/admin/logs/audit` | Audit logs (filter: userId, action, limit) |
| `DELETE` | `/api/admin/logs/app` | Clear all app logs |
| `DELETE` | `/api/admin/logs/audit` | Clear all audit logs |
| `GET` | `/api/admin/routes` | All routes metadata (method, path, auth, category) |
| `GET` | `/api/admin/project-structure` | Project files, imports, exports, line counts |
| `GET` | `/api/admin/env-map` | Environment variables map (status, usage, categories) |
| `GET` | `/api/admin/test-coverage` | Test coverage mapping (source → test files) |
| `GET` | `/api/admin/dependencies` | NPM packages graph (version, type, usage) |
| `GET` | `/api/admin/migrations` | Prisma migration timeline (changes, SQL preview) |
| `GET` | `/api/admin/sessions` | Active sessions with online status |
| `GET` | `/api/admin/agents` | List pm-watch agents with claimedBy user + event counts |
| `POST` | `/api/admin/agents/:id/approve` | Approve PENDING agent, assign to user |
| `POST` | `/api/admin/agents/:id/revoke` | Revoke APPROVED agent (reversible, events preserved) |
| `GET` | `/api/admin/webhook-tokens` | List webhook tokens (hashes never returned) |
| `POST` | `/api/admin/webhook-tokens` | Create token (plaintext shown **once** only) |
| `PATCH` | `/api/admin/webhook-tokens/:id` | Toggle ACTIVE/DISABLED or rename |
| `POST` | `/api/admin/webhook-tokens/:id/revoke` | Permanently revoke token |
| `GET` | `/api/admin/webhooks/stats` | Aggregate stats 24h/7d + perToken + perAgent |
| `GET` | `/api/admin/webhooks/logs` | Recent request logs (filter: status) |

## Tickets

Role-gated ticket tracking with a status machine:

```
OPEN → IN_PROGRESS → READY_FOR_QC → CLOSED
                           ↓
                       REOPENED → IN_PROGRESS
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tickets` | List tickets (QC users see QC-scope only) |
| `POST` | `/api/tickets` | Create new ticket |
| `GET` | `/api/tickets/:id` | Ticket detail with comments + evidence |
| `PATCH` | `/api/tickets/:id` | Update status/priority/assignee (role-gated transitions) |
| `POST` | `/api/tickets/:id/comments` | Add comment |
| `POST` | `/api/tickets/:id/evidence` | Attach evidence (url + kind) |

Frontend `TicketsPanel` is shared between Dev Console and Dashboard, filtered to QC scope for QC users.

## pm-watch Integration

ActivityWatch agents push events to `/webhooks/aw` → stored in `ActivityEvent` and attributed to the user assigned to the `Agent`.

### Webhook flow

```
AW agent ──POST /webhooks/aw──▶ verify token (DB WebhookToken or env fallback)
                                ├─ unknown agentId  → upsert Agent status=PENDING (events rejected)
                                ├─ PENDING/REVOKED  → 403
                                └─ APPROVED         → insert events (dedupe via (agentId,bucketId,eventId))
```

- **Endpoint**: `POST /webhooks/aw` — accepts `{ agentId, hostname, osUser, events: [...] }`
- **Batch cap**: `PMW_EVENT_BATCH_MAX` (default 500, returns 413 on overflow)
- **Auth precedence**: DB-backed `WebhookToken` (SHA-256 hash) > `PMW_WEBHOOK_TOKEN` env fallback
- **Agent lifecycle**: `PENDING` (first contact) → `APPROVED` (operator assigns user) → `REVOKED` (reversible)
- **Token lifecycle**: create shows plaintext ONCE → `ACTIVE` ↔ `DISABLED` (toggle) → `REVOKED` (permanent)
- **Request logging**: every call logs `WebhookRequestLog` (tokenId, agentId, statusCode, reason, eventsIn). Cleanup `WEBHOOK_LOG_RETENTION_DAYS` (default 7).

### Dev Console tabs

| Tab | Component | What it does |
|-----|-----------|--------------|
| **Agents** | `AgentsPanel.tsx` | Approve/revoke agents. Stats cards (pending/live/offline/events), pending-approval banner, live indicators (live <5m / recent <1h / stale / revoked), inline Approve CTA, disabled-confirm approve modal |
| **Webhook Tokens** | `WebhookTokensPanel.tsx` | Token CRUD. Show-once plaintext on creation, expiry presets (never/7d/30d/90d/1yr), ACTIVE/DISABLED toggle, revoke |
| **Webhook Monitor** | `WebhookMonitorPanel.tsx` | 24h/7d stats (requests/success+rate/failures/auth-fails/events), top tokens, top agents, recent-requests table with status filter |

## MCP Server

Local MCP server exposes the app to Claude Code for remote automation. Configured in `.mcp.json` (`pm-dashboard` + `playwright`).

| Tool module | Purpose |
|-------------|---------|
| `tickets` | list, get, claim, comment, add_evidence, ready_for_qc, create, close, reopen, update |
| `agents` | pm-watch agent management — list, get (readonly); approve, revoke, reassign (admin) |
| `webhooks` | Webhook token + monitoring — list tokens, stats, logs (readonly); create (plaintext once), toggle, revoke (admin) |
| `admin` | User management, role/block, sessions |
| `db` | Prisma query helpers |
| `logs` | App + audit log access |
| `code`, `project`, `dev` | Codebase introspection + editor integration |
| `redis`, `presence`, `health` | Infra checks |

- `MCP_SECRET` — grants readonly tools
- `MCP_SECRET_ADMIN` — grants write + dev automation tools
- Both empty = HTTP endpoint disabled

## WebSocket

| Endpoint | Description |
|----------|-------------|
| `WS /ws/presence` | Real-time user presence. Auth via session cookie. Broadcasts online users to admin subscribers. |

## Logging

| Type | Storage | Rotation | Description |
|------|---------|----------|-------------|
| **App Logs** | Redis List | Max 500 entries (LTRIM) | API requests, errors, auth events |
| **Audit Logs** | PostgreSQL | Auto-cleanup > 90 days | LOGIN, LOGOUT, LOGIN_FAILED, ROLE_CHANGED, BLOCKED, etc. |
| **Webhook Request Logs** | PostgreSQL | Auto-cleanup > 7 days | Every `/webhooks/aw` call (tokenId, agentId, status, reason, eventsIn) |

App + Audit logs can be viewed and manually cleared from the Dev Console (`/dev`). Dev Console log views use client-side pagination (25 per page). Webhook request logs surface in the **Webhook Monitor** tab.

## Database Schema Visualization

The Dev Console (`/dev` → Database tab) includes an interactive ER diagram powered by React Flow (`@xyflow/react`):

- Visual representation of all Prisma models, fields, enums, and relations
- Drag nodes to rearrange the layout
- Auto-save: node positions, zoom level, and pan position are persisted to `localStorage` and restored on reload
- Relation edges show field mappings and delete rules

## Project Structure Visualization

The Dev Console (`/dev` → Project tab) provides 4 interactive views:

| View | Description |
|------|-------------|
| **API Routes** | All endpoints (HTTP + WS + frontend pages) with method badges, auth levels, and flow edges showing login→redirect paths |
| **File Structure** | Project files as nodes with import dependency edges. Filter by category (Frontend/Backend/Lib/Tests). Shows line counts and export counts |
| **User Flow** | Navigation map showing role-based routing: login → auth check → blocked check → role check → destination page |
| **Data Flow** | Request lifecycle: client → server → auth → handler → DB/Redis → response. Includes WebSocket and audit logging flows |

All views use React Flow with auto-save positions and viewport per view.

### DevOps Views

| View | Description |
|------|-------------|
| **Env Variables** | All environment variables with set/unset status, required/optional badges, edges to consuming files |
| **Test Coverage** | Source files (color-coded: green/yellow/red) with edges to test files. Filter by coverage status |
| **Dependencies** | NPM packages grouped by category, edges to importing files. Filter runtime/dev |
| **Migrations** | Horizontal timeline of Prisma migrations with SQL preview and change summaries |

### Live Views

| View | Description |
|------|-------------|
| **Sessions** | Active user sessions with online status, role mapping, auto-refresh 10s |
| **Live Requests** | Real-time API request visualization via WebSocket. Hit counters, status colors, response times |

## Sidebar

- Collapsible sidebar on Dev Console and Dashboard (AppShell layout)
- Expanded: 260px with icons, labels, chevrons, user info
- Minimized: 60px icon-only bar with tooltips on hover
- State persisted in `localStorage` (`dev:sidebar`, `dashboard:sidebar`)

## Logout Confirmation

- Logout button shows a confirm modal (`@mantine/modals`) before logging out
- Applied on Dev Console, Dashboard, and Profile pages
- Blocked page logs out directly (no confirm needed)

## Dark/Light Mode

- Default follows device preference (`prefers-color-scheme`)
- Toggle integrated per-page: sidebar footer (dev/dashboard), top-right (landing/login/blocked), header bar (profile)
- Shared `ThemeToggle` component (`src/frontend/components/ThemeToggle.tsx`)
- Choice persisted in `localStorage` by Mantine
- Flash-free reload: `index.html` reads `localStorage` before first paint

## Environment Variables

| Variable                   | Required | Description                                    |
| -------------------------- | -------- | ---------------------------------------------- |
| `DATABASE_URL`             | Yes      | PostgreSQL connection string                   |
| `DIRECT_URL`               | No       | Direct PostgreSQL URL (bypasses pooler)        |
| `REDIS_URL`                | Yes      | Redis connection string                        |
| `GOOGLE_CLIENT_ID`         | Yes      | Google OAuth client ID                         |
| `GOOGLE_CLIENT_SECRET`     | Yes      | Google OAuth client secret                     |
| `SUPER_ADMIN_EMAIL`        | No       | Comma-separated emails to auto-promote         |
| `AUDIT_LOG_RETENTION_DAYS` | No       | Days to keep audit logs (default: 90)          |
| `WEBHOOK_LOG_RETENTION_DAYS` | No     | Days to keep webhook request logs (default: 7) |
| `PMW_WEBHOOK_TOKEN`        | No       | Fallback webhook auth when no DB tokens active |
| `PMW_EVENT_BATCH_MAX`      | No       | Max events per webhook batch (default: 500)    |
| `PORT`                     | No       | Server port (default: 3000)                    |
| `REACT_EDITOR`             | No       | Editor for click-to-source (default: code)     |
| `MCP_SECRET`               | No       | Grants readonly MCP tools (HTTP `POST /mcp`)   |
| `MCP_SECRET_ADMIN`         | No       | Grants write + dev automation MCP tools        |
| `TELEGRAM_NOTIFY_TOKEN`    | No       | Bot token for task-done notifications          |
| `TELEGRAM_NOTIFY_CHAT_ID`  | No       | Chat ID for Telegram notifications             |
