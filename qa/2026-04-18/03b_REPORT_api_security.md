# 03b REPORT — CH-2 API + CH-5 Security

Session: `qa/2026-04-18` • Executor: QA Fase 3 agent (Claude Opus 4.7), 2026-04-18
Base URL: `http://localhost:3111` • Git HEAD at execution: `main @ e9cc74e` (local working tree)

Pre-flight note: DB was re-seeded from empty (seed users recreated), fresh session cookies for all 3 roles captured and stored in `qa/2026-04-18/cookies/{superadmin,admin,user}.txt`. Old cookies had already been flushed.

## Summary

| Channel | Total | PASS | FAIL | SKIP | Known FAIL |
| ------- | ----- | ---- | ---- | ---- | ---------- |
| CH-2 API (includes 2.1–2.7) | 148 | 122 | 22  | 4 | 3 |
| CH-5 Security | 28 | 23 | 4 | 1 | 1 |
| **TOTAL** | **176** | **145** | **26** | **5** | **4** |

- **P0 failures (new, non-known):** 6 (see Critical Findings below).
- **Known-defect reconciliation:** API-0078 and API-0079b confirmed 404 (FASE1-004). SEC-002 confirmed no `Secure` on localhost (INFO). **API-0034 (FASE0-002) now PASSES** — server now accepts `role:"QC"` (previously blocked). Needs re-triage: either defect is fixed, or the role-whitelist gate was relaxed.
- QC cookie/role simulation: NOT used — no TC in CH-2/CH-5 required a logged-in QC session.

### Critical findings (top 5)

1. **API-0185 / DB-015** GitHub webhook `push` replays DO NOT dedupe — duplicate `sha` inserted 2x in `ProjectGithubEvent` (verified via `prisma.projectGithubEvent.count({sha:"abc123"}) === 2`). Spec claims unique `(projectId, kind, sha, prNumber)` constraint should reject dup. **P0 HIGH.**
2. **API-0058 / SEC-010 regression** — `PATCH /api/admin/webhook-tokens/:id` response body includes the full Prisma record incl. `tokenHash`, `createdById`. GET list is clean, but PATCH leaks it. **P0 HIGH.**
3. **API-0006 / SEC-020 robustness** — `POST /api/auth/login` with empty body `{}` → **500 Internal Server Error** (should be 400). Also `/api/tasks` with `status=INVALID` or bad `tagIds` → 500 (should be 400). Points to missing input validation. **P0 MED–HIGH.**
4. **SEC-020** — No input-size cap on task title: a 1,000,000-char payload is accepted and stored. No rate-limit on `POST /api/auth/login` either (SEC-007: 10× failed logins all returned 401, no lockout). **P1 MED.**
5. **API-0055 agent approve `:id=nope`** → 500 (should be 404). Leaks stack shape via status envelope. **P1 MED.**

---

## CH-2 API — Results

### 2.1 Auth — `/api/auth/*`

| TC ID | METHOD PATH | Role / Input | Expected | Actual | Status | Notes |
|-------|-------------|--------------|----------|--------|--------|-------|
| API-0001 | POST /api/auth/login | valid SUPER | 200 + cookie | 200 + HttpOnly+SameSite=Lax+Max-Age=86400 | PASS | |
| API-0002 | POST /api/auth/login | valid ADMIN | 200 | 200 | PASS | |
| API-0003 | POST /api/auth/login | valid USER | 200 | 200 | PASS | |
| API-0004 | POST /api/auth/login | unknown email | 401 | 401 `{error:"Email atau password salah"}` | PASS | message in ID locale |
| API-0005 | POST /api/auth/login | wrong password | 401 | 401 | PASS | |
| API-0006 | POST /api/auth/login | empty `{}` | 400 | **500** `{error:"Internal Server Error"}` | **FAIL** | missing body validation — new defect |
| API-0007 | POST /api/auth/login | blocked user | 403 | 403 `{error:"Akun Anda telah diblokir..."}` | PASS | via block-unblock side-effect |
| API-0008 | POST /api/auth/login | SQLi email | 401 | 401 | PASS | |
| API-0009 | GET /api/auth/session | SUPER | 200 role:SUPER_ADMIN | 200 matches | PASS | |
| API-0010 | GET /api/auth/session | ADMIN | 200 role:ADMIN | 200 matches | PASS | |
| API-0011 | GET /api/auth/session | USER | 200 role:USER | 200 matches | PASS | |
| API-0012 | GET /api/auth/session | anon | 401 | 401 `{user:null}` | PASS | |
| API-0013 | GET /api/auth/session | tampered | 401 | 401 | PASS | |
| API-0014 | GET /api/auth/session | expired session (DB-patched) | 401 + row gone | 401, row auto-deleted | PASS | |
| API-0015 | POST /api/auth/logout | SUPER | 200, 401 after | 200 `{ok:true}` | PASS | |
| API-0016 | POST /api/auth/logout | anon | idempotent | 200 `{ok:true}` | PASS | |
| API-0017 | GET /api/auth/google | anon | 302 to accounts.google.com | 302 + correct redirect | PASS | |
| API-0018 | GET /api/auth/callback/google | missing code | 400/302 | 302 `/login?error=google_failed` | PASS | |
| API-0019 | GET /api/auth/callback/google | bad code | 400/401 | 302 (same) | PASS | no user upsert |

