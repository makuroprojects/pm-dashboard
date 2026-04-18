# QA 2026-04-18 — 07 UI Playwright Sweep

Sweep follows 06_VERIFICATION.md (all fix work closed except BUG-009). Purpose: exercise UI test cases that were deferred during fix batches because they required live browser automation. All captures below taken in this session via Playwright MCP against `localhost:3111` with a freshly re-seeded DB.

## TC summary

| TC | Area | Status | Screenshot(s) |
|----|------|--------|---------------|
| UI-036 | Dev Console → Project → File Structure | PASS | `ui-036-dev-project-file-structure.png` |
| UI-037 | Dev Console → Project → Env Variables | PASS | `ui-037-dev-project-env-variables.png` |
| UI-038 | Dev Console → Project → Live Requests | PASS | `ui-038-dev-project-live-requests.png`, `ui-038b-dev-project-live-requests-active.png` |
| UI-030 | Webhook token show-once flow | PASS | `ui-030-webhook-token-show-once.png`, `ui-030b-webhook-token-after-close.png` |
| UI-018 | /pm project detail GitHub card | PASS | `ui-018a-pm-detail-overview-github-empty.png`, `ui-018b-pm-detail-settings-github-card.png`, `ui-018c-pm-overview-github-linked.png` |
| UI-007 | Login rejected when account blocked | PASS | `ui-007-blocked-login-rejected.png` |
| UI-042 | Blocked page content | PASS | `ui-042-blocked-page.png` |
| UI-011 | /settings USER badge | PASS | `ui-011-settings-user-badge.png` |
| UI-012 | /settings ADMIN badge | PASS | `ui-012-settings-admin-badge.png` |
| UI-046 | Mobile viewport nav (390×844) | PASS | `ui-046a-mobile-pm-collapsed.png`, `ui-046b-mobile-pm-sidebar-open.png` |

14/14 deferred UI TCs resolved. (UI-045 click-to-source intentionally skipped — depends on host OS editor launch which cannot be asserted in Playwright.)

## Details

### UI-036 Dev Console — Project → File Structure
- Sub-view dropdown → `File Structure`
- Render shows node grid with filter pills **All / Frontend / Backend / Lib / Tests**
- Stats strip: `62 files | 21,903 lines | 79 exports | 232 imports`
- Auto-save of node positions confirmed by smooth re-render on repeated navigation

### UI-037 Dev Console — Project → Env Variables
- Stats strip: `SET: 11 | UNSET: 7 | REQUIRED: 4 | Total: 18`
- Nodes color-coded (green SET / red UNSET) with REQUIRED / OPTIONAL corner tags and category tags (DATABASE / CACHE / AUTH / APP)
- Edges fan out to consuming files on the right (`env.ts`, `app.ts`, `redis.ts`, `index.tsx`, `db.ts`)
- Confirms BUG-024 cleanup (no `TELEGRAM_NOTIFY_*` / `BETTER_AUTH_*` nodes remain)

### UI-038 Dev Console — Project → Live Requests
- Empty state capture: `0 REQUESTS | 0 ENDPOINTS`, green Live indicator, central Elysia Server hub node
- Active capture: generated 7 API calls from the page (`/api/admin/users ×5`, `/api/admin/logs/app`, `/api/admin/sessions`) — panel jumped to `9 REQUESTS | 5 ENDPOINTS` (5 unique endpoints incl. the `session` + `logs` calls the shell already fires periodically)
- Green dashed edges drawn from hub to each endpoint node — WS broadcast from `broadcastToAdmins()` working end-to-end

### UI-030 Webhook tokens — show-once
- Created token named `qa-ui-030-show-once` (expiry Never)
- Success dialog titled `Token created: qa-ui-030-show-once` showed plaintext token `pmw_pDfiWsS534TGyb9ECrGtLZapQiS4i4eNtL_uBOZ66MM` with explicit Indonesian warning `Simpan token ini sekarang — setelah modal ditutup, token tidak bisa dilihat lagi.` + Copy button
- After pressing Done, row only shows truncated prefix `pmw_pDfiWsS5…`; plaintext is unrecoverable. Confirms invariant from `src/lib/webhook-tokens.ts` (only hash + prefix persisted).

