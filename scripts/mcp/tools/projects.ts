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

export const projectsReadonly: ToolModule = {
  name: 'projects-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'project_list',
      {
        title: 'List projects',
        description: 'List projects with member/task counts, status, dates, and task stats.',
        inputSchema: {
          status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED', 'ALL']).default('ALL'),
          includeArchived: z.boolean().default(false),
          limit: z.number().int().min(1).max(500).default(100),
        },
      },
      async ({ status, includeArchived, limit }) => {
        const where: Record<string, unknown> = {}
        if (status !== 'ALL') where.status = status
        if (!includeArchived) where.archivedAt = null
        const projects = await prisma.project.findMany({
          where,
          include: {
            owner: { select: { id: true, name: true, email: true } },
            _count: { select: { members: true, tasks: true, milestones: true } },
          },
          orderBy: [{ status: 'asc' }, { endsAt: 'asc' }, { createdAt: 'desc' }],
          take: limit,
        })
        const stats = await prisma.task.groupBy({
          by: ['projectId', 'status'],
          where: { projectId: { in: projects.map((p) => p.id) } },
          _count: true,
        })
        const statsByProject = new Map<string, Record<string, number>>()
        for (const s of stats) {
          const m = statsByProject.get(s.projectId) ?? {}
          m[s.status] = s._count
          statsByProject.set(s.projectId, m)
        }
        return jsonText({
          count: projects.length,
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: p.status,
            priority: p.priority,
            owner: p.owner.email,
            startsAt: p.startsAt,
            endsAt: p.endsAt,
            originalEndAt: p.originalEndAt,
            archivedAt: p.archivedAt,
            counts: p._count,
            taskStats: statsByProject.get(p.id) ?? {},
          })),
        })
      },
    )

    server.registerTool(
      'project_get',
      {
        title: 'Get project detail',
        description: 'Fetch full project with members, milestones, recent tasks, and recent extensions.',
        inputSchema: {
          projectId: z.string(),
          recentTasks: z.number().int().min(0).max(100).default(10),
        },
      },
      async ({ projectId, recentTasks }) => {
        const project = await prisma.project.findUnique({
          where: { id: projectId },
          include: {
            owner: { select: { id: true, name: true, email: true } },
            members: {
              include: { user: { select: { id: true, name: true, email: true, role: true } } },
            },
            milestones: { orderBy: [{ order: 'asc' }, { dueAt: 'asc' }] },
            extensions: {
              orderBy: { createdAt: 'desc' },
              include: { extendedBy: { select: { id: true, name: true, email: true } } },
              take: 20,
            },
            _count: { select: { members: true, tasks: true, milestones: true } },
          },
        })
        if (!project) return jsonText({ error: 'Project not found' })
        const tasks = await prisma.task.findMany({
          where: { projectId },
          include: { assignee: { select: { id: true, name: true, email: true } } },
          orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
          take: recentTasks,
        })
        return jsonText({ project, recentTasks: tasks })
      },
    )
  },
}

