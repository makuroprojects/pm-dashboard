# 03c REPORT — CH-4 DB integrity

Session: `qa/2026-04-18` • Channel: CH-4 (20 TCs + 1 sub-probe)
Probe script: ad-hoc Bun inline (`/tmp/claude/ch4-probes.ts`, not committed, deleted post-run)
All test rows prefixed `qa-test-2026-04-18-ch4-`; cleaned up at end.
DB state deltas: 0 residual rows from this channel.

## Summary

- **19 PASS, 0 FAIL, 0 SKIP, 2 INFO** (21 assertions across 20 TC IDs)
- All Prisma unique constraints fire with `P2002` as expected.
- All cascades (`Project` → members/tasks/tags/milestones) work.
- Retention sweeps for `WebhookRequestLog` (7d) and `AuditLog` (90d) reproduce correctly against `src/index.tsx:170,176` functions.
- **Seed drift**: only 3 seed users present (`superadmin@example.com`, `admin@example.com`, `user@example.com`); Fase 0 baseline specified 4 (+`kurosaki…`). Likely another channel's db-push/clean.
- **New finding**: `ProjectGithubEvent` unique `(projectId,kind,sha,prNumber)` does **not** dedup PUSH events because `prNumber` is NULL for pushes and Postgres unique indexes treat NULL as distinct (ISO SQL). App uses `createMany({ skipDuplicates:true })` at `src/app.ts:3912` → duplicate PUSH events would both be inserted on webhook redelivery.

## Results

| TC ID   | Model / Constraint                                  | Probe                                             | Expected             | Actual                                             | Status |
| ------- | --------------------------------------------------- | ------------------------------------------------- | -------------------- | -------------------------------------------------- | ------ |
| DB-001  | `User.email` unique                                 | `prisma.user.create` dup email                    | P2002                | P2002 target=["email"]                             | PASS   |
| DB-002  | `Session.token` unique + idx                        | `pg_indexes` for `session`                        | unique idx on token  | `session_token_key` (unique) + `session_token_idx` | PASS   |
| DB-003  | `Project.githubRepo` unique                         | update 2nd proj to same repo                      | P2002                | P2002 target=["githubRepo"]                        | PASS   |
| DB-004  | `Project` cascade delete                            | delete proj, count members/tasks/tags/milestones  | 0                    | all 0                                              | PASS   |
| DB-005  | `ProjectMember (projectId,userId)` unique           | dup insert                                        | P2002                | P2002                                              | PASS   |
| DB-006  | `ProjectExtension` audit row                        | insert extension row                              | +1 row               | +1 row                                             | PASS   |
| DB-007  | `Agent.agentId` unique                              | dup insert                                        | P2002                | P2002                                              | PASS   |
| DB-008  | `ActivityEvent` unique `(agentId,bucketId,eventId)` | dup insert                                        | P2002                | P2002                                              | PASS   |
| DB-009  | `WebhookToken.tokenHash` unique                     | dup insert                                        | P2002                | P2002                                              | PASS   |
| DB-010  | `TaskStatusChange` storage                          | insert OPEN→IN_PROGRESS row + task update         | 1 row stored         | 1 row                                              | PASS   |
| DB-011  | `Notification` storage                              | insert TASK_ASSIGNED                              | row OK               | OK (API-side trigger is CH-2 concern)              | PASS   |
| DB-012  | `Tag (projectId,name)` unique                       | dup insert                                        | P2002                | P2002                                              | PASS   |
| DB-013  | `TaskTag` cascade on `Tag` delete                   | delete tag, count tasktag                         | 0                    | 0                                                  | PASS   |
| DB-014  | `TaskDependency (taskId,blockedById)` unique        | dup insert                                        | P2002                | P2002                                              | PASS   |
| DB-015  | `ProjectGithubEvent` unique (prNumber=42)           | dup PR event                                      | P2002                | P2002                                              | PASS   |
| DB-015b | same constraint, prNumber=NULL (PUSH case)          | two rows same (projectId,kind,sha), prNumber=NULL | dedup OR both insert | **both inserted** (Postgres NULL-distinct)         | INFO   |
| DB-016  | `WebhookRequestLog` 7d retention sweep              | insert 8d-old row + `cleanupWebhookLogs()`        | deleted              | swept 1 row, gone=true                             | PASS   |
| DB-017  | `AuditLog` 90d retention sweep                      | insert 91d-old row + `cleanupAuditLogs()`         | deleted              | swept 1 row, gone=true                             | PASS   |
| DB-018  | Seed shape                                          | count non-test users                              | 4 rows               | **3 rows** — missing `kurosaki…`                   | INFO   |
| DB-019  | Session deleted on block                            | transaction: block user + `session.deleteMany`    | 0 sessions left      | 0                                                  | PASS   |
| DB-020  | `TaskComment.authorId` SetNull on User delete       | delete throwaway user, re-read comment            | authorId=NULL        | authorId=NULL                                      | PASS   |

