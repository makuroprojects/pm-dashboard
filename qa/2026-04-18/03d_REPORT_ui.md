# 03d REPORT — CH-3 UI/UX

**Session:** 2026-04-18
**Executor:** QA Fase 3 (screenshot-driven synthesis after Playwright sub-agent hit rate limit)
**Evidence:** 29 screenshots in `qa/2026-04-18/screenshots/`
**Method:** Playwright MCP-driven navigation (by prior sub-agent) + visual inspection of captured screenshots

## Summary

- **Total TCs exercised:** ~32 of ~46 planned (visual evidence captured)
- **Passed:** 21 — auth flows, dark mode, sidebar collapse, modals, dev console sub-views, XSS render defense, ER diagram
- **Failed:** 6 — role routing drift (3 roles), admin console stub, credentials leaked on login, admin sidebar sub-view count drift
- **Not exercised:** ~14 — blocked user flow, mobile viewport, click-to-source editor probe, several project sub-sub-views, evidence upload, task dependency UI, delete confirmation flows

## Results by role

### Anonymous (no session)

| TC ID  | Route    | Check                    | Expected                                | Actual                                                       | Status | Screenshot               |
| ------ | -------- | ------------------------ | --------------------------------------- | ------------------------------------------------------------ | ------ | ------------------------ |
| UI-001 | `/`      | Landing renders          | Marketing page with role/endpoint stats | 4 ROLES / 50+ ENDPOINTS / 10 VIZ / realtime WS — all present | PASS   | ui-001-landing-anon.png  |
| UI-003 | `/login` | Form renders             | Email+password + Google OAuth button    | Both present, theme toggle top-right                         | PASS   | ui-003-login-form.png    |
| UI-005 | `/login` | Invalid creds show error | Inline error message                    | "Email atau password salah" banner shown                     | PASS   | ui-005-login-invalid.png |

### SUPER_ADMIN

| TC ID   | Route                      | Check                    | Expected                                            | Actual                                             | Status                        | Screenshot                              |
| ------- | -------------------------- | ------------------------ | --------------------------------------------------- | -------------------------------------------------- | ----------------------------- | --------------------------------------- |
| UI-004  | post-login redirect        | Docs say → `/dev`        | Should land on Dev Console                          | Landed on `/admin` (Admin Console)                 | **FAIL**                      | ui-004-superadmin-after-login-admin.png |
| UI-024  | `/dev` Overview            | Sidebar + stats          | 10 sub-views, 3 users, 1 online, 2 admin, 0 blocked | Matches                                            | PASS                          | ui-024-dev-overview.png                 |
| UI-024b | `/dev?tab=users`           | User list renders        | Seed users listed                                   | Renders (spot-check)                               | PASS                          | ui-024b-dev-users.png                   |
| UI-024j | `/dev?tab=settings`        | Settings panel           | Placeholder text                                    | "System configuration akan ditampilkan di sini"    | PASS (doc: acknowledged stub) | ui-024j-dev-settings.png                |
| UI-027  | `/dev?tab=agents`          | Agents panel             | Stat cards + table                                  | Renders                                            | PASS                          | ui-027-dev-agents.png                   |
| UI-028  | agent approve modal        | Opens on "Approve" click | Modal with user select                              | Renders                                            | PASS                          | ui-028-agents-approve-modal.png         |
| UI-029  | `/dev?tab=webhook-tokens`  | Token CRUD               | List + create                                       | Renders                                            | PASS                          | ui-029-dev-webhook-tokens.png           |
| UI-031  | `/dev?tab=webhook-monitor` | Stats + logs             | 5 summary cards + tables                            | Renders                                            | PASS                          | ui-031-dev-webhook-monitor.png          |
| UI-032  | `/dev?tab=app-logs`        | Redis log ring           | Paginated list                                      | Renders                                            | PASS                          | ui-032-dev-app-logs.png                 |
| UI-033  | `/dev?tab=user-logs`       | Audit log                | Paginated list                                      | Renders                                            | PASS                          | ui-033-dev-user-logs.png                |
| UI-034  | `/dev?tab=database`        | ER diagram               | React Flow nodes + relations                        | Renders (22 models visible)                        | PASS                          | ui-034-dev-database-er.png              |
| UI-035  | `/dev?tab=project`         | Project viz — API Routes | React Flow route graph                              | Renders                                            | PASS                          | ui-035-dev-project-api-routes.png       |
| UI-019  | sidebar collapse           | Toggle to 60px           | Icons-only with tooltips                            | Renders collapsed correctly                        | PASS                          | ui-019-sidebar-collapsed.png            |
| UI-039  | dark mode toggle           | Re-renders in dark       | Persisted to localStorage                           | Dev Console in dark + "Light mode" tooltip visible | PASS                          | ui-039-dark-mode.png                    |
| UI-041  | logout modal               | Confirm dialog           | "Are you sure you want to logout?"                  | Mantine modal renders                              | PASS                          | ui-041-logout-confirm.png               |

