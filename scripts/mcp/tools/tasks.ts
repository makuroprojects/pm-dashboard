import { z } from 'zod'
import { appLog } from '../../../src/lib/applog'
import { prisma } from '../../../src/lib/db'
import { jsonText, type ToolModule } from './shared'

type TaskKind = 'TASK' | 'BUG' | 'QC'
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'

async function audit(userId: string | null, action: string, detail: string | null) {
  await prisma.auditLog.create({ data: { userId, action, detail, ip: 'mcp' } }).catch(() => {})
}

async function resolveUserEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, role: true } })
}

const TRANSITIONS: Record<TaskKind, Record<TaskStatus, TaskStatus[]>> = {
  TASK: {
    OPEN: ['IN_PROGRESS', 'CLOSED'],
    IN_PROGRESS: ['OPEN', 'CLOSED'],
    READY_FOR_QC: ['CLOSED', 'REOPENED'],
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: ['REOPENED'],
  },
  BUG: {
    OPEN: ['IN_PROGRESS', 'CLOSED'],
    IN_PROGRESS: ['READY_FOR_QC', 'CLOSED'],
    READY_FOR_QC: ['CLOSED', 'REOPENED'],
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: ['REOPENED'],
  },
  QC: {
    OPEN: ['IN_PROGRESS', 'CLOSED'],
    IN_PROGRESS: ['READY_FOR_QC', 'CLOSED'],
    READY_FOR_QC: ['CLOSED', 'REOPENED'],
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: ['REOPENED'],
  },
}

function shortestPath(kind: TaskKind, from: TaskStatus, to: TaskStatus): TaskStatus[] | null {
  if (from === to) return []
  const graph = TRANSITIONS[kind]
  const queue: Array<{ node: TaskStatus; path: TaskStatus[] }> = [{ node: from, path: [] }]
  const seen = new Set<TaskStatus>([from])
  while (queue.length) {
    const { node, path } = queue.shift() as { node: TaskStatus; path: TaskStatus[] }
    for (const next of graph[node]) {
      if (seen.has(next)) continue
      const np = [...path, next]
      if (next === to) return np
      seen.add(next)
      queue.push({ node: next, path: np })
    }
  }
  return null
}

async function validateTagsForProject(projectId: string, tagIds: string[]) {
  if (!tagIds.length) return { ok: true as const }
  const found = await prisma.tag.findMany({
    where: { id: { in: tagIds }, projectId },
    select: { id: true },
  })
  if (found.length !== tagIds.length) {
    return { ok: false as const, error: 'One or more tagIds do not belong to this project' }
  }
  return { ok: true as const }
}

export const tasksReadonly: ToolModule = {
  name: 'tasks-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'task_list',
      {
        title: 'List tasks',
        description: 'List tasks across projects with optional filters.',
        inputSchema: {
          projectId: z.string().optional(),
          status: z.enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED', 'ALL']).default('ALL'),
          kind: z.enum(['TASK', 'BUG', 'QC', 'ALL']).default('ALL'),
          assigneeEmail: z.string().email().optional(),
          limit: z.number().int().min(1).max(500).default(100),
        },
      },
      async ({ projectId, status, kind, assigneeEmail, limit }) => {
        const where: Record<string, unknown> = {}
        if (projectId) where.projectId = projectId
        if (status !== 'ALL') where.status = status
        if (kind !== 'ALL') where.kind = kind
        if (assigneeEmail) {
          const u = await resolveUserEmail(assigneeEmail)
          if (!u) return jsonText({ error: `User not found: ${assigneeEmail}` })
          where.assigneeId = u.id
        }
        const tasks = await prisma.task.findMany({
          where,
          include: {
            project: { select: { id: true, name: true } },
            reporter: { select: { id: true, name: true, email: true } },
            assignee: { select: { id: true, name: true, email: true } },
            _count: { select: { comments: true, evidence: true } },
          },
          orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
          take: limit,
        })
        return jsonText({ count: tasks.length, tasks })
      },
    )

    server.registerTool(
      'task_get',
      {
        title: 'Get task detail',
        description: 'Fetch full task including comments and evidence.',
        inputSchema: { taskId: z.string() },
      },
      async ({ taskId }) => {
        const task = await prisma.task.findUnique({
          where: { id: taskId },
          include: {
            project: { select: { id: true, name: true } },
            reporter: { select: { id: true, name: true, email: true } },
            assignee: { select: { id: true, name: true, email: true } },
            comments: {
              include: { author: { select: { id: true, name: true, email: true } } },
              orderBy: { createdAt: 'asc' },
            },
            evidence: { orderBy: { createdAt: 'asc' } },
          },
        })
        if (!task) return jsonText({ error: 'Task not found' })
        return jsonText({ task })
      },
    )
  },
}

