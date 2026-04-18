import { z } from 'zod'
import { appLog } from '../../../src/lib/applog'
import { prisma } from '../../../src/lib/db'
import { jsonText, type ToolModule } from './shared'

async function audit(userId: string | null, action: string, detail: string | null) {
  await prisma.auditLog.create({ data: { userId, action, detail, ip: 'mcp' } }).catch(() => {})
}

async function resolveUserEmail(email: string) {
  return prisma.user.findUnique({ where: { email }, select: { id: true, email: true, name: true, role: true } })
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
        description: 'Create a new task/bug/QC item in a project.',
        inputSchema: {
          projectId: z.string(),
          title: z.string().min(1),
          description: z.string().min(1),
          kind: z.enum(['TASK', 'BUG', 'QC']).default('TASK'),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
          reporterEmail: z.string().email(),
          assigneeEmail: z.string().email().optional(),
          route: z.string().optional(),
          dueAt: z.string().optional(),
        },
      },
      async ({ projectId, title, description, kind, priority, reporterEmail, assigneeEmail, route, dueAt }) => {
        const reporter = await resolveUserEmail(reporterEmail)
        if (!reporter) return jsonText({ error: `Reporter not found: ${reporterEmail}` })
        let assigneeId: string | null = null
        if (assigneeEmail) {
          const a = await resolveUserEmail(assigneeEmail)
          if (!a) return jsonText({ error: `Assignee not found: ${assigneeEmail}` })
          assigneeId = a.id
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
            dueAt: dueAt ? new Date(dueAt) : null,
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
        description: 'Update task fields. Set status=CLOSED to close (stamps closedAt); status=REOPENED clears closedAt.',
        inputSchema: {
          taskId: z.string(),
          title: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED']).optional(),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
          kind: z.enum(['TASK', 'BUG', 'QC']).optional(),
          assigneeEmail: z.string().email().nullable().optional(),
          route: z.string().nullable().optional(),
          dueAt: z.string().nullable().optional(),
        },
      },
      async ({ taskId, assigneeEmail, dueAt, status, ...rest }) => {
        const data: Record<string, unknown> = { ...rest }
        if (status !== undefined) {
          data.status = status
          if (status === 'CLOSED') data.closedAt = new Date()
          if (status === 'REOPENED') data.closedAt = null
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
        if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null
        const task = await prisma.task.update({ where: { id: taskId }, data })
        await audit(null, 'MCP_TASK_UPDATED', `#${task.id} ${Object.keys(data).join(',')}`)
        return jsonText({ ok: true, task })
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
  },
}
