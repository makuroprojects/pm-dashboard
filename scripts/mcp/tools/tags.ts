import { z } from 'zod'
import { prisma } from '../../../src/lib/db'
import { jsonText, type ToolModule } from './shared'

async function audit(userId: string | null, action: string, detail: string | null) {
  await prisma.auditLog.create({ data: { userId, action, detail, ip: 'mcp' } }).catch(() => {})
}

export const tagsReadonly: ToolModule = {
  name: 'tags-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'tag_list',
      {
        title: 'List project tags',
        description: 'List all tags for a project with usage counts.',
        inputSchema: { projectId: z.string() },
      },
      async ({ projectId }) => {
        const tags = await prisma.tag.findMany({
          where: { projectId },
          include: { _count: { select: { tasks: true } } },
          orderBy: { name: 'asc' },
        })
        return jsonText({
          count: tags.length,
          tags: tags.map((t) => ({
            id: t.id,
            name: t.name,
            color: t.color,
            taskCount: t._count.tasks,
          })),
        })
      },
    )
  },
}

export const tagsTools: ToolModule = {
  name: 'tags',
  scope: 'admin',
  register(server) {
    server.registerTool(
      'tag_create',
      {
        title: 'Create project tag',
        description: 'Create a tag on a project. Name is unique per project.',
        inputSchema: {
          projectId: z.string(),
          name: z.string().min(1).max(50),
          color: z.string().optional().describe('Hex or Mantine color name, e.g. #228be6 or "blue"'),
        },
      },
      async ({ projectId, name, color }) => {
        try {
          const tag = await prisma.tag.create({
            data: { projectId, name, ...(color ? { color } : {}) },
          })
          await audit(null, 'MCP_TAG_CREATED', `${projectId} / ${name}`)
          return jsonText({ ok: true, tag })
        } catch (e) {
          return jsonText({ error: `Create failed (name may already exist): ${(e as Error).message}` })
        }
      },
    )

    server.registerTool(
      'tag_update',
      {
        title: 'Rename/recolor tag',
        inputSchema: {
          tagId: z.string(),
          name: z.string().min(1).max(50).optional(),
          color: z.string().optional(),
        },
      },
      async ({ tagId, name, color }) => {
        const data: Record<string, unknown> = {}
        if (name !== undefined) data.name = name
        if (color !== undefined) data.color = color
        if (!Object.keys(data).length) return jsonText({ error: 'Nothing to update' })
        const tag = await prisma.tag.update({ where: { id: tagId }, data })
        await audit(null, 'MCP_TAG_UPDATED', `${tag.id} ${Object.keys(data).join(',')}`)
        return jsonText({ ok: true, tag })
      },
    )

    server.registerTool(
      'tag_delete',
      {
        title: 'Delete tag',
        description: 'Permanently delete a tag (cascades to TaskTag links, keeps tasks).',
        inputSchema: { tagId: z.string() },
      },
      async ({ tagId }) => {
        const tag = await prisma.tag.delete({ where: { id: tagId } })
        await audit(null, 'MCP_TAG_DELETED', `${tag.id} ${tag.name}`)
        return jsonText({ ok: true, tag })
      },
    )
  },
}