export const tasksTools: ToolModule = {
  name: 'tasks',
  scope: 'admin',
  register(server) {
    server.registerTool(
      'task_create',
      {
        title: 'Create task',
        description: 'Create a new task/bug/QC item in a project. Supports estimate, dates, and tags.',
        inputSchema: {
          projectId: z.string(),
          title: z.string().min(1).max(500),
          description: z.string().min(1),
          kind: z.enum(['TASK', 'BUG', 'QC']).default('TASK'),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
          reporterEmail: z.string().email(),
          assigneeEmail: z.string().email().optional(),
          route: z.string().optional(),
          startsAt: z.string().optional().describe('ISO date'),
          dueAt: z.string().optional().describe('ISO date'),
          estimateHours: z.number().min(0).optional(),
          tagIds: z.array(z.string()).optional().describe('Tag IDs (must belong to the same project)'),
        },
      },
      async ({
        projectId,
        title,
        description,
        kind,
        priority,
        reporterEmail,
        assigneeEmail,
        route,
        startsAt,
        dueAt,
        estimateHours,
        tagIds,
      }) => {
        const reporter = await resolveUserEmail(reporterEmail)
        if (!reporter) return jsonText({ error: `Reporter not found: ${reporterEmail}` })
        let assigneeId: string | null = null
        if (assigneeEmail) {
          const a = await resolveUserEmail(assigneeEmail)
          if (!a) return jsonText({ error: `Assignee not found: ${assigneeEmail}` })
          assigneeId = a.id
        }
        if (tagIds?.length) {
          const ok = await validateTagsForProject(projectId, tagIds)
          if (!ok.ok) return jsonText({ error: ok.error })
        }
        const task = await prisma.task.create({
          data: {
            projectId,
            title,
            description,
            kind,
            priority,
            reporterId: reporter.id,
            assigneeId,
            route: route ?? null,
            startsAt: startsAt ? new Date(startsAt) : null,
            dueAt: dueAt ? new Date(dueAt) : null,
            estimateHours: typeof estimateHours === 'number' ? estimateHours : null,
            tags: tagIds?.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
          },
        })
        await audit(reporter.id, 'MCP_TASK_CREATED', `#${task.id} ${task.title}`)
        appLog('info', `MCP: task created ${task.title} by ${reporter.email}`)
        return jsonText({ ok: true, task })
      },
    )

    server.registerTool(
      'task_update',
      {
        title: 'Update task',
        description:
          'Update task fields. Set status=CLOSED to stamp closedAt; status=REOPENED clears it. Status changes are validated against the task state machine — use task_transition to walk multiple hops.',
        inputSchema: {
          taskId: z.string(),
          title: z.string().max(500).optional(),
          description: z.string().optional(),
          status: z.enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED']).optional(),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
          kind: z.enum(['TASK', 'BUG', 'QC']).optional(),
          assigneeEmail: z.string().email().nullable().optional(),
          route: z.string().nullable().optional(),
          startsAt: z.string().nullable().optional(),
          dueAt: z.string().nullable().optional(),
          estimateHours: z.number().nullable().optional(),
          progressPercent: z.number().min(0).max(100).nullable().optional(),
          tagIds: z.array(z.string()).optional().describe('Replaces the full tag set on the task'),
          actorEmail: z.string().email().optional().describe('Records this user as the author of any status change'),
        },
      },
      async ({ taskId, assigneeEmail, startsAt, dueAt, status, tagIds, actorEmail, ...rest }) => {
        const current = await prisma.task.findUnique({
          where: { id: taskId },
          select: { id: true, projectId: true, status: true, kind: true },
        })
        if (!current) return jsonText({ error: 'Task not found' })
        const data: Record<string, unknown> = { ...rest }
        let statusChange: { from: TaskStatus; to: TaskStatus } | null = null
        if (status !== undefined && status !== current.status) {
          const allowed = TRANSITIONS[current.kind as TaskKind][current.status as TaskStatus]
          if (!allowed.includes(status as TaskStatus)) {
            return jsonText({
              error: `Invalid transition: ${current.status} → ${status} for ${current.kind}. Allowed: ${allowed.join(', ') || '(none)'}. Use task_transition for multi-hop walks.`,
            })
          }
          data.status = status
          if (status === 'CLOSED') data.closedAt = new Date()
          if (status === 'REOPENED') data.closedAt = null
          statusChange = { from: current.status as TaskStatus, to: status as TaskStatus }
        }
        if (assigneeEmail !== undefined) {
          if (assigneeEmail === null) {
            data.assigneeId = null
          } else {
            const a = await resolveUserEmail(assigneeEmail)
            if (!a) return jsonText({ error: `Assignee not found: ${assigneeEmail}` })
            data.assigneeId = a.id
          }
        }
        if (startsAt !== undefined) data.startsAt = startsAt ? new Date(startsAt) : null
        if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null
        if (tagIds !== undefined) {
          const ok = await validateTagsForProject(current.projectId, tagIds)
          if (!ok.ok) return jsonText({ error: ok.error })
        }
        const actor = actorEmail ? await resolveUserEmail(actorEmail) : null
        const task = await prisma.task.update({ where: { id: taskId }, data })
        if (statusChange) {
          await prisma.taskStatusChange.create({
            data: {
              taskId: task.id,
              authorId: actor?.id ?? null,
              fromStatus: statusChange.from,
              toStatus: statusChange.to,
            },
          })
        }
        if (tagIds !== undefined) {
          await prisma.taskTag.deleteMany({ where: { taskId: task.id } })
          if (tagIds.length) {
            await prisma.taskTag.createMany({
              data: tagIds.map((tagId) => ({ taskId: task.id, tagId })),
              skipDuplicates: true,
            })
          }
        }
        await audit(actor?.id ?? null, 'MCP_TASK_UPDATED', `#${task.id} ${Object.keys(data).join(',')}`)
        return jsonText({ ok: true, task, statusChange })
      },
    )

    server.registerTool(
      'task_comment',
      {
        title: 'Comment on task',
        description: 'Add a comment to a task.',
        inputSchema: {
          taskId: z.string(),
          body: z.string().min(1),
          authorEmail: z.string().email(),
        },
      },
      async ({ taskId, body, authorEmail }) => {
        const author = await resolveUserEmail(authorEmail)
        if (!author) return jsonText({ error: `Author not found: ${authorEmail}` })
        const comment = await prisma.taskComment.create({
          data: {
            taskId,
            authorId: author.id,
            authorTag: author.role,
            body,
          },
        })
        return jsonText({ ok: true, comment })
      },
    )

    server.registerTool(
      'task_add_evidence',
      {
        title: 'Attach evidence',
        description: 'Attach a URL (screenshot, commit, log) to a task.',
        inputSchema: {
          taskId: z.string(),
          kind: z.string().describe('e.g. screenshot, commit, log, pr'),
          url: z.string().url(),
          note: z.string().optional(),
        },
      },
      async ({ taskId, kind, url, note }) => {
        const evidence = await prisma.taskEvidence.create({
          data: { taskId, kind, url, note: note ?? null },
        })
        return jsonText({ ok: true, evidence })
      },
    )

    server.registerTool(
      'task_delete',
      {
        title: 'Delete task',
        description: 'Permanently delete a task (cascades to comments and evidence).',
        inputSchema: { taskId: z.string() },
      },
      async ({ taskId }) => {
        const task = await prisma.task.delete({ where: { id: taskId } })
        await audit(null, 'MCP_TASK_DELETED', `#${task.id} ${task.title}`)
        return jsonText({ ok: true, task })
      },
    )

    server.registerTool(
      'task_transition',
      {
        title: 'Walk task to target status',
        description:
          'Apply the shortest valid sequence of status transitions to reach targetStatus. Writes a TaskStatusChange row for each hop. Safe to call when already at target (no-op).',
        inputSchema: {
          taskId: z.string(),
          targetStatus: z.enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED']),
          actorEmail: z.string().email().optional(),
        },
      },
      async ({ taskId, targetStatus, actorEmail }) => {
        const current = await prisma.task.findUnique({
          where: { id: taskId },
          select: { id: true, status: true, kind: true },
        })
        if (!current) return jsonText({ error: 'Task not found' })
        const path = shortestPath(current.kind as TaskKind, current.status as TaskStatus, targetStatus)
        if (path === null) {
          return jsonText({
            error: `No valid path from ${current.status} to ${targetStatus} for ${current.kind}`,
          })
        }
        if (path.length === 0) {
          return jsonText({ ok: true, task: current, hops: [], message: 'Already at target status' })
        }
        const actor = actorEmail ? await resolveUserEmail(actorEmail) : null
        let last = current.status as TaskStatus
        let task = null as Awaited<ReturnType<typeof prisma.task.update>> | null
        for (const next of path) {
          const data: Record<string, unknown> = { status: next }
          if (next === 'CLOSED') data.closedAt = new Date()
          if (next === 'REOPENED') data.closedAt = null
          task = await prisma.task.update({ where: { id: taskId }, data })
          await prisma.taskStatusChange.create({
            data: {
              taskId,
              authorId: actor?.id ?? null,
              fromStatus: last,
              toStatus: next,
            },
          })
          last = next
        }
        await audit(actor?.id ?? null, 'MCP_TASK_TRANSITIONED', `#${taskId} ${current.status} → ${path.join(' → ')}`)
        return jsonText({ ok: true, task, hops: path })
      },
    )

    server.registerTool(
      'task_checklist_add',
      {
        title: 'Add checklist items',
        description:
          'Append checklist items to a task. `order` auto-increments from current max. Returns the created items.',
        inputSchema: {
          taskId: z.string(),
          items: z
            .array(
              z.object({
                title: z.string().min(1),
                done: z.boolean().default(false),
              }),
            )
            .min(1),
        },
      },
      async ({ taskId, items }) => {
        const existing = await prisma.taskChecklistItem.findFirst({
          where: { taskId },
          orderBy: { order: 'desc' },
          select: { order: true },
        })
        const baseOrder = (existing?.order ?? -1) + 1
        const created = await prisma.$transaction(
          items.map((it, i) =>
            prisma.taskChecklistItem.create({
              data: { taskId, title: it.title, done: it.done, order: baseOrder + i },
            }),
          ),
        )
        return jsonText({ ok: true, created })
      },
    )

    server.registerTool(
      'task_checklist_update',
      {
        title: 'Update checklist item',
        description: 'Toggle done or rename a checklist item.',
        inputSchema: {
          itemId: z.string(),
          title: z.string().optional(),
          done: z.boolean().optional(),
          order: z.number().int().optional(),
        },
      },
      async ({ itemId, ...rest }) => {
        const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
        if (!Object.keys(data).length) return jsonText({ error: 'Nothing to update' })
        const item = await prisma.taskChecklistItem.update({ where: { id: itemId }, data })
        return jsonText({ ok: true, item })
      },
    )

    server.registerTool(
      'task_checklist_delete',
      {
        title: 'Delete checklist item',
        inputSchema: { itemId: z.string() },
      },
      async ({ itemId }) => {
        const item = await prisma.taskChecklistItem.delete({ where: { id: itemId } })
        return jsonText({ ok: true, item })
      },
    )

    server.registerTool(
      'task_dependency_add',
      {
        title: 'Add task dependency',
        description: 'Mark `taskId` as blocked by `blockedByTaskId`. Rejects self-dependencies and duplicates.',
        inputSchema: {
          taskId: z.string(),
          blockedByTaskId: z.string(),
        },
      },
      async ({ taskId, blockedByTaskId }) => {
        if (taskId === blockedByTaskId) return jsonText({ error: 'A task cannot block itself' })
        const [a, b] = await Promise.all([
          prisma.task.findUnique({ where: { id: taskId }, select: { id: true, projectId: true } }),
          prisma.task.findUnique({ where: { id: blockedByTaskId }, select: { id: true, projectId: true } }),
        ])
        if (!a) return jsonText({ error: `Task not found: ${taskId}` })
        if (!b) return jsonText({ error: `Task not found: ${blockedByTaskId}` })
        if (a.projectId !== b.projectId) {
          return jsonText({ error: 'Cross-project dependencies are not allowed' })
        }
        try {
          const dep = await prisma.taskDependency.create({ data: { taskId, blockedById: blockedByTaskId } })
          return jsonText({ ok: true, dep })
        } catch (e) {
          return jsonText({ error: `Dependency already exists or insert failed: ${(e as Error).message}` })
        }
      },
    )

    server.registerTool(
      'task_dependency_remove',
      {
        title: 'Remove task dependency',
        inputSchema: {
          taskId: z.string(),
          blockedByTaskId: z.string(),
        },
      },
      async ({ taskId, blockedByTaskId }) => {
        const res = await prisma.taskDependency.deleteMany({
          where: { taskId, blockedById: blockedByTaskId },
        })
        return jsonText({ ok: true, removed: res.count })
      },
    )

    server.registerTool(
      'task_bulk_create',
      {
        title: 'Bulk-create tasks on a project',
        description:
          'Create multiple tasks on one project in a single call. Ideal for seeding varied data. Returns per-row result.',
        inputSchema: {
          projectId: z.string(),
          reporterEmail: z.string().email().describe('Default reporter for all rows (per-row override coming later)'),
          tasks: z
            .array(
              z.object({
                title: z.string().min(1).max(500),
                description: z.string().min(1),
                kind: z.enum(['TASK', 'BUG', 'QC']).default('TASK'),
                priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
                assigneeEmail: z.string().email().optional(),
                startsAt: z.string().optional(),
                dueAt: z.string().optional(),
                estimateHours: z.number().min(0).optional(),
                tagIds: z.array(z.string()).optional(),
                finalStatus: z
                  .enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED'])
                  .optional()
                  .describe('If set, walks task to this status after create'),
              }),
            )
            .min(1)
            .max(100),
        },
      },
      async ({ projectId, reporterEmail, tasks }) => {
        const reporter = await resolveUserEmail(reporterEmail)
        if (!reporter) return jsonText({ error: `Reporter not found: ${reporterEmail}` })

        const emails = new Set<string>()
        const allTagIds = new Set<string>()
        for (const t of tasks) {
          if (t.assigneeEmail) emails.add(t.assigneeEmail)
          if (t.tagIds) for (const id of t.tagIds) allTagIds.add(id)
        }
        const users = emails.size
          ? await prisma.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true, email: true } })
          : []
        const userByEmail = new Map(users.map((u) => [u.email, u.id]))
        if (allTagIds.size) {
          const found = await prisma.tag.findMany({
            where: { id: { in: [...allTagIds] }, projectId },
            select: { id: true },
          })
          if (found.length !== allTagIds.size) {
            return jsonText({ error: 'One or more tagIds do not belong to this project' })
          }
        }

        const results: Array<{ index: number; ok: boolean; id?: string; error?: string; hops?: TaskStatus[] }> = []
        for (let i = 0; i < tasks.length; i++) {
          const t = tasks[i]
          try {
            let assigneeId: string | null = null
            if (t.assigneeEmail) {
              const id = userByEmail.get(t.assigneeEmail)
              if (!id) throw new Error(`Assignee not found: ${t.assigneeEmail}`)
              assigneeId = id
            }
            const task = await prisma.task.create({
              data: {
                projectId,
                kind: t.kind,
                title: t.title,
                description: t.description,
                priority: t.priority,
                reporterId: reporter.id,
                assigneeId,
                startsAt: t.startsAt ? new Date(t.startsAt) : null,
                dueAt: t.dueAt ? new Date(t.dueAt) : null,
                estimateHours: typeof t.estimateHours === 'number' ? t.estimateHours : null,
                tags: t.tagIds?.length ? { create: t.tagIds.map((tagId) => ({ tagId })) } : undefined,
              },
            })
            let hops: TaskStatus[] = []
            if (t.finalStatus && t.finalStatus !== 'OPEN') {
              const path = shortestPath(t.kind, 'OPEN', t.finalStatus)
              if (path === null) throw new Error(`No valid path OPEN → ${t.finalStatus} for ${t.kind}`)
              let last: TaskStatus = 'OPEN'
              for (const next of path) {
                const data: Record<string, unknown> = { status: next }
                if (next === 'CLOSED') data.closedAt = new Date()
                if (next === 'REOPENED') data.closedAt = null
                await prisma.task.update({ where: { id: task.id }, data })
                await prisma.taskStatusChange.create({
                  data: { taskId: task.id, authorId: reporter.id, fromStatus: last, toStatus: next },
                })
                last = next
              }
              hops = path
            }
            results.push({ index: i, ok: true, id: task.id, hops })
          } catch (e) {
            results.push({ index: i, ok: false, error: (e as Error).message })
          }
        }
        const okCount = results.filter((r) => r.ok).length
        await audit(reporter.id, 'MCP_TASK_BULK_CREATED', `project=${projectId} ok=${okCount}/${tasks.length}`)
        appLog('info', `MCP: task_bulk_create ${okCount}/${tasks.length} on project ${projectId}`)
        return jsonText({ ok: true, total: tasks.length, succeeded: okCount, results })
      },
    )
  },
}