export const projectsTools: ToolModule = {
  name: 'projects',
  scope: 'admin',
  register(server) {
    server.registerTool(
      'project_create',
      {
        title: 'Create project',
        description: 'Create a new project owned by the given user.',
        inputSchema: {
          name: z.string().min(1),
          description: z.string().optional(),
          ownerEmail: z.string().email(),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
          status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).default('ACTIVE'),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
        },
      },
      async ({ name, description, ownerEmail, priority, status, startsAt, endsAt }) => {
        const owner = await resolveUserEmail(ownerEmail)
        if (!owner) return jsonText({ error: `Owner not found: ${ownerEmail}` })
        const project = await prisma.project.create({
          data: {
            name,
            description: description ?? null,
            ownerId: owner.id,
            priority,
            status,
            startsAt: startsAt ? new Date(startsAt) : null,
            endsAt: endsAt ? new Date(endsAt) : null,
          },
        })
        await prisma.projectMember.create({
          data: { projectId: project.id, userId: owner.id, role: 'OWNER' },
        })
        await audit(owner.id, 'MCP_PROJECT_CREATED', `${project.name} (${project.id})`)
        appLog('info', `MCP: project created ${project.name} by ${owner.email}`)
        return jsonText({ ok: true, project })
      },
    )

    server.registerTool(
      'project_update',
      {
        title: 'Update project',
        description: 'Update project fields (name, description, status, priority, dates). Use project_extend for audited deadline changes.',
        inputSchema: {
          projectId: z.string(),
          name: z.string().optional(),
          description: z.string().nullable().optional(),
          status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).optional(),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
          startsAt: z.string().nullable().optional(),
          endsAt: z.string().nullable().optional(),
        },
      },
      async ({ projectId, startsAt, endsAt, ...rest }) => {
        const data: Record<string, unknown> = { ...rest }
        if (startsAt !== undefined) data.startsAt = startsAt ? new Date(startsAt) : null
        if (endsAt !== undefined) data.endsAt = endsAt ? new Date(endsAt) : null
        const project = await prisma.project.update({ where: { id: projectId }, data })
        await audit(null, 'MCP_PROJECT_UPDATED', `${project.id} fields=${Object.keys(data).join(',')}`)
        return jsonText({ ok: true, project })
      },
    )

    server.registerTool(
      'project_extend',
      {
        title: 'Extend project deadline',
        description: 'Push back project.endsAt with audit trail. Preserves originalEndAt on first extension.',
        inputSchema: {
          projectId: z.string(),
          newEndAt: z.string().describe('ISO date for new deadline'),
          reason: z.string().optional(),
          extendedByEmail: z.string().email().optional(),
        },
      },
      async ({ projectId, newEndAt, reason, extendedByEmail }) => {
        const project = await prisma.project.findUnique({ where: { id: projectId } })
        if (!project) return jsonText({ error: 'Project not found' })
        const newEnd = new Date(newEndAt)
        if (project.startsAt && newEnd < project.startsAt) {
          return jsonText({ error: 'newEndAt must be after startsAt' })
        }
        if (project.endsAt && project.endsAt.getTime() === newEnd.getTime()) {
          return jsonText({ error: 'newEndAt matches current endsAt' })
        }
        const extendedBy = extendedByEmail ? await resolveUserEmail(extendedByEmail) : null
        const [, updated] = await prisma.$transaction([
          prisma.projectExtension.create({
            data: {
              projectId,
              extendedById: extendedBy?.id ?? null,
              previousEndAt: project.endsAt,
              newEndAt: newEnd,
              reason: reason ?? null,
            },
          }),
          prisma.project.update({
            where: { id: projectId },
            data: {
              endsAt: newEnd,
              originalEndAt: project.originalEndAt ?? project.endsAt ?? newEnd,
            },
          }),
        ])
        await audit(
          extendedBy?.id ?? null,
          'MCP_PROJECT_EXTENDED',
          `${projectId} → ${newEnd.toISOString()}${reason ? ` (${reason})` : ''}`,
        )
        return jsonText({ ok: true, project: updated })
      },
    )

    server.registerTool(
      'project_add_member',
      {
        title: 'Add/update project member',
        description: 'Add a user to a project with the given role, or update their role if already a member.',
        inputSchema: {
          projectId: z.string(),
          userEmail: z.string().email(),
          role: z.enum(['OWNER', 'PM', 'MEMBER', 'VIEWER']).default('MEMBER'),
        },
      },
      async ({ projectId, userEmail, role }) => {
        const user = await resolveUserEmail(userEmail)
        if (!user) return jsonText({ error: `User not found: ${userEmail}` })
        const member = await prisma.projectMember.upsert({
          where: { projectId_userId: { projectId, userId: user.id } },
          update: { role },
          create: { projectId, userId: user.id, role },
        })
        await audit(user.id, 'MCP_PROJECT_MEMBER_UPSERT', `${projectId} ← ${userEmail} (${role})`)
        return jsonText({ ok: true, member })
      },
    )

    server.registerTool(
      'project_remove_member',
      {
        title: 'Remove project member',
        description: 'Remove a user from a project.',
        inputSchema: {
          projectId: z.string(),
          userEmail: z.string().email(),
        },
      },
      async ({ projectId, userEmail }) => {
        const user = await resolveUserEmail(userEmail)
        if (!user) return jsonText({ error: `User not found: ${userEmail}` })
        await prisma.projectMember.delete({
          where: { projectId_userId: { projectId, userId: user.id } },
        })
        await audit(user.id, 'MCP_PROJECT_MEMBER_REMOVED', `${projectId} ← ${userEmail}`)
        return jsonText({ ok: true })
      },
    )

    server.registerTool(
      'project_delete',
      {
        title: 'Delete project (permanent)',
        description:
          'Permanently delete a project. Cascades to members, tasks, extensions, and milestones. Use project_archive for a reversible alternative.',
        inputSchema: {
          projectId: z.string(),
        },
      },
      async ({ projectId }) => {
        const existing = await prisma.project.findUnique({
          where: { id: projectId },
          select: { id: true, name: true, _count: { select: { tasks: true, members: true, milestones: true } } },
        })
        if (!existing) return jsonText({ error: 'Project not found' })
        await prisma.project.delete({ where: { id: projectId } })
        await audit(
          null,
          'MCP_PROJECT_DELETED',
          `${existing.id} "${existing.name}" (tasks=${existing._count.tasks}, members=${existing._count.members}, milestones=${existing._count.milestones})`,
        )
        appLog('warn', `MCP: project deleted ${existing.name} (${existing.id})`)
        return jsonText({ ok: true, deleted: existing })
      },
    )

    server.registerTool(
      'project_archive',
      {
        title: 'Archive/unarchive project',
        description: 'Set or clear archivedAt. Archived projects are hidden by default in listings.',
        inputSchema: {
          projectId: z.string(),
          archive: z.boolean().default(true),
        },
      },
      async ({ projectId, archive }) => {
        const project = await prisma.project.update({
          where: { id: projectId },
          data: { archivedAt: archive ? new Date() : null },
        })
        await audit(null, archive ? 'MCP_PROJECT_ARCHIVED' : 'MCP_PROJECT_UNARCHIVED', project.id)
        return jsonText({ ok: true, project })
      },
    )

    server.registerTool(
      'project_scaffold',
      {
        title: 'Scaffold a complete project (seeding)',
        description:
          'One-call project seed: creates project + owner-as-OWNER + members + tags + milestones + tasks. Tasks can reference tags by NAME (resolved after tag create). Returns summary with counts + created IDs.',
        inputSchema: {
          name: z.string().min(1),
          description: z.string().optional(),
          ownerEmail: z.string().email(),
          priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
          status: z.enum(['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).default('ACTIVE'),
          startsAt: z.string().optional(),
          endsAt: z.string().optional(),
          members: z
            .array(
              z.object({
                email: z.string().email(),
                role: z.enum(['OWNER', 'PM', 'MEMBER', 'VIEWER']).default('MEMBER'),
              }),
            )
            .optional(),
          tags: z
            .array(z.object({ name: z.string().min(1), color: z.string().optional() }))
            .optional(),
          milestones: z
            .array(
              z.object({
                title: z.string().min(1),
                description: z.string().optional(),
                dueAt: z.string().optional(),
                completed: z.boolean().default(false),
              }),
            )
            .optional(),
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
                tagNames: z.array(z.string()).optional().describe('Resolved against the scaffolded tags by name'),
                finalStatus: z
                  .enum(['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED'])
                  .optional(),
              }),
            )
            .optional(),
        },
      },
      async (args) => {
        const owner = await resolveUserEmail(args.ownerEmail)
        if (!owner) return jsonText({ error: `Owner not found: ${args.ownerEmail}` })

        const memberEmails = [...new Set((args.members ?? []).map((m) => m.email))]
        const assigneeEmails = [...new Set((args.tasks ?? []).map((t) => t.assigneeEmail).filter(Boolean) as string[])]
        const allEmails = [...new Set([...memberEmails, ...assigneeEmails])]
        const resolvedUsers = allEmails.length
          ? await prisma.user.findMany({ where: { email: { in: allEmails } }, select: { id: true, email: true } })
          : []
        const userByEmail = new Map(resolvedUsers.map((u) => [u.email, u.id]))
        const missingEmails = allEmails.filter((e) => !userByEmail.has(e))
        if (missingEmails.length) {
          return jsonText({ error: `Users not found: ${missingEmails.join(', ')}` })
        }

        const project = await prisma.project.create({
          data: {
            name: args.name,
            description: args.description ?? null,
            ownerId: owner.id,
            priority: args.priority,
            status: args.status,
            startsAt: args.startsAt ? new Date(args.startsAt) : null,
            endsAt: args.endsAt ? new Date(args.endsAt) : null,
          },
        })

        await prisma.projectMember.create({
          data: { projectId: project.id, userId: owner.id, role: 'OWNER' },
        })
        for (const m of args.members ?? []) {
          if (m.email === args.ownerEmail) continue
          const userId = userByEmail.get(m.email)
          if (!userId) continue
          await prisma.projectMember.upsert({
            where: { projectId_userId: { projectId: project.id, userId } },
            update: { role: m.role },
            create: { projectId: project.id, userId, role: m.role },
          })
        }

        const tagByName = new Map<string, string>()
        for (const t of args.tags ?? []) {
          const tag = await prisma.tag.create({
            data: { projectId: project.id, name: t.name, ...(t.color ? { color: t.color } : {}) },
          })
          tagByName.set(t.name, tag.id)
        }

        const milestones: { id: string; title: string }[] = []
        for (let i = 0; i < (args.milestones ?? []).length; i++) {
          const m = (args.milestones ?? [])[i]
          const milestone = await prisma.projectMilestone.create({
            data: {
              projectId: project.id,
              title: m.title,
              description: m.description ?? null,
              dueAt: m.dueAt ? new Date(m.dueAt) : null,
              order: i,
              completedAt: m.completed ? new Date() : null,
            },
          })
          milestones.push({ id: milestone.id, title: milestone.title })
        }

        const taskResults: Array<{ index: number; ok: boolean; id?: string; error?: string }> = []
        for (let i = 0; i < (args.tasks ?? []).length; i++) {
          const t = (args.tasks ?? [])[i]
          try {
            const tagIds =
              t.tagNames?.map((n) => {
                const id = tagByName.get(n)
                if (!id) throw new Error(`Tag not scaffolded: ${n}`)
                return id
              }) ?? []
            const assigneeId = t.assigneeEmail ? userByEmail.get(t.assigneeEmail) ?? null : null
            const task = await prisma.task.create({
              data: {
                projectId: project.id,
                kind: t.kind,
                title: t.title,
                description: t.description,
                priority: t.priority,
                reporterId: owner.id,
                assigneeId,
                startsAt: t.startsAt ? new Date(t.startsAt) : null,
                dueAt: t.dueAt ? new Date(t.dueAt) : null,
                estimateHours: typeof t.estimateHours === 'number' ? t.estimateHours : null,
                tags: tagIds.length ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
              },
            })
            if (t.finalStatus && t.finalStatus !== 'OPEN') {
              const TRANSITIONS: Record<string, Record<string, string[]>> = {
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
              const graph = TRANSITIONS[t.kind]
              const queue: Array<{ node: string; path: string[] }> = [{ node: 'OPEN', path: [] }]
              const seen = new Set(['OPEN'])
              let path: string[] | null = null
              while (queue.length) {
                const { node, path: p } = queue.shift() as { node: string; path: string[] }
                for (const next of graph[node] ?? []) {
                  if (seen.has(next)) continue
                  const np = [...p, next]
                  if (next === t.finalStatus) {
                    path = np
                    break
                  }
                  seen.add(next)
                  queue.push({ node: next, path: np })
                }
                if (path) break
              }
              if (!path) throw new Error(`No valid path OPEN → ${t.finalStatus} for ${t.kind}`)
              let last = 'OPEN'
              for (const next of path) {
                const data: Record<string, unknown> = { status: next }
                if (next === 'CLOSED') data.closedAt = new Date()
                if (next === 'REOPENED') data.closedAt = null
                await prisma.task.update({ where: { id: task.id }, data })
                await prisma.taskStatusChange.create({
                  data: {
                    taskId: task.id,
                    authorId: owner.id,
                    fromStatus: last as 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED',
                    toStatus: next as 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED',
                  },
                })
                last = next
              }
            }
            taskResults.push({ index: i, ok: true, id: task.id })
          } catch (e) {
            taskResults.push({ index: i, ok: false, error: (e as Error).message })
          }
        }

        await audit(
          owner.id,
          'MCP_PROJECT_SCAFFOLDED',
          `${project.id} "${project.name}" members=${args.members?.length ?? 0} tags=${args.tags?.length ?? 0} milestones=${args.milestones?.length ?? 0} tasks=${taskResults.filter((r) => r.ok).length}/${args.tasks?.length ?? 0}`,
        )
        appLog('info', `MCP: project_scaffold ${project.name} (${project.id})`)

        return jsonText({
          ok: true,
          project: { id: project.id, name: project.name },
          members: (args.members?.length ?? 0) + 1,
          tags: [...tagByName.entries()].map(([name, id]) => ({ name, id })),
          milestones,
          tasks: {
            total: args.tasks?.length ?? 0,
            succeeded: taskResults.filter((r) => r.ok).length,
            results: taskResults,
          },
        })
      },
    )
  },
}
