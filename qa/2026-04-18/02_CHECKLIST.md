# 02_CHECKLIST — pm-dashboard QA session 2026-04-18

Session: `qa/2026-04-18` • Git HEAD: `e9cc74e811edbd9dcee890af7233125970cc834d` (branch `main`)
Base URL: `http://localhost:3111`
Inputs used: `qa/RECON.md`, `qa/2026-04-18/SESSION.md`, `qa/2026-04-18/INTERNAL_CHECK.md`, `qa/2026-04-18/01_SITEMAP.md`
Cookies (valid ~24h Max-Age=86400): `qa/2026-04-18/cookies/{superadmin,admin,user}.txt`
Author: QA Fase 2 CHECKLIST agent (Claude Opus 4.7), 2026-04-18

---

## Summary

| Channel | TC count | P0 | P1 | P2 | P3 |
| ------- | -------: | -: | -: | -: | -: |
| CH-1 Static          | 6   | 3  | 2  | 1  | 0  |
| CH-2 API             | 148 | 58 | 64 | 22 | 4  |
| CH-3 UI/UX           | 46  | 10 | 24 | 9  | 3  |
| CH-4 DB              | 20  | 8  | 10 | 2  | 0  |
| CH-5 Security        | 28  | 18 | 8  | 2  | 0  |
| CH-6 Consistency     | 12  | 0  | 4  | 6  | 2  |
| **Total**            | **260** | **97** | **112** | **42** | **9** |

### Execution order (Fase 3)

1. **CH-1 Static** (fast, zero-side-effect) → gate: STATIC-001/002/003 must pass before CH-2/3.
2. **CH-2 API** block 2.1 Auth → 2.2 Admin → 2.3 Projects → 2.4 Tasks → 2.5 Activity/Me → 2.6 Webhooks → 2.7 MCP/Util
3. **CH-4 DB** runs alongside CH-2 writes (same probes use Prisma direct queries).
4. **CH-5 Security** after auth verified by CH-2 block 2.1.
5. **CH-3 UI/UX** last (depends on fixtures created by CH-2 writes).
6. **CH-6 Consistency** pure docs-vs-code diff, run anytime.

### Must-pass gates (stop-the-line if any P0 fails)

- STATIC-001 `bun run typecheck` → exit 0
- STATIC-003 `bun run build` → exit 0
- API-0001 SUPER_ADMIN login
- API-0011 Cookie-based session handshake
- API-0040 ADMIN denied on `/api/admin/users` (RBAC floor)
- SEC-001 Webhook GitHub signature verification
- SEC-005 Blocked-user session invalidation

### Known defects pre-loaded (carry-over from Fase 1)

Each has a dedicated TC so Fase 3 classifies them as **Known defect** rather than new bugs:

| TC ID      | Finding     | Expected in Fase 3 |
| ---------- | ----------- | ------------------ |
| API-0078   | FASE1-004 `DELETE /api/tasks/:id` returns 404 | **FAIL** (known gap) |
| CONS-003   | FASE1-001 `/api/admin/routes` missing 6 entries | **FAIL** (drift) |
| CONS-004   | FASE1-002 `/api/admin/env-map` missing 7 keys | **FAIL** (drift) |
| CONS-005   | FASE1-003 CLAUDE.md default-route table vs `useAuth.ts` | **FAIL** (drift) |
| API-0034   | FASE0-002 `PUT /api/admin/users/:id/role` rejects `QC` | **FAIL by design** — document |
| SEC-002    | FASE0-003 cookie missing `Secure` (prod posture) | **INFO** on localhost |

---

## Priority legend

- **P0** — auth, RBAC, data integrity, money/identity path. A P0 fail = stop-the-line.
- **P1** — CRUD correctness, core workflows (projects/tasks/webhooks).
- **P2** — ergonomics, visualizations, dev-console panels.
- **P3** — polish (dark mode, sidebar collapse, tooltips).

## Role matrix used throughout

| Role        | Cookie file                        | Seeded | Default route (code) |
| ----------- | ---------------------------------- | ------ | -------------------- |
| SUPER_ADMIN | `cookies/superadmin.txt`           | yes    | `/admin`             |
| ADMIN       | `cookies/admin.txt`                | yes    | `/admin`             |
| USER        | `cookies/user.txt`                 | yes    | `/pm`                |
| QC          | **not seeded** — promote via DB    | no     | `/pm`                |
| anon        | no cookie                          | n/a    | `/` → `/login`       |

For QC rows, Fase 3 must either (a) `UPDATE "User" SET role='QC' WHERE email='qc@test.local'` after inserting, and save `cookies/qc.txt`, or (b) mark `SKIPPED — QC not seeded (FASE0-002)`.

---

## CH-1 Static

| TC ID      | Subject               | Command / Probe                          | Expected                                     | Priority |
| ---------- | --------------------- | ---------------------------------------- | -------------------------------------------- | -------- |
| STATIC-001 | Typecheck clean       | `bun run typecheck`                      | exit 0                                        | P0 |
| STATIC-002 | Lint clean            | `bun run lint`                           | exit 0 (Biome)                                | P0 |
| STATIC-003 | Build succeeds        | `bun run build`                          | exit 0, Vite bundle produced under `dist/`    | P0 |
| STATIC-004 | Unit tests pass       | `bun run test:unit`                      | exit 0                                        | P1 |
| STATIC-005 | Integration tests pass| `bun run test:integration`               | exit 0 (note: incl. `tests/integration/webhooks-aw.test.ts` new file) | P1 |
| STATIC-006 | Prisma schema valid   | `bunx prisma validate`                   | exit 0                                        | P2 |

---

## CH-2 API

Test-vector convention: `curl -s -o /dev/null -w '%{http_code}' -b cookies/<role>.txt METHOD http://localhost:3111<PATH>` unless noted. Bodies inline. All expectations measured after Fase 0 baseline state (4 users, 2 projects, 2 tasks, 6 agents, 6 tokens) + any fixtures created earlier in CH-2.

### 2.1 Auth — `/api/auth/*`

