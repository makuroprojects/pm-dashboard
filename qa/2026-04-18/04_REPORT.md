# 04_REPORT — pm-dashboard QA session 2026-04-18

**Scope:** full QA cycle (Fase 0–4) against `main @ e9cc74e`
**Dev server:** `http://localhost:3111` (PORT=3111)
**Roles exercised:** SUPER_ADMIN, ADMIN, USER, anon (QC role not seeded — partial simulation via role API)
**Total test cases:** 260 planned · 234 executed · 26 deferred (mostly UI tail)

---

## 1. Executive summary

**Ship decision (today):** 🛑 **NO-GO for multi-tenant / public-facing deploy.** GO for continued internal dev.

Blockers are not in the business logic — auth, RBAC, tenant isolation, XSS defense, and most CRUD flows work correctly. The blockers are in **two integrity holes and a secret-leak**:

1. **Webhook token hash is leaked** via `PATCH /api/admin/webhook-tokens/:id` response body — defeats the entire hash-at-rest design. (SEC-010 / API-0058 / FASE3-205)
2. **PENDING pm-watch agents ingest events** — the documented approve-gate is not enforced at the webhook handler; any agent with a valid token writes `ActivityEvent` rows regardless of approval state. (API-0175 / FASE3-208)
3. **GitHub webhook push dedup is broken** — re-delivery of the same commit inserts duplicate `ProjectGithubEvent` rows because the unique index treats `prNumber=NULL` as distinct. Reproduced at three layers (integration test, live API, raw Prisma). (STATIC-005 / API-0185 / CH4-001 / FASE3-209)

Additional must-fix before any public deploy:
- **Login page leaks seeded credentials** in the form body (gate behind dev flag). (FASE3-UI-003)
- **Admin Console is a placeholder** — stat cards show `—`, sidebar tabs say "Coming in Phase 2". ADMIN role has no functional UI. (FASE3-UI-002)
- **Role routing drifts from docs**: SUPER_ADMIN → `/admin` not `/dev`; USER → `/pm` not `/profile`. Pick one source of truth. (FASE3-UI-001 / CONS-002 / CONS-006 / CONS-007)

---

## 2. TC rollup

| Channel | Planned | Executed | Pass | Fail | Skip | P0 fail | Report |
|---|---:|---:|---:|---:|---:|---:|---|
| CH-1 Static | 6 | 6 | 5 | 1 | 0 | 0 | `03a_REPORT_static_consistency.md` |
| CH-2 API | 148 | 144 | 122 | 22 | 4 | 5 | `03b_REPORT_api_security.md` |
| CH-3 UI/UX | 46 | ~32 | 21 | 6 | ~14 | 0 | `03d_REPORT_ui.md` |
| CH-4 DB | 20 | 20 | 19 | 0 | 0 | 0 (1 INFO) | `03c_REPORT_db.md` |
| CH-5 Security | 28 | 26 | 23 | 4 | 1 | 2 | `03b_REPORT_api_security.md` |
| CH-6 Consistency | 12 | 12 | 3 | 9 | 0 | 0 | `03a_REPORT_static_consistency.md` |
| **Totals** | **260** | **240** | **193** | **42** | **19** | **7** | — |

Overall pass rate: **80.4 %** (193/240 executed)
P0 gate status (STATIC-001/002/003, SEC-001/005, API-0001/0011, API-0040): **all P0 gates PASSED** — core functional integrity is intact.
P0-severity failures inside the test body: **7** (see §3).

---

## 3. Consolidated bug registry (unique IDs, sorted by severity)

### 🔴 P0 — must fix before any public/multi-tenant deploy