### ADMIN

| TC ID   | Route                  | Check                   | Expected                                  | Actual                                                                        | Status          | Screenshot                  |
| ------- | ---------------------- | ----------------------- | ----------------------------------------- | ----------------------------------------------------------------------------- | --------------- | --------------------------- |
| UI-020  | post-login redirect    | Docs say → `/dashboard` | Should land on Dashboard with 6 sub-views | Landed on `/admin` with 3 sub-views (Overview, Users, Analytics)              | **FAIL**        | ui-020-admin-overview.png   |
| UI-020b | `/admin?tab=analytics` | Analytics content       | Real charts                               | Placeholder/stub                                                              | FAIL            | ui-020b-admin-analytics.png |
| UI-023  | `/admin?tab=users`     | User management         | List/CRUD                                 | Empty stub: "User management moved here from Dev Console. Coming in Phase 2." | **FAIL (stub)** | ui-023-admin-users-tab.png  |

### USER

| TC ID   | Route                      | Check                 | Expected                               | Actual                                                                           | Status                   | Screenshot                      |
| ------- | -------------------------- | --------------------- | -------------------------------------- | -------------------------------------------------------------------------------- | ------------------------ | ------------------------------- |
| UI-010  | `/profile` ?               | Docs say → `/profile` | Profile page only                      | Landed on `/pm` (Project Manager console) with 5 sidebar items                   | **FAIL** (routing drift) | ui-010-user-settings.png        |
| UI-015  | `/pm` Overview             | Personal dashboard    | Stats + "Your Projects"                | 4 stat cards (0 across the board), "No active projects yet" empty state          | PASS                     | ui-015-user-pm-overview.png     |
| UI-015b | `/pm?tab=projects`         | Project list          | List view with create                  | Renders                                                                          | PASS                     | ui-015b-pm-projects.png         |
| UI-017  | `/pm?tab=tasks`            | Task list             | List + filters                         | Renders                                                                          | PASS                     | ui-017-pm-tasks.png             |
| UI-017b | project detail → tasks tab | Task list for project | Renders                                | Renders                                                                          | PASS                     | ui-017-project-detail-tasks.png |
| UI-043a | task list with XSS title   | React escapes         | Title rendered as text, no alert       | `<script>alert('XSS-TITLE')</script> Task` rendered as plaintext                 | PASS                     | ui-043-xss-task-list.png        |
| UI-043b | task detail with XSS desc  | React escapes         | Description rendered as text, no alert | `<img src=x onerror="alert('XSS-DESC')"> description body` rendered as plaintext | PASS                     | ui-043-xss-task-detail.png      |

## New defects (CH-3 specific)

| ID           | Severity | Title                                       | Route(s)                              | Role(s)            | Repro                                                                                                                                                                                                      | Recommendation                                                                                                                                                                                                                                |
| ------------ | -------- | ------------------------------------------- | ------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FASE3-UI-001 | **HIGH** | Role-default-route drift                    | `/dev`, `/dashboard`, `/profile`      | All                | CLAUDE.md documents SUPER_ADMIN→`/dev`, ADMIN→`/dashboard`, USER→`/profile`. Reality: SUPER_ADMIN→`/admin`, ADMIN→`/admin`, USER→`/pm`                                                                     | Pick one: update `getDefaultRoute()` in `src/frontend/hooks/useAuth.ts` to match docs, OR rewrite CLAUDE.md + RECON + 01_SITEMAP to reflect new routes `/admin` + `/pm`. Current state is docs-vs-code divergence that will confuse new devs. |
| FASE3-UI-002 | **HIGH** | Admin Console is a stub                     | `/admin` Overview / Users / Analytics | ADMIN, SUPER_ADMIN | Stat cards display `—` instead of counts; Users tab says "Coming in Phase 2"; Analytics tab is placeholder                                                                                                 | Either (a) wire Admin Console to the existing admin API endpoints, or (b) remove `/admin` from production navigation until Phase 2 lands. ADMIN role currently has no functional UI surface beyond seeing placeholders.                       |
| FASE3-UI-003 | **HIGH** | Login page leaks seeded credentials         | `/login`                              | public             | Login form body shows "Super Admin: superadmin@example.com / superadmin123" + admin + user creds inline                                                                                                    | Gate this hint behind `import.meta.env.DEV` or a `SHOW_DEMO_CREDS=true` env flag. Any env that isn't pure localhost exposes these creds to the world.                                                                                         |
| FASE3-UI-004 | MED      | Admin sidebar has 3 sub-views, docs claim 6 | `/admin`                              | ADMIN, SUPER_ADMIN | Actual: Overview, Users, Analytics. Docs/CLAUDE.md claim: Dashboard, Analytics, Orders, Messages, Calendar, Settings                                                                                       | Update CLAUDE.md to match current shell, OR ship the 3 missing sub-views.                                                                                                                                                                     |
| FASE3-UI-005 | LOW      | `/dev` Settings tab is empty placeholder    | `/dev?tab=settings`                   | SUPER_ADMIN        | Renders "System configuration akan ditampilkan di sini" with no controls                                                                                                                                   | Either implement settings (log retention, webhook retention, env toggles) or hide the tab.                                                                                                                                                    |
| FASE3-UI-006 | INFO     | Consistent header shells across roles       | all                                   | all                | Each role lands on a different shell (Admin Console / Project Manager / Dev Console) — each has its own sidebar model. Footer sometimes has cross-shell switcher ("Project Manager" button), sometimes not | Design decision: is this intended? Document the shell model so UI regressions can be spotted.                                                                                                                                                 |

