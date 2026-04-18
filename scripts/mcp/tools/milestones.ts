import { z } from 'zod'
import { prisma } from '../../../src/lib/db'
import { jsonText, type ToolModule } from './shared'

async function audit(userId: string | null, action: string, detail: string | null) {
  await prisma.auditLog.create({ data: { userId, action, detail, ip: 'mcp' } }).catch(() => {})
}

export const milestonesReadonly: ToolModule = {
  name: 'milestones-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'milestone_list',
      {
        title: 'List milestones',
        description: 'List milestones for a project, or across all projects.',
        inputSchema: {
          projectId: z.string().optional(),
          includeCompleted: z.boolean().default(true),
          limit: z.number().int().min(1).max(500).default(200),
        },
      },
      async ({ projectId, includeCompleted, limit }) => {
        const where: Record<string, unknown> = {}
        if (projectId) where.projectId = projectId
        if (!includeCompleted) where.completedAt = null
        const milestones = await prisma.projectMilestone.findMany({
          where,
          orderBy: [{ projectId: 'asc' }, { order: 'asc' }, { dueAt: 'asc' }],
          take: limit,
        })
        return jsonText({ count: milestones.length, milestones })
      },
    )
  },
}

export const milestonesTools: ToolModule = {
  name: 'milestones',
  scope: 'admin',
  register(server) {
    server.registerTool(
      'milestone_create',
      {
        title: 'Create milestone',
        description: 'Add a milestone to a project.',
        inputSchema: {
          projectId: z.string(),
          title: z.string().min(1),
          description: z.string().optional(),
          dueAt: z.string().optional(),
          order: z.number().int().optional(),
        },
      },
      async ({ projectId, title, description, dueAt, order }) => {
        let nextOrder = order
        if (nextOrder === undefined) {
          const last = await prisma.projectMilestone.findFirst({
            where: { projectId },
            orderBy: { order: 'desc' },
            select: { order: true },
          })
          nextOrder = (last?.order ?? -1) + 1
        }
        const milestone = await prisma.projectMilestone.create({
          data: {
            projectId,
            title,
            description: description ?? null,
            dueAt: dueAt ? new Date(dueAt) : null,
            order: nextOrder,
          },
        })
        await audit(null, 'MCP_MILESTONE_CREATED', `${projectId} ← ${title}`)
        return jsonText({ ok: true, milestone })
      },
    )

    server.registerTool(
      'milestone_update',
      {
        title: 'Update milestone',
        description: 'Update milestone fields. Set completed=true to stamp completedAt, false to clear it.',
        inputSchema: {
          milestoneId: z.string(),
          title: z.string().optional(),
          description: z.string().nullable().optional(),
          dueAt: z.string().nullable().optional(),
          completed: z.boolean().optional(),
          order: z.number().int().optional(),
        },
      },
      async ({ milestoneId, dueAt, completed, ...rest }) => {
        const data: Record<string, unknown> = { ...rest }
        if (dueAt !== undefined) data.dueAt = dueAt ? new Date(dueAt) : null
        if (completed !== undefined) data.completedAt = completed ? new Date() : null
        const milestone = await prisma.projectMilestone.update({ where: { id: milestoneId }, data })
        await audit(null, 'MCP_MILESTONE_UPDATED', `${milestoneId} ${Object.keys(data).join(',')}`)
        return jsonText({ ok: true, milestone })
      },
    )

    server.registerTool(
      'milestone_delete',
      {
        title: 'Delete milestone',
        description: 'Permanently delete a milestone.',
        inputSchema: { milestoneId: z.string() },
      },
      async ({ milestoneId }) => {
        const milestone = await prisma.projectMilestone.delete({ where: { id: milestoneId } })
        await audit(null, 'MCP_MILESTONE_DELETED', `${milestoneId} ${milestone.title}`)
        return jsonText({ ok: true, milestone })
      },
    )
  },
}