| ID | Area | Title | Repro (shortest) | Fix direction |
|---|---|---|---|---|
| BUG-001 | API / Security | `PATCH /api/admin/webhook-tokens/:id` leaks `tokenHash`+`createdById` in response | PATCH any token → JSON body contains `tokenHash:"ce163d…"` | Serialize through the same safe shape as `GET /webhook-tokens` (omit `tokenHash`, `createdById`) |
| BUG-002 | API (webhook) | `/webhooks/aw` accepts events from PENDING agents | POST event with valid token for a PENDING-status agent → `inserted:1` | Gate insert on `agent.status === 'APPROVED'`; return `received:N, inserted:0, reason:"agent pending"` |
| BUG-003 | API / DB | GitHub `push` webhook re-delivery inserts duplicate rows | POST same push payload twice → `prisma.projectGithubEvent.count({sha})===2` | `NULLS NOT DISTINCT` on unique index (PG 15+) OR `upsert` keyed on `(projectId, sha)` for `PUSH_COMMIT` OR catch `P2002` manually |
| BUG-004 | API (auth) | `POST /api/auth/login` with empty body → 500 | `curl -d '{}' /api/auth/login` | Elysia `t.Object({email:t.String(),password:t.String()})` schema guard |
| BUG-005 | API | Invalid `status` filter on `GET /api/tasks` → 500 | `?status=INVALID` | Whitelist enum or catch Prisma validation error → 400 |
| BUG-006 | API | `POST /api/tasks` with unknown `tagIds` → 500 | body `tagIds:["fake"]` | Validate tag existence before `connect` or map `P2025` → 400 |
| BUG-007 | Security / UI | Login page embeds seed credentials in DOM | Visit `/login` in prod build → see `superadmin@example.com / superadmin123` | Gate the hint block behind `import.meta.env.DEV` |

### 🟠 HIGH

| ID | Area | Title | Fix direction |
|---|---|---|---|
| BUG-008 | UI / Routing | `getDefaultRoute()` drifts from CLAUDE.md — SUPER_ADMIN→`/admin`, USER→`/pm` | Pick one: update code to match docs, or rewrite docs + redirect stubs |
| BUG-009 | UI | Admin Console is a stub — all 3 tabs show placeholder text | Wire to existing admin APIs or hide route until Phase 2 |
| BUG-010 | API (admin) | `POST /api/admin/agents/:id/approve` with unknown id → 500 | `findUnique` + 404 guard before update |

### 🟡 MED

| ID | Area | Title | Fix direction |
|---|---|---|---|
| BUG-011 | API | `PATCH /api/admin/webhook-tokens/:id` requires `status` field even for rename | Make `status` optional in PATCH schema |
| BUG-012 | API | Duplicate `ProjectMember` POST returns 200 instead of 409 | Surface `P2002` as 409 or document upsert semantics |
| BUG-013 | Security | No input-size cap on task title — 1,000,000-char payload accepted & stored | Add `maxLength` in validator + DB `VARCHAR(N)` or similar |
| BUG-014 | Test | `tests/integration/webhook-tokens.test.ts` emits prisma `WebhookToken.delete` record-not-found errors in stderr (test still green) | Fix test ordering so DELETE only hits existing rows |
| BUG-015 | DX | Admin sidebar shows 3 tabs; docs claim 6 | Sync docs or ship tabs |
| BUG-016 | Consistency | `.env.example` missing `DIRECT_URL` (consumed by Prisma shadow DB) | Add `DIRECT_URL=` placeholder |
| BUG-017 | Consistency | `/api/admin/env-map` missing 7 keys: MCP_SECRET, MCP_SECRET_ADMIN, PMW_WEBHOOK_TOKEN, PMW_EVENT_BATCH_MAX, GITHUB_WEBHOOK_SECRET, UPLOADS_DIR, UPLOAD_MAX_BYTES | Extend env-map handler at `src/app.ts:1475-1556` |
| BUG-018 | Consistency | `/api/admin/routes` missing 6 endpoints (GitHub webhook, GitHub summary/feed, evidence upload/fetch, `/mcp`) | Add entries to routes-meta block at `src/app.ts:683-1272` |

### 🔵 LOW / P3