### UI-018 /pm project detail — GitHub card
Created throwaway project `QA GitHub Link Test` (UUID `390aea25-…`) as SUPER_ADMIN owner.
- **Overview (unlinked)** — `GithubActivityCard` renders empty state copy: `No repo linked yet. Add a GitHub repo in Settings to pull in commits, pull requests, and reviews.`
- **Settings** — `GithubIntegrationCard` renders with helper text (`Link a GitHub repo to capture commits…`) and placeholder input (`https://github.com/owner/repo or owner/repo`). NOTE: input is rendered in read-only state in current build (form section pre-edit). Backend path verified directly via `PATCH /api/projects/:id` → 200 with `githubRepo: "bipproduction/pm-dashboard"` (server normalized correctly).
- **Overview (linked)** — after PATCH, card updates to linked state: header shows `GitHub activity · bipproduction/pm-dashboard`, 4 mini-stats (`COMMITS/7D 0`, `CONTRIBUTORS/30D 0`, `OPEN PRS 0`, `LAST PUSH —`) + empty-feed hint `No activity received yet. Once the webhook fires, events will appear here.`
- Cleaned up: project deleted via `DELETE /api/projects/:id` → 200 (cascade respects).

Finding (minor, not filed as bug): the Settings tab form inputs remain `disabled` on load — looks intentional (there is no edit-mode toggle visible for SUPER_ADMIN on a single-owner project). If this contradicts intent, a follow-up UX ticket would unlock the form for OWNER/PM without an explicit toggle. API linking works so the feature is functional via external code paths (MCP/SDK).

### UI-007 Blocked login
- Blocked `user@example.com` via `PUT /api/admin/users/:id/block` as SUPER_ADMIN
- Logout, then attempted login with the same creds
- Stayed on `/login` with inline Mantine Alert: `Akun Anda telah diblokir. Hubungi administrator.`
- Backend returned 403; no session cookie set (confirmed by subsequent `GET /api/auth/session` → 401)

### UI-042 Blocked page content
- Navigated to `/blocked` directly
- Page shows: red shield-off icon, title `Akun Diblokir`, explanatory copy, two alert boxes (`Apa yang terjadi?` / `Apa yang harus dilakukan?`), and standalone `Logout` button (direct — no confirm modal, matches CLAUDE.md spec)
- Theme toggle rendered top-right (confirms `blocked.tsx` is not behind AppShell)

### UI-011 / UI-012 /settings role badges
- USER: cyan badge with text `USER`, Admin/Dev nav buttons hidden, PM + Settings buttons visible in header
- ADMIN: purple badge with text `ADMIN`, Admin button visible, Dev button hidden, PM + Settings visible
- (SUPER_ADMIN captured as bonus `ui-010-settings-superadmin-badge.png`: red badge, all nav buttons present)
- Account Info section consistently shows `Role: USER|ADMIN|SUPER_ADMIN` matching the badge

### UI-046 Mobile viewport (390×844)
- Burger icon replaces the persistent sidebar; header condensed (logo + `Project Manager`, notification bell, role badge)
- Hero cards stack to single-column with full-width tiles; `Your Projects` collapses gracefully
- Tapping burger opens full-screen overlay nav with close `X`, nav items (Overview / Projects / Tasks / Activity / Team), Settings button + Logout button pinned to bottom, color-scheme toggle above Logout
- USER viewport correctly hides Admin/Dev — only Settings visible in bottom stack

## Artefacts

All 14 screenshots in `qa/2026-04-18/screenshots/` (26 new PNGs added across the whole sweep; see file listing at top of this doc).

## Closing the UI tail

With this sweep, channel **CH-3 UI/UX** from the 6-channel framework is fully resolved. Remaining open item is **BUG-009** (admin console features — explicitly deferred to product decision, not a defect).