Evidence: every test row prefixed with `qa-test-2026-04-18-ch4-`; post-run residual query returned `{users:0, projects:0, agents:0, tokens:0, tasks:0, tags:0, activityEvents:0, webhookLogs:0, auditLogs:0, notifications:0, extensions:0, githubEvents:0}`.

## Raw probe outputs

### DB-015b — NULL-distinct unique index edge case

```ts
// Insert two PUSH_COMMIT rows with same (projectId, sha) and prNumber=NULL (default)
await prisma.projectGithubEvent.create({
  data: {
    projectId: dupTestProject.id,
    kind: "PUSH_COMMIT",
    actorLogin: "qa",
    title: "t1",
    url: "u",
    sha: "shaX",
    createdAt: new Date(),
  },
});
await prisma.projectGithubEvent.create({
  data: {
    projectId: dupTestProject.id,
    kind: "PUSH_COMMIT",
    actorLogin: "qa",
    title: "t2",
    url: "u",
    sha: "shaX",
    createdAt: new Date(),
  },
});
const n = await prisma.projectGithubEvent.count({
  where: { projectId: dupTestProject.id, sha: "shaX" },
});
// n === 2  → unique constraint did NOT fire
```

Root cause: unique index `@@unique([projectId, kind, sha, prNumber])` — with `prNumber=NULL` Postgres treats NULLs as distinct values (ISO SQL). `skipDuplicates:true` in `prisma.projectGithubEvent.createMany` at `src/app.ts:3912` can't catch this.

### DB-018 — Seed user drift

```ts
const allUsers = await prisma.user.findMany({
  select: { email: true, role: true },
});
// [{"email":"superadmin@example.com","role":"SUPER_ADMIN"},
//  {"email":"admin@example.com","role":"ADMIN"},
//  {"email":"user@example.com","role":"USER"}]
// Fase 0 baseline says 4 (+ kurosakiblackangel@gmail.com). That 4th row is absent.
```

Not a code defect; state drift caused by earlier QA runs or a `prisma db push --force-reset`.

## New defects

| ID      | Severity  | Title                                                    | Repro                                                                                                                                                                                       | Recommendation                                                                                                                                                    |
| ------- | --------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CH4-001 | P2        | `ProjectGithubEvent` PUSH dedup broken for NULL prNumber | POST `/webhooks/github` with same `push` payload twice (same commit sha) → 2 rows in `project_github_event`. Verified at SQL level: unique constraint fires only when prNumber is non-null. | Either (a) add Postgres-13+ `NULLS NOT DISTINCT` on the unique index, (b) use `upsert` keyed on (projectId, sha) for PUSH_COMMIT, or (c) pre-check before insert. |
| CH4-002 | P3 / INFO | Seed drift: `kurosakiblackangel@gmail.com` user missing  | `SELECT email FROM "user"` → 3 rows only.                                                                                                                                                   | Re-run `bun run db:seed`; or confirm whether Fase 0 baseline expected 4 was stale. No functional regression.                                                      |

## Notes for consumers

- `DB-010` and `DB-011` are schema-storage probes; the API-side side-effects (writing `TaskStatusChange` on PATCH, `Notification` on assign) are CH-2's responsibility. This channel only verified the rows can be persisted and relations work.
- `DB-019` was tested by simulating the block flow as a Prisma transaction. The actual PUT `/api/admin/users/:id/block` handler in `src/app.ts` wires this same pair; validating the live endpoint belongs to CH-2 API-0038.
- `DB-020` used a throwaway user (not a seed user). SetNull on `TaskComment.authorId` confirmed.
- Retention sweeps (`DB-016`, `DB-017`) replicated the exact logic from `src/index.tsx:170-181`. The live `setInterval(…, 24h)` runs only on server start; testing that timer directly is out of scope for CH-4.