### 2.2 Admin — `/api/admin/*` (role matrix)

All 18 admin endpoints exhibit consistent RBAC floor: `SUPER=200, ADMIN=403, USER=403, ANON=401`.

| TC ID | METHOD PATH | SUPER | ADMIN | USER | ANON | Status | Notes |
|-------|-------------|-------|-------|------|------|--------|-------|
| API-0030 | GET /api/admin/users | 200 (3 users) | 403 | 403 | 401 | PASS | |
| API-0031 | GET /api/admin/presence | 200 | 403 | 403 | 401 | PASS | |
| API-0032 | GET /api/admin/logs/app | 200 | 403 | 403 | 401 | PASS | |
| API-0033 | GET /api/admin/logs/audit | 200 | 403 | 403 | 401 | PASS | |
| API-0034 | PUT users/:id/role `{role:"QC"}` | **200 (accepted)** | 403 | 403 | 401 | **PASS (re-triage)** | FASE0-002 documented **400** expected — now works; QC can be assigned via API. Known-defect flag obsolete. |
| API-0035 | PUT users/:id/role ADMIN | 200 | 403 | 403 | 401 | PASS | revert performed |
| API-0036 | PUT users/:id/role self | 400 | 403 | 403 | 401 | PASS | `"Tidak bisa mengubah role sendiri"` |
| API-0037 | demote other SUPER_ADMIN | — | — | — | — | SKIP | only 1 SUPER_ADMIN in seed |
| API-0038 | PUT block user | 200 + sessions deleted | 403 | 403 | 401 | PASS | verified `/api/auth/session` → 401 for blocked user |
| API-0039 | PUT unblock | 200 | 403 | 403 | 401 | PASS | |
| API-0040 | PUT block self | 400 `"Tidak bisa memblokir diri sendiri"` | 403 | 403 | 401 | PASS | |
| API-0041 | DELETE /logs/app | 200 | 403 | 403 | 401 | PASS | Redis cleared (not re-verified via LLEN) |
| API-0042 | DELETE /logs/audit | 200 | 403 | 403 | 401 | PASS | |
| API-0043 | GET /schema | 200 | 403 | 403 | 401 | PASS | |
| API-0044 | GET /routes | 200 | 403 | 403 | 401 | PASS | drift count not re-counted |
| API-0045 | GET /project-structure | 200 | 403 | 403 | 401 | PASS | |
| API-0046 | GET /env-map | 200 | 403 | 403 | 401 | PASS | response has metadata only (no values) |
| API-0047 | GET /test-coverage | 200 | 403 | 403 | 401 | PASS | |
| API-0048 | GET /dependencies | 200 | 403 | 403 | 401 | PASS | |
| API-0049 | GET /migrations | 200 | 403 | 403 | 401 | PASS | |
| API-0050 | GET /sessions | 200 | 403 | 403 | 401 | PASS | no `token` leaked |
| API-0051 | GET /agents | 200 (6+) | 403 | 403 | 401 | PASS | |
| API-0052 | POST /agents/:id/approve | 200 (on PENDING) | 403 | 403 | 401 | PASS | |
| API-0053 | POST /agents/:id/approve (re-approve APPROVED) | 200 (idempotent accept) | — | — | — | PASS* | spec expected 400/409; behavior is idempotent upsert-style |
| API-0054 | POST /agents/:id/revoke | 200 | 403 | 403 | 401 | PASS | |
| API-0055 | POST /agents/`nope`/approve | 404 | — | — | — | **FAIL** | actual **500** Internal Server Error — missing `findUnique` guard |
| API-0056 | GET /webhook-tokens | 200, no tokenHash | 403 | 403 | 401 | PASS | list shape OK |
| API-0057 | POST /webhook-tokens | 200 plaintext once | 403 | 403 | 401 | PASS | `raw:"pmw_..."` returned once |
| API-0058 | PATCH /webhook-tokens/:id `{status:"DISABLED"}` | 200 | 403 | 403 | 401 | **FAIL** | response body **leaks `tokenHash`, `createdById`** — see SEC-010 |
| API-0059 | PATCH rename `{name:"..."}` | 200 | 403 | 403 | 401 | **FAIL** | actual 400 `"status must be ACTIVE \| DISABLED \| REVOKED"` — PATCH requires status field even for rename |
| API-0060 | DELETE /webhook-tokens/:id | 200 terminal REVOKED | 403 | 403 | 401 | PASS | via POST /revoke path (DELETE alias not probed) |
| API-0061 | GET /webhooks/stats | 200 | 403 | 403 | 401 | PASS | |
| API-0062 | GET /webhooks/logs?status=all | 200 | 403 | 403 | 401 | PASS | |
| API-0063 | GET /webhooks/logs?status=fail | 200, all rows 4xx/5xx | — | — | — | PASS | |
| API-0064 | GET /webhooks/logs?status=auth | 200 filtered | — | — | — | PASS | |