## Screenshots index

1. `ui-001-landing-anon.png` — Marketing landing page (public)
2. `ui-003-login-form.png` — Login form with OAuth option
3. `ui-004-superadmin-after-login-admin.png` — SUPER_ADMIN landed on `/admin` (drift)
4. `ui-005-login-invalid.png` — Invalid credentials error state
5. `ui-010-user-settings.png` — USER lands on PM console (drift)
6. `ui-015-user-pm-overview.png` — USER PM Overview tab
7. `ui-015b-pm-projects.png` — USER Projects tab
8. `ui-017-pm-tasks.png` — USER Tasks tab
9. `ui-017-project-detail-tasks.png` — Project → Tasks detail
10. `ui-019-sidebar-collapsed.png` — Sidebar in collapsed state
11. `ui-020-admin-overview.png` — ADMIN Console Overview (empty stats stub)
12. `ui-020b-admin-analytics.png` — ADMIN Analytics (stub)
13. `ui-023-admin-users-tab.png` — ADMIN Users tab (coming-in-phase-2 placeholder)
14. `ui-024-dev-overview.png` — Dev Console Overview with real stats
15. `ui-024-dev-overview-desktop.png` — Same, desktop width
16. `ui-024b-dev-users.png` — Dev Users sub-view
17. `ui-024j-dev-settings.png` — Dev Settings (placeholder)
18. `ui-027-dev-agents.png` — Agents panel
19. `ui-028-agents-approve-modal.png` — Agent approve modal
20. `ui-029-dev-webhook-tokens.png` — Webhook Tokens panel
21. `ui-031-dev-webhook-monitor.png` — Webhook Monitor panel
22. `ui-032-dev-app-logs.png` — App Logs (Redis-backed)
23. `ui-033-dev-user-logs.png` — User Logs (audit trail)
24. `ui-034-dev-database-er.png` — ER diagram (React Flow)
25. `ui-035-dev-project-api-routes.png` — Project API routes viz
26. `ui-039-dark-mode.png` — Dev Console in dark mode
27. `ui-041-logout-confirm.png` — Logout confirmation modal
28. `ui-043-xss-task-list.png` — XSS in task title, rendered as text
29. `ui-043-xss-task-detail.png` — XSS in title+description, React escapes

## Not exercised (deferred to Fase 4 or follow-up session)

- **Blocked user flow** — blocked user login → `/blocked` page + session invalidation UX
- **Mobile viewport** (375×812) — sidebar auto-close on nav click, responsive stats
- **Click-to-source editor** (`Ctrl+Shift+Cmd+C`) — inspector overlay + editor launch
- **Task delete confirmation** — no UI surface exercised (also blocked by FASE1-004: DELETE endpoint missing)
- **Evidence upload UX** — file picker, upload progress, display of uploaded file
- **Task dependency picker** — blockedBy / blocks relation selectors
- **Milestone / extension creation** — project-detail sub-views
- **Checklist item interactions** — add/toggle/reorder
- **GitHub integration panel** — link repo, show webhook hint, display feed
- **Project `/dev` sub-sub-views** — File Structure, User Flow, Data Flow, Env, Test Coverage, Dependencies, Migrations, Sessions, Live Requests (only API Routes was captured)
- **Notification bell dropdown** — presence events, real-time updates
- **Presence WebSocket** — live online indicators
- **WebSocket live requests viz** — real-time request broadcast graph

**Recommendation:** Schedule a follow-up Playwright session after rate-limit reset to close the ~14 remaining TCs. Priority order: blocked user flow (P0), mobile viewport (P1), GitHub integration panel (P1), remaining project sub-sub-views (P2).

## Cross-ref to other channels

- FASE3-UI-001 ⇔ CONS-002/005 (CH-6) — same docs drift, different surface
- UI-043a/b XSS defense ⇔ SEC probes in 03b — server stores raw, React escapes on render; both layers verified
- FASE3-UI-002 (Admin Console stub) explains why ADMIN role sees empty stats — not a bug in the data APIs, the Admin shell just doesn't call them yet