| TC ID    | METHOD PATH                          | Role / Input                              | Expected                                               | Notes                              | Priority |
| -------- | ------------------------------------ | ----------------------------------------- | ------------------------------------------------------ | ---------------------------------- | -------- |
| API-0001 | POST `/api/auth/login`               | valid SUPER_ADMIN creds                   | 200, `Set-Cookie: session=…; HttpOnly; SameSite=Lax`   | already proven Fase 0              | P0 |
| API-0002 | POST `/api/auth/login`               | valid ADMIN creds                         | 200, session cookie                                    |                                    | P0 |
| API-0003 | POST `/api/auth/login`               | valid USER creds                          | 200, session cookie                                    |                                    | P0 |
| API-0004 | POST `/api/auth/login`               | unknown email                             | 401 `{error:"Invalid credentials"}`, `LOGIN_FAILED` audit | verify audit row              | P0 |
| API-0005 | POST `/api/auth/login`               | valid email + wrong password              | 401, `LOGIN_FAILED` audit                              |                                    | P0 |
| API-0006 | POST `/api/auth/login`               | empty body `{}`                            | 400 validation error                                  |                                    | P1 |
| API-0007 | POST `/api/auth/login`               | blocked user creds                        | 403, `LOGIN_BLOCKED` audit                             | requires block step first          | P0 |
| API-0008 | POST `/api/auth/login`               | SQL payload `email=' OR 1=1--`            | 401 (no user leak)                                     | CH-5 cross-ref SEC-008             | P0 |
| API-0009 | GET  `/api/auth/session`             | SUPER_ADMIN cookie                        | 200 `{user:{role:"SUPER_ADMIN",blocked:false}}`        | Fase 0 proven                      | P0 |
| API-0010 | GET  `/api/auth/session`             | ADMIN cookie                              | 200 `{user:{role:"ADMIN"}}`                            |                                    | P0 |
| API-0011 | GET  `/api/auth/session`             | USER cookie                               | 200 `{user:{role:"USER"}}`                             |                                    | P0 |
| API-0012 | GET  `/api/auth/session`             | anon / no cookie                          | 401                                                    |                                    | P0 |
| API-0013 | GET  `/api/auth/session`             | tampered cookie `session=deadbeef`         | 401                                                    |                                    | P0 |
| API-0014 | GET  `/api/auth/session`             | expired cookie (manually set `expiresAt` past via DB) | 401 + session row auto-deleted     | SQL: `UPDATE "session" SET expires_at=NOW()-INTERVAL '1 day' WHERE token=...` | P0 |
| API-0015 | POST `/api/auth/logout`              | SUPER_ADMIN cookie                        | 200, subsequent session GET → 401                      | must re-login before other TCs     | P0 |
| API-0016 | POST `/api/auth/logout`              | anon                                      | 200 (idempotent) or 401 (document behavior observed)   |                                    | P1 |
| API-0017 | GET  `/api/auth/google`              | anon                                      | 302 to `accounts.google.com`                           | Location header regex match        | P1 |
| API-0018 | GET  `/api/auth/callback/google`     | missing `code`                            | 400 or 302 to `/login?error=...`                       |                                    | P1 |
| API-0019 | GET  `/api/auth/callback/google`     | invalid `code=fakecode`                   | 400/401 (google exchange failure), no user upsert      | verify DB count stable              | P1 |

### 2.2 Admin API — `/api/admin/*` (SUPER_ADMIN only)

Access matrix test — for each route, test (a) SUPER_ADMIN → expected success, (b) ADMIN → 403, (c) USER → 403, (d) anon → 401. Condensed as ONE row per route with the 4-cell matrix rather than 4 rows. RBAC floor proven in Fase 0 for `/api/admin/users`.

| TC ID    | METHOD PATH                                   | SUPER_ADMIN | ADMIN | USER | anon | Notes                                            | Priority |
| -------- | --------------------------------------------- | ----------- | ----- | ---- | ---- | ------------------------------------------------ | -------- |
| API-0030 | GET `/api/admin/users`                        | 200 (≥4)    | 403   | 403  | 401  | Fase 0 proven                                    | P0 |
| API-0031 | GET `/api/admin/presence`                     | 200 (array) | 403   | 403  | 401  |                                                  | P1 |
| API-0032 | GET `/api/admin/logs/app`                     | 200 (≤500)  | 403   | 403  | 401  | Redis smoke (INTERNAL_CHECK gap 3)               | P0 |
| API-0033 | GET `/api/admin/logs/audit`                   | 200         | 403   | 403  | 401  | `?limit=10`                                      | P0 |
| API-0034 | PUT `/api/admin/users/:id/role` body `{role:"QC"}` | **400** (whitelist rejects QC)     | 403   | 403  | 401  | **Known defect FASE0-002** — documents that API cannot set QC | P0 |
| API-0035 | PUT `/api/admin/users/:id/role` body `{role:"ADMIN"}` target=USER | 200, user now ADMIN | 403 | 403 | 401 | Follow with revert to USER | P0 |
| API-0036 | PUT `/api/admin/users/:id/role` target=self  | 400 / 403 (self-change prevented)  | 403   | 403  | 401  | SUPER_ADMIN cannot demote self                   | P0 |
| API-0037 | PUT `/api/admin/users/:id/role` target=SUPER_ADMIN user, body `{role:"USER"}` | 400 (SUPER_ADMIN target blocked) | 403 | 403 | 401 | Can't demote other SUPER_ADMIN | P0 |
| API-0038 | PUT `/api/admin/users/:id/block` body `{blocked:true}` target=USER | 200, user.blocked=true, sessions deleted | 403 | 403 | 401 | DB: count Session rows for userId = 0 | P0 |
| API-0039 | PUT `/api/admin/users/:id/block` body `{blocked:false}` target=USER | 200, user unblocked | 403 | 403 | 401 | restore state | P0 |
| API-0040 | PUT `/api/admin/users/:id/block` target=self | 400                                | 403   | 403  | 401  | Self-block prevented                             | P0 |
| API-0041 | DELETE `/api/admin/logs/app`                  | 200 wipes Redis list               | 403   | 403  | 401  | CH-4 cross: LLEN app:logs = 0 after             | P1 |
| API-0042 | DELETE `/api/admin/logs/audit`                | 200 truncates table                | 403   | 403  | 401  | DB: `SELECT count(*) FROM audit_log` = 0        | P1 |
| API-0043 | GET `/api/admin/schema`                       | 200 (models≥22, enums≥11)         | 403   | 403  | 401  | `parseSchema` correctness                        | P1 |
| API-0044 | GET `/api/admin/routes`                       | 200 (76 entries — **drift**)       | 403   | 403  | 401  | Known CONS-003; expect 76 not 82                | P1 |
| API-0045 | GET `/api/admin/project-structure`            | 200                                | 403   | 403  | 401  |                                                  | P1 |
| API-0046 | GET `/api/admin/env-map`                      | 200 (10 keys — **drift**)          | 403   | 403  | 401  | Known CONS-004; expect 10 not 16                 | P1 |
| API-0047 | GET `/api/admin/test-coverage`                | 200                                | 403   | 403  | 401  |                                                  | P2 |
| API-0048 | GET `/api/admin/dependencies`                 | 200                                | 403   | 403  | 401  |                                                  | P2 |
| API-0049 | GET `/api/admin/migrations`                   | 200 (empty in this repo — db-push) | 403   | 403  | 401  |                                                  | P2 |
| API-0050 | GET `/api/admin/sessions`                     | 200                                | 403   | 403  | 401  | Verify online flag ↔ /ws/presence state          | P1 |
| API-0051 | GET `/api/admin/agents`                       | 200 (≥6)                           | 403   | 403  | 401  |                                                  | P1 |
| API-0052 | POST `/api/admin/agents/:id/approve`          | 200 (if PENDING)                   | 403   | 403  | 401  | Pick a PENDING agent; verify AgentStatus=APPROVED | P1 |
| API-0053 | POST `/api/admin/agents/:id/approve`          | 400/409 if not PENDING             | —     | —    | —    | Idempotency check                                | P1 |
| API-0054 | POST `/api/admin/agents/:id/revoke`           | 200 (if APPROVED)                  | 403   | 403  | 401  | Status=REVOKED; events preserved                 | P1 |
| API-0055 | POST `/api/admin/agents/:id/approve` nonexistent id=`nope` | 404 | 403 | 403 | 401 |                                                  | P1 |
| API-0056 | GET `/api/admin/webhook-tokens`               | 200, **no `tokenHash` in response**| 403   | 403  | 401  | CH-5 cross SEC-010                               | P0 |
| API-0057 | POST `/api/admin/webhook-tokens`              | 200, plaintext `whk_…` returned ONCE | 403 | 403  | 401  | Record token for API-0070+                       | P1 |
| API-0058 | PATCH `/api/admin/webhook-tokens/:id` body `{status:"DISABLED"}` | 200 | 403 | 403 | 401 |                                    | P1 |
| API-0059 | PATCH `/api/admin/webhook-tokens/:id` body `{name:"renamed"}` | 200 | 403   | 403  | 401  |                                                  | P1 |
| API-0060 | DELETE `/api/admin/webhook-tokens/:id`        | 200 (terminal REVOKED)             | 403   | 403  | 401  | DB: status=REVOKED                              | P1 |
| API-0061 | GET `/api/admin/webhooks/stats`               | 200 (24h+7d aggregates)            | 403   | 403  | 401  | Shape: `{perToken:[], perAgent:[]}`              | P1 |
| API-0062 | GET `/api/admin/webhooks/logs?status=all`     | 200                                | 403   | 403  | 401  |                                                  | P1 |
| API-0063 | GET `/api/admin/webhooks/logs?status=fail`    | 200, all rows statusCode≥400        | —     | —    | —    | filter correctness                               | P1 |
| API-0064 | GET `/api/admin/webhooks/logs?status=auth`    | 200, all rows reason ∋ "auth" or 401/403 | —  | —    | —    |                                                  | P1 |