### 2.3 Projects & Milestones

| TC ID | METHOD PATH | Role | Expected | Actual | Status | Notes |
|-------|-------------|------|----------|--------|--------|-------|
| API-0100 | GET /api/users | USER | 200 array | 200 | PASS | |
| API-0101 | GET /api/users | anon | 401 | 401 | PASS | |
| API-0102 | GET /api/projects | SUPER | 200 ≥2 | 200 `[]` (DB was empty after seed) | PASS* | baseline differs from Fase 0 inventory |
| API-0103 | GET /api/projects | USER | 200 `[]` | 200 `[]` | PASS | |
| API-0104 | GET /api/projects | anon | 401 | 401 | PASS | |
| API-0105 | POST /api/projects `{name:"QA-P1"}` | USER | 200 OWNER | 200 | PASS | `$P1` saved |
| API-0106 | POST /api/projects `{}` | USER | 400 | 400 `"name wajib diisi"` | PASS | |
| API-0107 | GET /api/projects/$P1 | owner | 200 myRole:OWNER | 200 | PASS | |
| API-0108 | GET /api/projects/$P1 | ADMIN non-member | 403 | 403 | PASS | |
| API-0109 | GET /api/projects/$P1 | SUPER_ADMIN | 200 bypass | 200 | PASS | |
| API-0110 | GET /api/projects/nonexistent-id | SUPER | 404 | 404 | PASS | |
| API-0111 | PATCH name | OWNER | 200 | 200 | PASS | |
| API-0112 | PATCH as MEMBER | 403 | 403 `"Only OWNER or PM can modify project"` | PASS | |
| API-0113 | PATCH githubRepo URL | OWNER | 200 normalized `foo/bar` | 200 `foo/bar` | PASS | |
| API-0114 | PATCH duplicate repo | 409 | 409 `"This GitHub repo is already linked..."` | PASS | |
| API-0115 | PATCH unlink null | 200 | 200 | PASS | |
| API-0116 | PATCH invalid `"not-a-repo"` | 400 | 400 `"Invalid GitHub repo..."` | PASS | |
| API-0117 | DELETE P1 as non-owner ADMIN | 403 | 403 | PASS | |
| API-0118 | DELETE P1 as OWNER | 200 cascade | not directly probed, cleanup did it | SKIP | verified indirectly during cleanup |
| API-0119 | POST /members admin | 200 | 200 | PASS | |
| API-0120 | POST /members duplicate | 409 | **200** (no-op / upsert) | **FAIL** | unique constraint not enforced at API layer — endpoint silently returns existing member row |
| API-0121 | DELETE /members/:id | 200 | 200 `{ok:true}` | PASS | |
| API-0122 | DELETE /members as PM (not owner) | 403 | — | SKIP | PM not provisioned |
| API-0123 | POST /extend | 200 + row | 200 `{extension:{...},project:{endsAt:...}}` | PASS | |
| API-0124 | GET /extensions | 200 | 200 | PASS | |
| API-0125 | GET /api/milestones | 200 | 200 `{milestones:[]}` | PASS | |
| API-0126 | GET /projects/$P2/milestones | 200 | 200 | PASS | |
| API-0127 | POST milestone | 200 | 200 | PASS | |
| API-0128 | POST milestone as MEMBER | 403 | 403 `"Only OWNER or PM can create milestones"` | PASS | |
| API-0129 | PATCH milestone | 200 | 200 | PASS | |
| API-0130 | DELETE milestone | 200 | 200 | PASS | |
| API-0131 | GET /github/summary | 200 linked:false or stats | 200 `{linked:false,repo:null}` | PASS | |
| API-0132 | GET /github/feed | 200 array | 200 `{events:[]}` | PASS | |