| ID | Area | Title |
|---|---|---|
| BUG-019 | API | `TaskDependency` allows cycles (T1→T2 + T2→T1 both accepted) |
| BUG-020 | Security | No rate limit on `/api/auth/login` — 10× wrong passwords all return 401 instantly |
| BUG-021 | UI | `/dev?tab=settings` is empty placeholder |
| BUG-022 | Consistency | CLAUDE.md lists 13 MCP modules; 15 exist (`milestones`, `projects`, `tasks` missing from docs) |
| BUG-023 | Consistency | Docs claim 79 MCP tools; `server.registerTool(` grep = 71 |
| BUG-024 | Consistency | `.env.example` still lists legacy keys `BETTER_AUTH_*` and `TELEGRAM_NOTIFY_*` with no consumers |
| BUG-025 | Consistency | `qa/RECON.md` still claims "144 HTTP handlers"; actual count is 82 |
| BUG-026 | Docs | CLAUDE.md claims `DELETE /api/tasks/:id` exists — endpoint returns 404 (not implemented) |
| BUG-027 | DB | Seed drift: `kurosakiblackangel@gmail.com` missing (3 users vs 4 expected by Fase 0) |
| BUG-028 | Cookie | Session cookie missing `Secure` flag (INFO — acceptable on http localhost; flag for prod hardening) |

### ℹ️ INFO / deferred decisions

| ID | Area | Title | Note |
|---|---|---|---|
| INFO-A | Security | `POST /__open-in-editor` has no auth — dev-only feature | Documented design risk; ensure dev server never exposed publicly |
| INFO-B | Security | Cookie is `SameSite=Lax`, no CSRF token | Acceptable for cookie-based session + Lax; documented threat model |
| INFO-C | DX | Seed does not include QC user | Document gap or add QC seed |

---

## 4. Known-defect reconciliation

| Pre-loaded known defect | Current state |
|---|---|
| FASE1-004 `DELETE /api/tasks/:id` returns 404 | Still present → **BUG-026** |
| FASE1-001 `/api/admin/routes` meta missing 6 | Still present → **BUG-018** |
| FASE1-002 `/api/admin/env-map` missing 7 | Still present → **BUG-017** |
| FASE1-003 role default route drift | Still present → **BUG-008** |
| FASE0-002 role API rejects QC | **FIXED** — now accepts QC (code at `src/app.ts:438` updated since Fase 0 captured this). Seed gap remains (INFO-C). |
| FASE0-003 cookie missing Secure | Still present → **BUG-028** |

---

## 5. Regression surface — what to watch when fixing

| If you fix … | Likely touches … | Regression risk |
|---|---|---|
| BUG-001 (PATCH token leak) | `src/app.ts` webhook-tokens PATCH handler | Make sure the shape remains backward-compatible for the UI `WebhookTokensPanel` (does it read `tokenHash` from the PATCH response? — NO, per UI review, UI only uses list endpoint) |
| BUG-002 (PENDING gate) | `/webhooks/aw` insert logic | Confirm pm-watch client handles `inserted:0` cleanly without silently looping forever |
| BUG-003 (GH dedup) | unique index on `ProjectGithubEvent` + insert path in `src/app.ts:3912` | If you adopt `NULLS NOT DISTINCT`, a migration is required. Safer alternative: `upsert` keyed on `(projectId, sha)` for `PUSH_COMMIT` only |
| BUG-004..006 (500 on bad input) | Elysia route handlers, validation | Adding Zod/TypeBox validators may change response format; sweep integration tests |
| BUG-007 (login creds leak) | `src/frontend/routes/login.tsx` hint block | Safe — pure UI |
| BUG-008 (route drift) | `src/frontend/hooks/useAuth.ts` + CLAUDE.md | If you change `getDefaultRoute`, re-test all 3 role logins + blocked-user redirect |

---

## 6. Tests expected to still fail after a fix pass

These should be marked as **regressions** only if they re-appear after merge:

- `tests/integration/webhooks-github.test.ts:151` — will pass once BUG-003 is fixed
- `webhook-tokens.test.ts` stderr noise — will disappear once BUG-014 is fixed
- `curl /api/auth/login -d '{}'` → 400 after BUG-004
- `ProjectGithubEvent.count(sha)` after duplicate push → 1 after BUG-003

---

## 7. Coverage gaps (deferred for follow-up)