### 2.3 Projects & Milestones

| TC ID    | METHOD PATH                                       | Role / Precondition                    | Expected                                               | Notes                         | Priority |
| -------- | ------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ | ----------------------------- | -------- |
| API-0100 | GET `/api/users`                                  | USER cookie                            | 200 (array, lightweight)                               |                               | P1 |
| API-0101 | GET `/api/users`                                  | anon                                   | 401                                                    |                               | P1 |
| API-0102 | GET `/api/projects`                               | SUPER_ADMIN                            | 200, all 2 baseline projects visible                   |                               | P1 |
| API-0103 | GET `/api/projects`                               | USER (not a member of any project)      | 200, `[]` (empty — scoped to membership)               |                               | P0 |
| API-0104 | GET `/api/projects`                               | anon                                   | 401                                                    |                               | P0 |
| API-0105 | POST `/api/projects` body `{name:"QA-P1"}`        | USER                                   | 200, creator becomes OWNER (ProjectMember row)         | save id as `$P1`              | P0 |
| API-0106 | POST `/api/projects` body `{}`                    | USER                                   | 400 validation                                         |                               | P1 |
| API-0107 | GET `/api/projects/$P1`                           | owner (USER)                           | 200, `myRole:"OWNER"`                                  |                               | P0 |
| API-0108 | GET `/api/projects/$P1`                           | non-member ADMIN                       | 403 (project-member gate)                              | ADMIN has no global bypass    | P0 |
| API-0109 | GET `/api/projects/$P1`                           | SUPER_ADMIN                            | 200 (bypass)                                           |                               | P0 |
| API-0110 | GET `/api/projects/nonexistent-id`                | SUPER_ADMIN                            | 404                                                    |                               | P1 |
| API-0111 | PATCH `/api/projects/$P1` body `{name:"P1-new"}`  | OWNER (USER)                           | 200                                                    |                               | P1 |
| API-0112 | PATCH `/api/projects/$P1` body `{status:"ON_HOLD"}` | MEMBER (added via API-0120)          | 403 (project-write gate)                               |                               | P1 |
| API-0113 | PATCH `/api/projects/$P1` body `{githubRepo:"https://github.com/foo/bar.git"}` | OWNER | 200, stored as `foo/bar`                  | normalization                 | P1 |
| API-0114 | PATCH `/api/projects/$P1` body `{githubRepo:"foo/bar"}` (already taken)| another project OWNER | 409 duplicate link | unique constraint               | P1 |
| API-0115 | PATCH `/api/projects/$P1` body `{githubRepo:null}` | OWNER                                 | 200, unlinked                                          |                               | P1 |
| API-0116 | PATCH `/api/projects/$P1` body `{githubRepo:"not-a-repo"}` | OWNER                          | 400 normalization fail                                 |                               | P1 |
| API-0117 | DELETE `/api/projects/$P1`                        | non-owner ADMIN (not member)           | 403                                                    |                               | P0 |
| API-0118 | DELETE `/api/projects/$P1`                        | OWNER                                  | 200, project + cascade children gone                   | CH-4 cross DB-004             | P0 |
| API-0119 | POST `/api/projects/$P2/members` body `{userId:$adminId,role:"MEMBER"}` | OWNER | 200                                 | uses different project `$P2`  | P1 |
| API-0120 | POST `/api/projects/$P2/members` duplicate        | OWNER                                  | 409 unique `(projectId,userId)`                        | CH-4 cross DB-005             | P1 |
| API-0121 | DELETE `/api/projects/$P2/members/$adminId`       | OWNER                                  | 200                                                    |                               | P1 |
| API-0122 | DELETE `/api/projects/$P2/members/$adminId`       | PM (not owner)                         | 403 (owner-only)                                       |                               | P1 |
| API-0123 | POST `/api/projects/$P2/extend` body `{newEndAt:"2026-12-31",reason:"scope"}` | OWNER | 200, `ProjectExtension` row + `Project.endsAt` updated | CH-4 cross DB-006 | P1 |
| API-0124 | GET `/api/projects/$P2/extensions`                | member                                 | 200 array                                              |                               | P2 |
| API-0125 | GET `/api/milestones`                             | USER                                   | 200 (cross-project for memberships)                    |                               | P1 |
| API-0126 | GET `/api/projects/$P2/milestones`                | member                                 | 200                                                    |                               | P1 |
| API-0127 | POST `/api/projects/$P2/milestones` body `{title:"M1",dueAt:"2026-05-01"}` | project-write | 200 | save id `$M1`                 | P1 |
| API-0128 | POST `/api/projects/$P2/milestones`               | MEMBER (read-only)                     | 403                                                    |                               | P1 |
| API-0129 | PATCH `/api/milestones/$M1` body `{completedAt:"2026-04-20T00:00Z"}` | project-write | 200           |                               | P1 |
| API-0130 | DELETE `/api/milestones/$M1`                      | project-write                          | 200                                                    |                               | P1 |
| API-0131 | GET `/api/projects/$P2/github/summary`            | member                                 | 200, `{linked:false}` if no githubRepo, else stats     | FASE1-001 missing from routes-meta | P1 |
| API-0132 | GET `/api/projects/$P2/github/feed?limit=5`       | member                                 | 200 array (≤5)                                         |                               | P1 |