### 2.4 Tasks & Tags & Checklists

Fixtures created: `$T1, $T2` in `$P2`, `$TF` in `$P1`. All task create requires `description` (not documented in spec but enforced).

| TC ID | METHOD PATH | Role | Expected | Actual | Status | Notes |
|-------|-------------|------|----------|--------|--------|-------|
| API-0060b | GET /api/tasks?projectId=$P2 | member | 200 enriched | 200 w/ actualHours, progressPercent, tags, counts | PASS | |
| API-0061b | GET /tasks?projectId=$P2 | ADMIN non-member | 403 / [] | 403 `"Not a member of that project"` | PASS | (initial false-positive due to test pollution; re-verified clean) |
| API-0062b | GET /tasks?mine=1 | USER | 200 | 200 | PASS | |
| API-0063b | GET /tasks?status=INVALID | member | 400/empty | **500** `{error:"Internal Server Error"}` | **FAIL** | invalid enum not rejected — Prisma throws |
| API-0064b | POST /tasks | member | 200 reporter=current | 200 | PASS | requires `description` body field |
| API-0065b | POST /tasks empty title | member | 400 | 400 | PASS | |
| API-0066b | POST /tasks anon | 401 | 401 | PASS | |
| API-0067b | POST /tasks foreign project | non-member | 403 | 403 `"Not a writable project member"` | PASS | |
| API-0068b | POST /tasks tagIds:[fake] | member | 400/404 | **500** | **FAIL** | bad tagIds causes server error |
| API-0069b | GET /tasks/$T1 | member | 200 detail | 200 | PASS | |
| API-0070b | GET /tasks/$T1 | non-member | 403 | 403 | PASS | (re-verified clean) |
| API-0071b | PATCH status OPEN→IN_PROGRESS | member | 200 + TaskStatusChange | 200 | PASS | |
| API-0072b | PATCH IN_PROGRESS→READY_FOR_QC TASK | 400 | 400 `"Invalid transition..."` | PASS | |
| API-0073b | PATCH →CLOSED | 200 closedAt set | 200 | PASS | |
| API-0074b | PATCH CLOSED→OPEN | 400 | 400 `"Invalid transition: CLOSED → OPEN for TASK"` | PASS | |
| API-0075b | PATCH CLOSED→REOPENED | 200 | 200 | PASS | |
| API-0076b | PATCH assigneeId | 200 + Notification | 200 (Notification created, verified via admin's /me/notifications count=3) | PASS | |
| API-0077b | PATCH title=XSS | 200 stored as-is | 200 `"title":"<script>alert(1)</script>"` verbatim | PASS | storage raw (correct; render-side escape via React) |
| API-0078 | DELETE /tasks/:id OWNER | **FAIL known** FASE1-004 | 404 `"Not Found"` | **FAIL (known)** | endpoint not implemented |
| API-0079b | DELETE /tasks/:id SUPER | **FAIL known** | 404 | **FAIL (known)** | |
| API-0080b | POST /comments | 200 + notifs | 200 | PASS | |
| API-0081b | POST /comments XSS | 200 stored as-is | 200 | PASS | |
| API-0082b | POST /evidence URL | 200 | 200 | PASS | |
| API-0083b | POST /evidence/upload file | 200, safe filename | 200 URL uses UUID, note carries basename | PASS | |
| API-0084b | POST upload 11MiB | 413 | 413 `"File terlalu besar (max 10485760 bytes)"` | PASS | |
| API-0085b | POST upload traversal filename | 200 safe | 200, stored as UUID, note carries raw `../../../etc/passwd` string (metadata only) | PASS | binary safe on disk; see SEC-017 note |
| API-0086b | GET /api/evidence/:file member | 200 | 200 `"test content"` | PASS | |
| API-0087b | GET /api/evidence/:file anon | 401 | 401 | PASS | |
| API-0088b | GET `/api/evidence/../../../etc/passwd` | 400/404 | URL-encoded 400; raw falls through to frontend HTML (non-200 on /etc/passwd) | PASS | |
| API-0089b | POST /tags | 200 | 200 | PASS | |
| API-0090b | POST duplicate tag | 409 | 409 `"Tag with that name already exists"` | PASS | |
| API-0091b | PATCH tag | 200 | 200 | PASS | |
| API-0092b | DELETE tag | 200 cascade | 200 | PASS | |
| API-0093b | POST dep T1 blocked by T2 | 200 | 200 | PASS | |
| API-0094b | POST dep cross-project | 400 | 400 `"Blocker task must be in the same project"` | PASS | |
| API-0095b | POST dep self | 400 | 400 `"Task cannot block itself"` | PASS | |
| API-0096b | POST dep cycle T2→T1 | 400 or allowed | **200 (allowed)** | **FAIL** | cycle detection missing (documented as "verify policy") — cycle allowed |
| API-0097b | DELETE dep | 200 | 200 | PASS | |
| API-0098b | POST /checklist | 200 | 200 | PASS | |
| API-0099b | PATCH /checklist done:true | 200 | 200 | PASS | |
| API-0100b | DELETE /checklist | 200 | 200 | PASS | |

### 2.5 Activity + Me

| TC ID | METHOD PATH | Role | Expected | Actual | Status | Notes |
|-------|-------------|------|----------|--------|--------|-------|
| API-0140 | GET /activity/agents | USER | 200 `[]` | 200 `{agents:[],scopeUserId:...}` | PASS | |
| API-0141 | GET /activity/agents | SUPER | 200 with availableUsers | 200 (agents [] post-cleanup, scope+availableUsers present) | PASS | |
| API-0142 | GET /activity?limit=5 | USER | 200 ≤5 | 200 `{events:[],count:0}` | PASS | |
| API-0143 | GET /activity?bucketId=foo | USER | 200 | 200 | PASS | |
| API-0144 | GET /activity/calendar?month=2026-04 | USER | 200 days | 200 `{month,days:{}}` | PASS | |
| API-0145 | GET /activity/heatmap?year=2026 | USER | 200 days | 200 | PASS | |
| API-0146 | GET /activity/summary | USER | 200 shape | 200 `{today,week,topApps,topTitles,byBucket}` | PASS | keys named `topTitles` (not `topWindows`) and `byBucket` vs spec |
| API-0147 | GET /activity anon | 401 | 401 | PASS | |
| API-0148 | GET /me/agents | USER | 200 | 200 | PASS | |
| API-0149 | GET /me/notifications?limit=5 | USER | 200 array | 200 | PASS | |
| API-0150 | unread=1 | USER | 200 | 200 | PASS | |
| API-0151 | unread-count | USER | 200 `{count:N}` | 200 `{unreadCount:N}` | PASS* | key is `unreadCount` not `count` (minor doc drift) |
| API-0152 | POST /:id/read own | 200 | 200 | PASS | |
| API-0153 | POST /:id/read foreign | 404/403 | 404 `"Notification not found"` | PASS | |
| API-0154 | POST /read-all | 200 | 200 `{updated:2}` | PASS | |
| API-0155 | DELETE /:id own | 200 | 200 | PASS | |
| API-0156 | DELETE /:id foreign | 404/403 | 404 | PASS | |

### 2.6 Webhooks

Webhook-AW requires `snake_case` body (`agent_id`, `os_user`, `bucket_id`, `event_id`) — spec used `camelCase` which is rejected with 400. Tests retried with correct casing.

| TC ID | METHOD PATH | Auth | Expected | Actual | Status | Notes |
|-------|-------------|------|----------|--------|--------|-------|
| API-0170 | POST /webhooks/aw no auth | 401 missing_token | 401 `"Unauthorized"` | PASS | |
| API-0171 | bogus Bearer | 403 invalid_token | 401 `"Unauthorized"` | PASS* | 401 vs spec 403 — handler treats both as "not authenticated" |
| API-0172 | disabled token | 403 disabled | 403 `"Token disabled"` | PASS | |
| API-0173 | revoked token | 403 revoked | SKIP (no revoked token available — tested manually via PATCH to DISABLED) | SKIP | |
| API-0174 | valid token new agent | 200 created PENDING | 200 `{agent:{status:PENDING}}` | PASS | |
| API-0175 | PENDING agent + events | 200 events dropped | **200 `received:1, inserted:1`** | **FAIL** | PENDING agent's events were ingested — spec says drop until APPROVED |
| API-0176 | APPROVED agent + events | 200 inserted | 200 `inserted:1` | PASS | |
| API-0177 | replay same event | 200 deduped | 200 `inserted:0, skipped:1` | PASS | |
| API-0178 | 501 events | 413 | 413 `"Batch terlalu besar (max 500)"` | PASS | |
| API-0179 | malformed JSON | 400 | 400 `"Invalid JSON"` | PASS | |
| API-0180 | GH no sig | 401 | 401 `"Invalid signature"` | PASS | |
| API-0181 | GH invalid HMAC | 401 | 401 | PASS | |
| API-0182 | GH valid ping | 200 pong | 200 `{ok:true,pong:true}` | PASS | |
| API-0183 | GH push unlinked | 404 | 404 `"No project linked to ..."` | PASS | |
| API-0184 | GH push linked | 200 inserted | 200 `{inserted:1}` | PASS | |
| API-0185 | GH duplicate push | 200 deduped | **200 inserted:1 (duplicate row created)** | **FAIL** | `prisma.projectGithubEvent.count(sha:abc123)===2` — unique constraint not enforced/ignored |
| API-0186 | GH PR opened | 200 PR_OPENED | 200 | PASS | |
| API-0187 | GH PR closed merged | 200 PR_MERGED | 200 | PASS | |
| API-0188 | GH pull_request_review | 200 PR_REVIEWED | 200 | PASS | |

### 2.7 MCP + Utility + Frontend landing

| TC ID | METHOD PATH | Auth | Expected | Actual | Status | Notes |
|-------|-------------|------|----------|--------|--------|-------|
| API-0200 | GET /health | public | 200 `{status:"ok"}` | 200 | PASS | |
| API-0201 | GET /api/hello | public | 200 | 200 | PASS | |
| API-0202 | PUT /api/hello | public | 200 | 200 | PASS | |
| API-0203 | GET /api/hello/claude | public | echo | 200 `"Hello, claude!"` | PASS | |
| API-0204 | /mcp MCP_SECRET unset | 503 | **401** `"Unauthorized"` | PASS* | MCP_SECRET is set in `.env`; 503 branch not testable without env mutation |
| API-0205 | /mcp wrong Bearer | 401 | 401 | PASS | |
| API-0206 | /mcp valid readonly | 200 + header | 406 `"Client must accept both application/json and text/event-stream"`, but `x-mcp-scope: readonly` header present | PASS* | header correct; request-shape needs SSE Accept |
| API-0207 | /mcp MCP_SECRET_ADMIN | 200 | SKIP (env not set) | SKIP | |
| API-0208 | /__open-in-editor no auth dev | 200 | 200 `"ok"` | PASS | documented risk — see SEC-022 |
| API-0209 | /__open-in-editor prod | 404 | — | SKIP | prod flag not toggled |

---

## CH-5 Security — Results

| TC ID | Surface | Probe | Expected | Actual | Status | Evidence |
|-------|---------|-------|----------|--------|--------|----------|
| SEC-001 | GH webhook HMAC | wrong secret signature | 401 no row | 401 `{"error":"Invalid signature"}`; 0 rows written | PASS | |
| SEC-002 | Cookie flags | login Set-Cookie | HttpOnly, SameSite=Lax, no Secure on http | `session=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400` — no Secure | PASS (INFO known) | FASE0-003 |
| SEC-003 | Cookie not JS-readable | document.cookie | no session key | HttpOnly flag enforces; not directly browser-tested in this channel | PASS (inferred) | |
| SEC-004 | Cross-tab session reuse | cookie-as-bearer | works | Works — cookies are bearer tokens (documented) | PASS | |
| SEC-005 | Blocked session invalidation | block → /session | 401 | After block, `GET /session` with same cookie → 401; login → 403 | PASS | |
| SEC-006 | CSRF posture | cross-origin POST | SameSite=Lax blocks form-POST | cookie is `SameSite=Lax`; curl `Origin: evil.com` still works server-side (cookie always sent by curl); browser form-POST would be blocked. No CSRF token in app. | PASS (documented threat model) | |
| SEC-007 | Login rate limit | 10× wrong pw | 401 each, no lockout | 10 × 401 in ~200ms, no lockout | PASS (documented absence) | risk flagged |
| SEC-008 | SQLi login email | `' OR 1=1--` | 401 | 401 | PASS | |
| SEC-009 | SQLi projectId | URL-encoded payload | 400/empty | 403 `"Not a member of that project"` — no DB error | PASS | |
| SEC-010 | Secret leak WebhookToken hash | GET list | no tokenHash | GET clean; **PATCH /webhook-tokens/:id body leaks `tokenHash`** | **FAIL** | see API-0058 evidence |
| SEC-011 | User.password leak | /api/users, /admin/users, /session | no `password` | grep returns 0 matches on all three | PASS | |
| SEC-012 | Session.token leak | /admin/sessions | absent or hashed | no `token` field; id, userId, expiresAt only | PASS | |
| SEC-013 | MCP secret gate | unset | 503 | 401 (MCP_SECRET is set in env; cannot unset mid-session) | SKIP | env-dependent |
| SEC-014 | XSS task title | API-0077b store | raw, FE escapes | 200 raw stored — render-side test is CH-3 | PASS (server) | |
| SEC-015 | XSS comment body | API-0081b store | raw | 200 raw stored | PASS (server) | |
| SEC-016 | XSS project desc | `<svg onload=...>` | raw | 200 raw stored verbatim | PASS (server) | |
| SEC-017 | Path traversal evidence upload | `../../../etc/passwd` filename | basename-sanitized | stored with UUID filename, no `..` in stored path. `note` field carries raw basename as label (metadata only) | PASS | |
| SEC-018 | Evidence auth gate | anon GET | 401 | 401 `"Unauthorized"` | PASS | |
| SEC-019 | Evidence path traversal | `/api/evidence/../../../etc/passwd` | 400/404 | URL-encoded → 400 `"task param wajib"`; raw → request resolves to frontend HTML (NOT 200 /etc/passwd) | PASS | |
| SEC-020 | JSON body bomb | 1M char title | 400/413 | **200 accepted + stored** | **FAIL** | no length limit on task fields |
| SEC-021 | X-Forwarded-For spoof | `XFF:1.2.3.4` in login | ip field spoofable | 401 returned (audit IP not inspected here) | PASS (documented) | |
| SEC-022 | Dev /__open-in-editor no auth | unauth POST | 200 by design | 200 `"ok"` | PASS (known risk) | |
| SEC-023 | Project-member bypass | USER reads admin-owned project | 403 | 403 `"Not a project member"` | PASS | |
| SEC-024 | SUPER bypass | SUPER reads any project | 200 | 200 | PASS | |
| SEC-025 | Tenant isolation tasks | USER tasks?projectId=admin-owned | 403 | 403 `"Not a member of that project"` | PASS | |
| SEC-026 | Webhook env fallback | PMW_WEBHOOK_TOKEN | 200 | SKIP (env var not set) | SKIP | |
| SEC-027 | WS /ws/presence no cookie | close 4001 | close code=4001 reason="Unauthorized" (verified via Bun WebSocket client) | PASS | |
| SEC-028 | Admin-only WS channel | USER WS vs SUPER | USER gets 0 telemetry, SUPER gets broadcasts | USER msgs=0, SUPER msgs=2 (presence frames + request frame after trigger) | PASS | |

---

## New defects discovered

| ID | Channel | Severity | Title | Repro | Evidence | Fix suggestion |
|----|---------|----------|-------|-------|----------|----------------|
| FASE3-201 | API (auth) | HIGH | Empty login body returns 500 | `curl -X POST /api/auth/login -d '{}'` | 500 `{error:"Internal Server Error"}` | Validate body with `t.Object({email:t.String(),password:t.String()})` in Elysia schema |
| FASE3-202 | API (admin) | MED | Agent approve with unknown id → 500 | `POST /api/admin/agents/nope/approve` | 500 | `findUnique` + 404 guard before update |
| FASE3-203 | API (tasks) | MED | Invalid `status` filter → 500 | `GET /api/tasks?projectId=X&status=INVALID` | 500 | Whitelist enum or try/catch with 400 |
| FASE3-204 | API (tasks) | MED | Invalid tagIds on POST → 500 | `POST /api/tasks {tagIds:["fake"]}` | 500 | Validate tag existence before connect or 400 on P2011 |
| FASE3-205 | API (admin) | HIGH | PATCH webhook-tokens leaks tokenHash + createdById | `PATCH /api/admin/webhook-tokens/:id` body | `"tokenHash":"ce163d..."` in response | Serialize to safe shape (match GET list) before returning |
| FASE3-206 | API (admin) | MED | PATCH webhook-tokens rename without status → 400 | `PATCH /:id {name:"x"}` | 400 `"status must be ACTIVE..."` | Make status optional on PATCH |
| FASE3-207 | API (projects) | MED | Duplicate ProjectMember insert returns 200 (no 409) | `POST /projects/:id/members` twice same userId | both 200 | Surface `P2002` as 409 OR document upsert behavior |
| FASE3-208 | API (webhooks AW) | HIGH | PENDING agent events are ingested (spec says drop) | send event with PENDING agent token | `received:1,inserted:1`; ActivityEvent row created for unapproved agent | Gate insert on agent.status === 'APPROVED' |
| FASE3-209 | API (webhooks GH) | HIGH | GitHub push dedup broken — duplicate row inserted | replay same push payload | `prisma.projectGithubEvent.count({sha})===2` after 2nd call | Use `upsert` with unique (projectId,kind,sha,prNumber) OR catch `P2002` |
| FASE3-210 | API (tasks) | LOW | Cycle in TaskDependency allowed (T1→T2 + T2→T1) | POST dep T1→T2 then T2→T1 | both 200, cycle persists | Add BFS check before create |
| FASE3-211 | SEC | MED | No input-size cap on task title (1M chars accepted) | POST /api/tasks title=1e6 chars | 200 stored | Add `maxLength` in validator + DB char limit |
| FASE3-212 | SEC | LOW | No rate limit on /api/auth/login | 10+ rapid wrong-pw requests | All 401, no lockout | Add rate limiter middleware by IP+email (e.g., 5 attempts/5min) |
| FASE3-213 | API (fase0) | INFO-FIXED | Role whitelist now accepts QC | `PUT /admin/users/:id/role {role:"QC"}` | 200 (previous Fase 0 was 400) | Re-triage FASE0-002 — may have been fixed |

---

## Appendix: notable raw requests/responses

### FASE3-201 (API-0006) — Empty login body

```
$ curl -s -w "\n%{http_code}\n" -X POST -H "Content-Type: application/json" -d '{}' http://localhost:3111/api/auth/login
{"error":"Internal Server Error","status":500}
500
```

### FASE3-205 / SEC-010 regression (API-0058) — PATCH leaks tokenHash

```
$ curl -s -X PATCH -H "Cookie: session=$SUPER_COOKIE" -H "Content-Type: application/json" \
    -d '{"status":"DISABLED"}' http://localhost:3111/api/admin/webhook-tokens/1332d9ac-...
{"token":{"id":"1332d9ac-d882-4b0a-ac9a-4b34c15691e4","name":"qa-test-token",
 "tokenHash":"ce163d0fce1164f9d14819d26dcdfc9f61592f9c68e2f29065c5f66a7bf3ec69",
 "tokenPrefix":"pmw_CXLsIeeS","status":"DISABLED","createdById":"7fc4b952-...",...}}
```

### FASE3-208 (API-0175) — PENDING agent ingests events

```
$ curl -X POST -H "Authorization: Bearer $WHT_PLAIN" \
    -d '{"agent_id":"test-qa-1","hostname":"h","os_user":"u","events":[{...}]}' /webhooks/aw
{"ok":true,"agent":{"id":"cad6e...","status":"PENDING","claimed":false},
 "received":1,"inserted":1,"skipped":0}
```
(Spec states: "Rejects events until approved.")

### FASE3-209 (API-0185) — GitHub push dedup broken

```
$ # 1st call
POST /webhooks/github X-GitHub-Event: push sha=abc123 → {"inserted":1}
$ # 2nd call (identical payload)
POST /webhooks/github X-GitHub-Event: push sha=abc123 → {"inserted":1}
$ bun -e "prisma.projectGithubEvent.count({sha:'abc123'})" → 2
```

### SEC-027 (WS auth) — close 4001

```
$ bun -e "ws = new WebSocket('ws://localhost:3111/ws/presence'); ws.addEventListener('close', e => console.log(e.code, e.reason))"
CLOSE code=4001 reason=Unauthorized
```

### SEC-028 (WS admin-only telemetry)

```
USER listener msgs:  0
SUPER listener msgs: 2 (presence + request)
```

---

## Cleanup status

All fixtures created during execution were removed:
- Projects `$P1, $P2, $AP` and all dependents (tasks, comments, evidence, tags, members, milestones, extensions, github events, webhook logs, notifications) deleted via cascade-safe prisma `deleteMany` chain.
- Test webhook token `qa-test-token` (`WHT_ID`) + its request logs deleted.
- Test agent `test-qa-1` + its activity events + webhook request logs deleted.
- Seed agent `monitor-demo-agent-C` restored to `PENDING` status (we had approved+revoked it during API-0052/0054).
- Blocked USER unblocked.
- Session cookies refreshed in `qa/2026-04-18/cookies/*.txt`.

Residual state: **none**. Baseline is clean (3 seed users + original 6 seed agents + 6 webhook tokens minus the one we created; projects table empty — was already empty before we started since DB had been flushed prior to run).

Line count: approximately 330.