- **Blocked user UX** — backend verified (SEC-005), frontend flow not screenshot-captured
- **Mobile viewport** (375×812) — sidebar auto-close on nav click, responsive stats
- **Click-to-source editor** (`Ctrl+Shift+Cmd+C`) — inspector + editor launch
- **GitHub integration panel UI** — link-repo flow, webhook hint copy, activity card
- **Project sub-sub-views** (File Structure, User Flow, Data Flow, Env Vars viz, Test Coverage viz, Dependencies viz, Migrations timeline, Sessions, Live Requests) — only API Routes was captured in this session
- **Evidence upload UX** — file picker, upload progress
- **Task dependency picker UI** — blockedBy / blocks selectors
- **Milestone / extension creation UX**
- **Notification bell dropdown** + real-time WS-driven updates
- **Presence WebSocket** live online indicator UX
- **QC role E2E** — no seed; role API accepts it but no functional UI test executed
- **MCP HTTP fallback `POST /mcp`** with SSE Accept header (only smoke-probed, 206 returned 406 for wrong Accept — correct behavior but no full RPC round-trip)

Estimated 1 additional Playwright session (~1h) closes CH-3 tail.

---

## 8. Recommendations — priority order

1. **Patch P0 items** BUG-001 through BUG-007 in a single PR before any deploy.
2. **Decide the routing model** (BUG-008/009) — `/admin` + `/pm` + `/dev` shells is a bigger architectural call than a patch. Likely: keep the new code, update docs.
3. **Add webhook observability tests** to CI — today we have 1 failing integration test (BUG-003) that caught the GH dedup bug; extend that pattern to pm-watch PENDING-agent guard and to the webhook-token PATCH shape.
4. **Rate limit `/api/auth/login`** (BUG-020) before public deploy — cheap middleware, big threat reduction.
5. **Document-or-delete the BETTER_AUTH / TELEGRAM keys** (BUG-024) — pick one.
6. **Sync CLAUDE.md and RECON.md** with the current code (BUG-008/015/018/022/023/025/026) — single doc-cleanup PR.
7. **Schedule Fase-3 CH-3 tail session** to close the ~14 UI TCs deferred due to rate limit.

---

## 9. Files delivered in this session

```
qa/2026-04-18/
├── SESSION.md                             # Fase 0 snapshot
├── INTERNAL_CHECK.md                      # Fase 0 contract
├── cookies/
│   ├── superadmin.txt
│   ├── admin.txt
│   └── user.txt                           # gitignored via qa/*/cookies/
├── 01_SITEMAP.md                          # Fase 1 — 453 lines, 82 routes + 22 models + 79 MCP tools
├── 02_CHECKLIST.md                        # Fase 2 — 457 lines, 260 TCs
├── 03a_REPORT_static_consistency.md       # Fase 3 CH-1+CH-6 — 96 lines
├── 03b_REPORT_api_security.md             # Fase 3 CH-2+CH-5 — 372 lines
├── 03c_REPORT_db.md                       # Fase 3 CH-4 — 107 lines
├── 03d_REPORT_ui.md                       # Fase 3 CH-3 — screenshot synthesis
├── screenshots/                            # 29 PNGs
└── 04_REPORT.md                           # this file — Fase 4 consolidated
```

Also modified during the run: `qa/RECON.md` (false DB-offline blocker corrected in Fase 0).

---

## 10. STOP GATE — final verdict

- [x] P0 gates passed (auth, RBAC, tenant isolation, XSS server-side, DB integrity basics)
- [x] 82 HTTP routes enumerated and tested (minus 4 skipped due to env-toggle dependencies)
- [x] 22 Prisma models exercised for unique/cascade/dedup
- [x] 29 UI screenshots captured across 3 roles + anon
- [ ] P0 defects zero — **FAILED, 7 P0-severity defects**
- [x] No data left in DB from testing
- [x] No open browser processes / chromium locks leaked

**Verdict:** The product is structurally sound but not publishable as-is. The 7 P0 defects are each narrow and individually fixable within hours. Recommended next step: assign BUG-001 through BUG-007 to a single focused fix-PR, re-run CH-2+CH-5 to verify, then re-execute 04_REPORT `§10` checkbox.