### 2.4 Tasks & Tags & Checklists

Fixtures: create `$P2`-scoped task `$T1` (kind=TASK, assignee=USER).

| TC ID    | METHOD PATH                                   | Role / Precondition              | Expected                                               | Notes                                        | Priority |
| -------- | --------------------------------------------- | -------------------------------- | ------------------------------------------------------ | -------------------------------------------- | -------- |
| API-0060b | GET `/api/tasks?projectId=$P2`               | member                           | 200 array with `actualHours`, `progressPercent`, `tags`| enrichment present                           | P1 |
| API-0061b | GET `/api/tasks?projectId=$P2`               | non-member                       | 200 `[]` (filtered) or 403 — document                  | verify scoping                               | P0 |
| API-0062b | GET `/api/tasks?mine=1`                      | USER                             | 200, all rows where `assigneeId=$userId`               |                                              | P1 |
| API-0063b | GET `/api/tasks?projectId=$P2&status=INVALID`| member                           | 400 or 200 `[]` — document                             |                                              | P2 |
| API-0064b | POST `/api/tasks` body `{projectId:$P2, title:"T1", kind:"TASK"}` | member | 200, Task row, `reporter=current` | save `$T1`                             | P0 |
| API-0065b | POST `/api/tasks` body `{projectId:$P2, title:""}` | member                     | 400                                                    |                                              | P1 |
| API-0066b | POST `/api/tasks`                            | anon                             | 401                                                    |                                              | P0 |
| API-0067b | POST `/api/tasks` body foreign `projectId`   | USER not in that project         | 403                                                    |                                              | P0 |
| API-0068b | POST `/api/tasks` with `tagIds:[fakeId]`     | member                           | 400 or 404 (tag not in project)                        |                                              | P1 |
| API-0069b | GET `/api/tasks/$T1`                         | member                           | 200, full detail (comments, checklist, statusChanges)  |                                              | P1 |
| API-0070b | GET `/api/tasks/$T1`                         | non-member                       | 403                                                    |                                              | P0 |
| API-0071b | PATCH `/api/tasks/$T1` body `{status:"IN_PROGRESS"}` | member                   | 200, TaskStatusChange row written                      | CH-4 cross DB-010                            | P1 |
| API-0072b | PATCH `/api/tasks/$T1` body `{status:"READY_FOR_QC"}` TASK-kind | member        | 400 (TASK-kind can't go directly to READY_FOR_QC)       | `getAllowedTaskTransitions` for TASK lacks this path | P1 |
| API-0073b | PATCH `/api/tasks/$T1` body `{status:"CLOSED"}` | member                         | 200, `closedAt` set, `progressPercent=100`             | computed on GET                              | P1 |
| API-0074b | PATCH `/api/tasks/$T1` body `{status:"OPEN"}` (from CLOSED) | member               | 400 (allowed only REOPENED from CLOSED)                |                                              | P1 |
| API-0075b | PATCH `/api/tasks/$T1` body `{status:"REOPENED"}` (from CLOSED) | member           | 200                                                    |                                              | P1 |
| API-0076b | PATCH `/api/tasks/$T1` body `{assigneeId:adminId}` | member, admin also member  | 200, Notification row for assignee                     | CH-4 cross DB-011                            | P1 |
| API-0077b | PATCH `/api/tasks/$T1` XSS `title:"<script>alert(1)</script>"` | member           | 200, stored as-is                                      | CH-5 cross SEC-014 asserts no UI exec        | P0 |
| API-0078 | **DELETE `/api/tasks/$T1`**                  | OWNER                            | **404 (Known defect FASE1-004)** — endpoint missing    | docs claim OWNER/PM/SUPER_ADMIN should succeed | P0 (known FAIL) |
| API-0079b | DELETE `/api/tasks/$T1`                      | SUPER_ADMIN                      | 404 (same — FASE1-004)                                 |                                              | P0 (known FAIL) |
| API-0080b | POST `/api/tasks/$T1/comments` body `{body:"hi"}` | member                      | 200, Notification rows for reporter+assignee            |                                              | P1 |
| API-0081b | POST `/api/tasks/$T1/comments` XSS `body:"<img src=x onerror=alert(1)>"` | member | 200, stored as-is                         | CH-5 cross SEC-015                           | P0 |
| API-0082b | POST `/api/tasks/$T1/evidence` body `{kind:"URL",url:"https://ex.com"}` | member | 200                                   |                                              | P2 |
| API-0083b | POST `/api/tasks/$T1/evidence/upload` multipart (file 1KB text) | member | 200, file in `UPLOADS_DIR`, path returned          | FASE1-001 missing from routes-meta            | P1 |
| API-0084b | POST `/api/tasks/$T1/evidence/upload` file 11MiB | member                        | 413 (exceeds `UPLOAD_MAX_BYTES=10*1024*1024`)          |                                              | P1 |
| API-0085b | POST `/api/tasks/$T1/evidence/upload` file with `../traversal.txt` name | member | 200 with **safe** stored filename (no traversal) | CH-5 cross SEC-017                        | P0 |
| API-0086b | GET `/api/evidence/:file` valid file          | member                           | 200 binary / text                                      | auth semantics TBD (FASE1)                   | P1 |
| API-0087b | GET `/api/evidence/:file` anon                | anon                             | 401                                                    | CH-5 cross SEC-018                           | P0 |
| API-0088b | GET `/api/evidence/../etc/passwd`             | SUPER_ADMIN                      | 400 or 404 — NOT 200 host file                         | CH-5 cross SEC-019                           | P0 |
| API-0089b | POST `/api/projects/$P2/tags` body `{name:"urgent",color:"#f00"}` | project-write | 200, save `$TAG1`                  |                                              | P2 |
| API-0090b | POST `/api/projects/$P2/tags` duplicate name  | project-write                    | 409 unique `(projectId,name)`                          | CH-4 DB-012                                  | P2 |
| API-0091b | PATCH `/api/tags/$TAG1` body `{name:"urgent-v2"}` | project-write                | 200                                                    |                                              | P2 |
| API-0092b | DELETE `/api/tags/$TAG1`                      | project-write                    | 200, TaskTag rows cascade-deleted                      | CH-4 DB-013                                  | P2 |
| API-0093b | POST `/api/tasks/$T1/dependencies` body `{blockedById:$T2}` | member              | 200                                                    | need 2nd task $T2 in same project            | P1 |
| API-0094b | POST `/api/tasks/$T1/dependencies` body `{blockedById:$Tforeign}` | member        | 400 (cross-project forbidden)                          |                                              | P1 |
| API-0095b | POST `/api/tasks/$T1/dependencies` body `{blockedById:$T1}` (self) | member       | 400 (self-block forbidden)                             |                                              | P1 |
| API-0096b | POST `/api/tasks/$T1/dependencies` cycle ($T1→$T2, $T2→$T1) | member             | 400 cycle prevention OR allowed (document)              | verify policy                                | P1 |
| API-0097b | DELETE `/api/tasks/$T1/dependencies/$T2`      | member                           | 200                                                    |                                              | P2 |
| API-0098b | POST `/api/tasks/$T1/checklist` body `{title:"step1"}` | member                 | 200, save `$CL1`                                        |                                              | P2 |
| API-0099b | PATCH `/api/checklist/$CL1` body `{done:true}`| member                           | 200, progressPercent on parent task updates             | CH-6 cross-check                             | P2 |
| API-0100b | DELETE `/api/checklist/$CL1`                  | member                           | 200                                                    |                                              | P2 |

### 2.5 Activity + Me

| TC ID    | METHOD PATH                                | Role                                   | Expected                                    | Priority |
| -------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------- | -------- |
| API-0140 | GET `/api/activity/agents`                 | USER (no claim)                        | 200 `[]`                                    | P1 |
| API-0141 | GET `/api/activity/agents`                 | SUPER_ADMIN                            | 200 (≥6, admin expand)                      | P1 |
| API-0142 | GET `/api/activity?limit=5`                | USER                                   | 200 ≤5                                      | P1 |
| API-0143 | GET `/api/activity?bucketId=`foo`&limit=5` | USER                                   | 200                                         | P2 |
| API-0144 | GET `/api/activity/calendar?month=2026-04` | USER                                   | 200, per-day counts                         | P2 |
| API-0145 | GET `/api/activity/heatmap?year=2026`      | USER                                   | 200, per-day counts                         | P2 |
| API-0146 | GET `/api/activity/summary`                | USER                                   | 200 `{today,week,topApps,topWindows}`       | P2 |
| API-0147 | GET `/api/activity`                        | anon                                   | 401                                         | P0 |
| API-0148 | GET `/api/me/agents`                       | USER                                   | 200                                         | P1 |
| API-0149 | GET `/api/me/notifications?limit=5`        | USER                                   | 200 array                                   | P1 |
| API-0150 | GET `/api/me/notifications?unread=1`       | USER                                   | 200, all `readAt=null`                      | P1 |
| API-0151 | GET `/api/me/notifications/unread-count`   | USER                                   | 200 `{count:N}`                             | P2 |
| API-0152 | POST `/api/me/notifications/:id/read`      | USER (own id)                          | 200, `readAt` set                           | P1 |
| API-0153 | POST `/api/me/notifications/:id/read`      | USER (foreign id)                      | 404/403                                     | P0 |
| API-0154 | POST `/api/me/notifications/read-all`      | USER                                   | 200, all own notifications marked read      | P1 |
| API-0155 | DELETE `/api/me/notifications/:id`         | USER (own)                             | 200                                         | P1 |
| API-0156 | DELETE `/api/me/notifications/:id`         | USER (foreign)                         | 404/403                                     | P0 |

### 2.6 Webhooks

| TC ID    | METHOD PATH                | Auth posture                                  | Expected                                           | Priority |
| -------- | -------------------------- | --------------------------------------------- | -------------------------------------------------- | -------- |
| API-0170 | POST `/webhooks/aw`        | no `Authorization` header                     | 401 `{reason:"missing_token"}`, log row created     | P0 |
| API-0171 | POST `/webhooks/aw`        | `Authorization: Bearer bogus`                 | 403 `{reason:"invalid_token"}`                     | P0 |
| API-0172 | POST `/webhooks/aw`        | disabled token (from API-0058)                | 403 `{reason:"disabled"}`                          | P0 |
| API-0173 | POST `/webhooks/aw`        | revoked token (from API-0060)                 | 403 `{reason:"revoked"}`                           | P0 |
| API-0174 | POST `/webhooks/aw`        | valid token, new agentId                      | 200, Agent row auto-created PENDING, events=0 ingested | P1 |
| API-0175 | POST `/webhooks/aw`        | valid token, PENDING agent, events=1          | 200 but events dropped until APPROVED              | P1 |
| API-0176 | POST `/webhooks/aw`        | valid token, APPROVED agent, events=1         | 200, ActivityEvent row created                     | P0 |
| API-0177 | POST `/webhooks/aw`        | same `(agentId,bucketId,eventId)` replayed    | 200, deduped (no duplicate row)                    | P0 |
| API-0178 | POST `/webhooks/aw`        | events=501 (above `PMW_EVENT_BATCH_MAX=500`)  | 413                                                 | P0 |
| API-0179 | POST `/webhooks/aw`        | malformed JSON                                | 400                                                | P1 |
| API-0180 | POST `/webhooks/github`    | missing `X-Hub-Signature-256`                 | 401                                                | P0 |
| API-0181 | POST `/webhooks/github`    | invalid HMAC                                   | 401                                                | P0 |
| API-0182 | POST `/webhooks/github`    | valid HMAC + `ping` event                     | 200 `{pong:true}`                                  | P0 |
| API-0183 | POST `/webhooks/github`    | valid HMAC + `push` event, repo not linked    | 404                                                | P1 |
| API-0184 | POST `/webhooks/github`    | valid HMAC + `push` event, repo linked        | 200 `{inserted:N}`, ProjectGithubEvent rows        | P1 |
| API-0185 | POST `/webhooks/github`    | valid HMAC + duplicate delivery (same sha/prNumber) | 200, no duplicate row (unique key)            | P1 |
| API-0186 | POST `/webhooks/github`    | valid HMAC + `pull_request` action=opened     | 200, PR_OPENED row                                  | P1 |
| API-0187 | POST `/webhooks/github`    | valid HMAC + `pull_request` action=closed merged=true | 200, PR_MERGED row                          | P1 |
| API-0188 | POST `/webhooks/github`    | valid HMAC + `pull_request_review`            | 200, PR_REVIEWED row                                | P1 |

### 2.7 MCP + Utility + Frontend landing

| TC ID    | METHOD PATH            | Auth                                           | Expected                                  | Priority |
| -------- | ---------------------- | ---------------------------------------------- | ----------------------------------------- | -------- |
| API-0200 | GET `/health`          | public                                         | 200 `{status:"ok"}`                       | P0 |
| API-0201 | GET `/api/hello`       | public                                         | 200                                       | P3 |
| API-0202 | PUT `/api/hello`       | public                                         | 200                                       | P3 |
| API-0203 | GET `/api/hello/claude`| public                                         | 200 echoes name                           | P3 |
| API-0204 | ALL `/mcp`             | `MCP_SECRET` unset                             | 503                                        | P0 |
| API-0205 | ALL `/mcp`             | wrong Bearer                                   | 401                                        | P0 |
| API-0206 | ALL `/mcp`             | `Bearer $MCP_SECRET` readonly list tools       | 200, `x-mcp-scope: readonly` header       | P1 |
| API-0207 | ALL `/mcp`             | `Bearer $MCP_SECRET_ADMIN` writes allowed      | 200, `x-mcp-scope: admin`                 | P1 |
| API-0208 | POST `/__open-in-editor` | anon, NODE_ENV=development                   | 200 (spawns editor — **no auth** in dev)  | P0 |
| API-0209 | POST `/__open-in-editor` | anon, NODE_ENV=production (doc posture only)  | 404 (endpoint omitted in prod path)       | P1 |

---

## CH-3 UI/UX

Uses Playwright MCP. Each navigation starts from a clean browser context and loads the stored cookie for the intended role. Screenshots saved to `qa/2026-04-18/screens/UI-XXX.png`.

| TC ID  | Route                     | Role            | Check                                                  | Expected                                                     | Priority |
| ------ | ------------------------- | --------------- | ------------------------------------------------------ | ------------------------------------------------------------ | -------- |
| UI-001 | `/`                       | anon            | loads landing with theme toggle                         | 200, no JS errors in console                                 | P2 |
| UI-002 | `/`                       | SUPER_ADMIN     | "Continue" CTA routes to default landing                | click → lands on `/admin`                                    | P2 |
| UI-003 | `/login`                  | anon            | form renders email + password + Google OAuth button     | all three visible; no console errors                         | P1 |
| UI-004 | `/login` submit valid     | anon            | SUPER_ADMIN creds submitted                              | redirect to `/admin` (per useAuth.ts)                        | P0 |
| UI-005 | `/login` submit invalid   | anon            | bad password                                            | inline error "Invalid credentials"                            | P1 |
| UI-006 | `/login`                  | already signed in | page redirects away                                   | → `getDefaultRoute(role)` (SUPER_ADMIN/ADMIN → `/admin`; USER/QC → `/pm`) | P1 |
| UI-007 | `/blocked`                | blocked session | shows explanation + direct logout                        | logout button works, no confirm modal                        | P0 |
| UI-008 | `/profile`                | any             | redirects to `/settings`                                 | Location: /settings                                          | P1 |
| UI-009 | `/dashboard`              | any             | redirects to `/admin?tab=overview`                       | Location: /admin?tab=overview                                | P1 |
| UI-010 | `/settings`               | USER            | profile info + devices panel + notification bell visible | no Admin / Dev buttons                                        | P1 |
| UI-011 | `/settings`               | ADMIN           | Admin button visible (link to `/admin`)                  |                                                              | P1 |
| UI-012 | `/settings`               | SUPER_ADMIN     | Admin + Dev buttons visible                              |                                                              | P1 |
| UI-013 | `/settings`               | anon            | redirected to `/login`                                   |                                                              | P0 |
| UI-014 | `/settings`               | blocked user    | redirected to `/blocked`                                 |                                                              | P0 |
| UI-015 | `/pm`                     | USER            | 5 tabs render (overview, projects, tasks, activity AW badge, team) | no console errors                                  | P1 |
| UI-016 | `/pm`                     | anon            | → `/login`                                               |                                                              | P0 |
| UI-017 | `/pm?tab=projects&projectId=$P2&detailTab=tasks` | member | task list renders + status badges                      |                                                              | P1 |
| UI-018 | `/pm?tab=projects&projectId=$P2&detailTab=settings` | OWNER | GithubIntegrationCard visible + repo input + webhook hint |                                                          | P1 |
| UI-019 | `/pm` sidebar collapse    | USER            | click collapse → 60px, state persisted in localStorage   | reload preserves collapse                                    | P3 |
| UI-020 | `/admin`                  | ADMIN           | 3 tabs (overview, users, analytics) render               |                                                              | P1 |
| UI-021 | `/admin`                  | USER            | redirect to `/pm?tab=overview`                           |                                                              | P0 |
| UI-022 | `/admin`                  | anon            | → `/login`                                               |                                                              | P0 |
| UI-023 | `/admin` users tab        | ADMIN           | **UNCLEAR** — ADMIN 403'd from `/api/admin/users`. Does UI render empty, error banner, or data? | Document actual behavior | P0 |
| UI-024 | `/dev`                    | SUPER_ADMIN     | 10 sidebar tabs present (overview → settings)            | All listed in navItems; no console errors                    | P1 |
| UI-025 | `/dev`                    | ADMIN           | redirect to `/admin`                                     |                                                              | P0 |
| UI-026 | `/dev`                    | USER            | redirect to `/pm`                                        |                                                              | P0 |
| UI-027 | `/dev` Agents tab         | SUPER_ADMIN     | stats cards + pending banner + live-indicator dots + approve CTA | Auto-refresh 15s                                    | P1 |
| UI-028 | `/dev` Agents approve modal | SUPER_ADMIN   | click Approve on PENDING → modal with user Select        | Confirm disabled until user picked                           | P1 |
| UI-029 | `/dev` Webhook Tokens tab | SUPER_ADMIN     | list renders, no `tokenHash` column visible              | CH-5 cross SEC-010                                            | P0 |
| UI-030 | `/dev` Webhook Tokens create | SUPER_ADMIN  | create flow shows plaintext ONCE, then masked            | second page-load: plaintext gone                             | P1 |
| UI-031 | `/dev` Webhook Monitor    | SUPER_ADMIN     | 5 summary cards (24h) render + recent requests table     | Auto-refresh 10s, filter All/Success/Failures/Auth            | P2 |
| UI-032 | `/dev` App Logs           | SUPER_ADMIN     | Redis log ring buffer visible, paginated 25/page         | pagination resets on filter change                           | P2 |
| UI-033 | `/dev` User Logs (audit)  | SUPER_ADMIN     | audit rows visible (LOGIN/LOGOUT/ROLE_CHANGED…)           | paginated 25/page                                            | P2 |
| UI-034 | `/dev` Database ER        | SUPER_ADMIN     | React Flow ER diagram with 22 model nodes                | node positions persist on reload (localStorage key `dev:schema:positions`) | P2 |
| UI-035 | `/dev` Project → API Routes | SUPER_ADMIN   | React Flow with edges login→redirect                     | double-click file node opens editor in dev                   | P2 |
| UI-036 | `/dev` Project → File Structure | SUPER_ADMIN | file tree with filter by category                       |                                                              | P2 |
| UI-037 | `/dev` Project → Env Variables | SUPER_ADMIN| shows 10 keys (**drift — CONS-004**)                     | Known: 7 keys missing (MCP_SECRET etc.)                      | P2 |
| UI-038 | `/dev` Project → Live Requests | SUPER_ADMIN| open `/health` from another tab → counter increments     | WS broadcast from admin channel works                        | P2 |
| UI-039 | Dark mode toggle          | any             | toggle persists across reload                            | localStorage `mantine-color-scheme-value` set                | P3 |
| UI-040 | Pre-paint color scheme    | any             | first paint matches stored scheme (no flash)             | `index.html` inline script reads before hydration            | P3 |
| UI-041 | Logout confirm modal      | SUPER_ADMIN (`/dev`) | click logout → confirm modal → session invalidated     | subsequent `/api/auth/session` → 401                         | P1 |
| UI-042 | Blocked flow E2E          | USER            | admin blocks user → next UI action → `/blocked` route    | session cookie already invalidated (API-0038 proved backend) | P0 |
| UI-043 | XSS render safety (task title) | USER in `/pm` | open task $T1 with stored `<script>alert(1)</script>` | text rendered literally, no alert, no DOM execution         | P0 |
| UI-044 | XSS comment body          | USER            | render comment `<img src=x onerror=alert(1)>`            | no alert; img tag not executed                               | P0 |
| UI-045 | Click-to-source           | SUPER_ADMIN dev mode | `Ctrl+Shift+Cmd+C` toggles inspector, click opens editor | `REACT_EDITOR` env honored                                 | P3 |
| UI-046 | Mobile viewport 375×667    | USER `/pm`      | sidebar auto-collapses, content reflows                  | recent commit `77f0ad9` fix                                  | P2 |

---

## CH-4 DB

Direct Postgres probes via Prisma client or `psql $DATABASE_URL`. All TCs are read-side or verify after a paired CH-2 write.

| TC ID  | Model / Constraint                              | Probe                                                                                 | Expected                                             | Priority |
| ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------- |
| DB-001 | `User.email` unique                              | Create 2nd user with same email via admin→fails                                       | 409 / unique_violation                               | P0 |
| DB-002 | `Session.token` unique + idx                     | `\d session` shows unique idx                                                         | matches schema                                        | P0 |
| DB-003 | `Project.githubRepo` unique                      | Link two projects to same repo → 2nd fails 409                                         | paired with API-0114                                 | P1 |
| DB-004 | `Project` cascade delete                         | After API-0118 delete, count children of `$P1` (tasks/members/tags) = 0                | 0 rows                                               | P0 |
| DB-005 | `ProjectMember` unique `(projectId,userId)`      | API-0120 duplicate add → 409                                                          | matches                                               | P1 |
| DB-006 | `ProjectExtension` audit on extend               | After API-0123, row inserted with `previousEndAt` and `newEndAt`                       | 1 row added                                           | P1 |
| DB-007 | `Agent.agentId` unique                           | 2nd upsert with same id does NOT create new row                                       | count unchanged                                       | P0 |
| DB-008 | `ActivityEvent` unique `(agentId,bucketId,eventId)` | API-0177 replay → row count unchanged                                               | dedup works                                           | P0 |
| DB-009 | `WebhookToken.tokenHash` unique                  | attempt insert duplicate hash → unique_violation                                      |                                                      | P1 |
| DB-010 | `TaskStatusChange` written on PATCH              | After API-0071b, row exists with `fromStatus='OPEN'`, `toStatus='IN_PROGRESS'`         |                                                      | P1 |
| DB-011 | `Notification` on task assignment                | After API-0076b, Notification row for new assignee kind=TASK_ASSIGNED                 |                                                      | P1 |
| DB-012 | `Tag` unique `(projectId,name)`                  | API-0090b duplicate → 409                                                              |                                                      | P2 |
| DB-013 | `TaskTag` cascade on Tag delete                  | API-0092b → TaskTag rows for that tag = 0                                              |                                                      | P1 |
| DB-014 | `TaskDependency` unique `(taskId,blockedById)`   | double-add same dep → 409                                                              |                                                      | P1 |
| DB-015 | `ProjectGithubEvent` dedup `(projectId,kind,sha,prNumber)` | API-0185 replay → row count unchanged                                         |                                                      | P1 |
| DB-016 | `WebhookRequestLog` retention sweep              | Insert row with `createdAt=NOW()-8 days`, wait for 24h sweep OR manual invoke; row gone | WEBHOOK_LOG_RETENTION_DAYS=7                        | P2 |
| DB-017 | `AuditLog` retention sweep                       | Insert row `createdAt=NOW()-91 days`, verify sweep                                    | AUDIT_LOG_RETENTION_DAYS=90                          | P2 |
| DB-018 | Seed shape                                        | `SELECT email, role FROM "user"` → 4 rows (superadmin, admin, user, kurosaki…)         | matches Fase 0 inventory                              | P0 |
| DB-019 | Session deleted on block                         | After API-0038, Session rows for userId = 0                                             | matches                                               | P0 |
| DB-020 | `TaskComment.authorId` SetNull on User delete    | Delete user with comments → comment rows survive with `authorId=null`                 | Do **NOT** execute on seed users; document only      | P1 |

---

## CH-5 Security

| TC ID    | Surface                                   | Probe                                                                                                   | Expected                                                   | Priority |
| -------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| SEC-001  | GitHub webhook HMAC                       | `POST /webhooks/github` with `X-Hub-Signature-256` computed against **wrong** secret                    | 401 + no row in ProjectGithubEvent                         | P0 |
| SEC-002  | Session cookie flags                      | `curl -i /api/auth/login` → inspect `Set-Cookie` for HttpOnly, SameSite=Lax, **no Secure on http**      | PASS on localhost; INFO for production                     | P0 |
| SEC-003  | Session cookie not readable via JS         | `document.cookie` in browser after login                                                                 | session cookie not present (HttpOnly)                      | P0 |
| SEC-004  | Cross-tab session reuse                    | sign in on browser A, steal cookie file, reuse in curl                                                   | works (cookie is bearer) — documents threat model          | P1 |
| SEC-005  | Blocked user session invalidation          | block a logged-in user → their `GET /api/auth/session` → 401                                             | matches (API-0038 side-effect)                             | P0 |
| SEC-006  | CSRF posture on state-changing endpoints   | Cross-origin `fetch('/api/auth/logout',{method:'POST',credentials:'include'})` with no CSRF token        | `SameSite=Lax` blocks form-POST from other origin; document | P0 |
| SEC-007  | Rate limit on login                        | 50× `POST /api/auth/login` rapid-fire wrong password                                                     | All return 401 (no lockout); document absence as risk       | P0 |
| SEC-008  | SQLi in login email                        | `email="' OR 1=1--"`                                                                                     | 401; pg raw query uses Prisma parameterization → safe       | P0 |
| SEC-009  | SQLi in `?projectId` filter                | `GET /api/tasks?projectId=' OR 1=1--`                                                                   | 400 / empty / safe — no DB error dump                      | P0 |
| SEC-010  | Secret never leaked — WebhookToken hash    | `GET /api/admin/webhook-tokens` response keys                                                            | no `tokenHash`, no plaintext token                          | P0 |
| SEC-011  | Secret never leaked — User.password        | Any user-returning endpoint (`/api/users`, `/api/admin/users`, `/api/auth/session`) response keys         | no `password` field                                         | P0 |
| SEC-012  | Secret never leaked — Session.token        | `GET /api/admin/sessions` response keys                                                                  | either hashed or absent                                     | P0 |
| SEC-013  | MCP secret gate — unset                    | Unset both secrets, hit `/mcp`                                                                           | 503                                                         | P0 |
| SEC-014  | XSS in task title                           | stored from API-0077b; open `/pm` task detail                                                            | text rendered literally; no alert; React escapes by default | P0 |
| SEC-015  | XSS in comment body                         | stored from API-0081b; open task detail                                                                  | no execution                                                | P0 |
| SEC-016  | XSS in project description                  | create project `description="<svg onload=alert(1)>"`; render Overview tab                                | no execution                                                | P0 |
| SEC-017  | Path traversal in evidence upload filename  | API-0085b → stored filename basename-sanitized                                                           | no `..` in stored path                                      | P0 |
| SEC-018  | Auth gate on evidence serve                 | API-0087b — anon GET                                                                                     | 401                                                         | P0 |
| SEC-019  | Path traversal on evidence GET              | API-0088b — `/api/evidence/../etc/passwd`                                                                 | 400/404, NOT 200                                            | P0 |
| SEC-020  | JSON body bomb                               | `POST /api/tasks` with `title` length 1,000,000 chars                                                    | 400 / 413 / safely truncated                                | P1 |
| SEC-021  | Header spoofing `X-Forwarded-For`           | `POST /api/auth/login` failing with `X-Forwarded-For: 1.2.3.4`                                           | `AuditLog.ip` reflects spoofable value — document             | P1 |
| SEC-022  | Dev `/__open-in-editor` no auth             | unauthenticated POST in dev mode                                                                         | 200 (by design) — document risk if dev server exposed        | P0 |
| SEC-023  | Project-member bypass attempt                | USER Alice calls `GET /api/projects/$Bob_owned_id`                                                       | 403                                                         | P0 |
| SEC-024  | SUPER_ADMIN bypass expected                  | SUPER_ADMIN reads any project                                                                            | 200 (documented bypass)                                     | P1 |
| SEC-025  | Tenant isolation tasks                      | USER Alice `GET /api/tasks?projectId=$Bob_project`                                                      | 200 `[]` or 403 — document                                   | P0 |
| SEC-026  | Webhook token fallback env                  | No DB-active tokens, valid `PMW_WEBHOOK_TOKEN` env → POST /webhooks/aw succeeds                         | 200                                                         | P1 |
| SEC-027  | WebSocket auth                              | WS `/ws/presence` with no cookie                                                                         | close 4001 Unauthorized                                     | P0 |
| SEC-028  | Admin-only WS channel                       | WS as USER → no `{type:'request',...}` telemetry frames received                                         | only SUPER_ADMIN/ADMIN receive request broadcasts            | P1 |

---

## CH-6 Consistency

| TC ID    | Doc claim                                                                               | Reality (this repo)                                                             | Action                                                           | Priority |
| -------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| CONS-001 | `CLAUDE.md` claims `.env.example` synced with `.env`                                    | Drift: `.env.example` missing AUDIT_LOG_RETENTION_DAYS, WEBHOOK_LOG_RETENTION_DAYS, MCP_SECRET_ADMIN, UPLOADS_DIR, UPLOAD_MAX_BYTES | File issue to sync           | P2 |
| CONS-002 | `CLAUDE.md` claims role-default-route: SUPER_ADMIN→`/dev`, ADMIN→`/dashboard`, USER→`/profile` | Reality `useAuth.ts:14`: SUPER_ADMIN+ADMIN → `/admin`; USER+QC → `/pm`; `/dashboard` and `/profile` are redirect stubs | Update CLAUDE.md | P1 |
| CONS-003 | `GET /api/admin/routes` claims to list all API routes                                   | Missing 6 endpoints (POST /webhooks/github, GET /api/projects/:id/github/summary & feed, POST /api/tasks/:id/evidence/upload, GET /api/evidence/:file, ALL /mcp) | Update inline route list in handler (src/app.ts:667) | P1 |
| CONS-004 | `GET /api/admin/env-map` claims to list all env keys                                    | Missing 7 keys (MCP_SECRET, MCP_SECRET_ADMIN, PMW_WEBHOOK_TOKEN, PMW_EVENT_BATCH_MAX, GITHUB_WEBHOOK_SECRET, UPLOADS_DIR, UPLOAD_MAX_BYTES) | Update handler at src/app.ts:1447 | P1 |
| CONS-005 | `CLAUDE.md` + RECON claim `DELETE /api/tasks/:id` exists                                | grep + live probe → not implemented (404). **FASE1-004**                         | File as bug OR update docs                                        | P1 |
| CONS-006 | `CLAUDE.md` claims `/profile` is a live route for USER                                  | `/profile` always redirects to `/settings` (7-line stub)                         | Update CLAUDE.md                                                  | P2 |
| CONS-007 | `CLAUDE.md` claims `/dashboard` has sidebar with "Dashboard, Analytics, Orders, Messages, Calendar, Settings" | `/dashboard` is a 7-line stub that redirects to `/admin?tab=overview`. The real admin has 3 tabs: overview, users, analytics | Update CLAUDE.md | P2 |
| CONS-008 | Enum `Role = USER|QC|ADMIN|SUPER_ADMIN` with QC seeded                                  | QC enum exists; no QC seed row; `PUT /api/admin/users/:id/role` rejects QC        | Seed a QC user OR add QC to role whitelist. **FASE0-002**         | P1 |
| CONS-009 | RECON §9 "~144 HTTP handlers"                                                           | Real: 82 method+path combos + 1 WS. RECON already corrected in FASE1-007.         | Keep updated count 82 in docs                                      | P3 |
| CONS-010 | `CLAUDE.md` claims `/dev` sidebar has tab named `Database` (React Flow ER diagram)       | File shows 10 tabs incl. database — **matches**                                   | PASS                                                               | P2 |
| CONS-011 | `.env.example` contains `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TELEGRAM_NOTIFY_*`    | None are consumed anywhere in src/ → legacy dead config                          | Remove from `.env.example`                                         | P3 |
| CONS-012 | MCP tool count docs                                                                     | 79 registered (16 modules), matches scripts/mcp/server.ts                         | PASS — use 79 going forward                                         | P2 |

---

## Notes for Fase 3 executor

1. **Fixture ordering**: Create `$P1`, `$P2`, `$T1`, `$T2`, `$TAG1`, `$CL1` early and reuse. Persist their ids to `qa/2026-04-18/fixtures.json` so Fase 4 can re-query.
2. **State drift**: Some TCs mutate DB state (e.g. API-0035 promote → revert to USER). If a TC fails mid-way leaving dirty state, record in PROGRESS.md and clean up at end of channel.
3. **Known-defect short-circuit**: For API-0078/0079b (task DELETE), do not retry — record `FAIL (known FASE1-004)` and move on. Do **not** count as a new bug.
4. **QC role**: Either provision at start of Fase 3 via `UPDATE "user" SET role='QC' WHERE email='qc@test.local'` (after creating the user) and save cookie, or mark every QC row SKIPPED uniformly. Do not mix strategies mid-run.
5. **Cookies stale after ~24h**: `Max-Age=86400`. If Fase 3 runs past 2026-04-19 05:41 UTC, re-login and re-capture cookies.
6. **Webhook test secret**: Use a throwaway `GITHUB_WEBHOOK_SECRET` set just for this session. Do NOT reuse production secret.
7. **UPLOAD tests**: Write test files under `$TMPDIR/claude` — they'll be auto-cleaned. Confirm `UPLOADS_DIR` is NOT inside `src/` before running.
8. **MCP**: `API-0204/0205/0206/0207` may require the app to be started with specific env. If not feasible mid-session, document as "environment-dependent" and probe only what's currently configured.
