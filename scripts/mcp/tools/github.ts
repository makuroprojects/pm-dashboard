import { z } from 'zod'
import { prisma } from '../../../src/lib/db'
import { jsonText, type ToolModule } from './shared'

const EVENT_KINDS = ['PUSH_COMMIT', 'PR_OPENED', 'PR_CLOSED', 'PR_MERGED', 'PR_REVIEWED'] as const

async function resolveProject(ref: string) {
  return prisma.project.findFirst({
    where: { OR: [{ id: ref }, { name: ref }, { githubRepo: ref.toLowerCase() }] },
    select: { id: true, name: true, githubRepo: true },
  })
}

export const githubReadonly: ToolModule = {
  name: 'github-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'github_summary',
      {
        title: 'GitHub activity summary',
        description:
          'Project-level GitHub stats (commits 7d/30d, contributors, open PRs, last push) plus top contributors and recent events. Accepts project id, name, or owner/repo.',
        inputSchema: {
          project: z.string().describe('Project id, name, or githubRepo (owner/repo)'),
        },
      },
      async ({ project }) => {
        const p = await resolveProject(project)
        if (!p) return jsonText({ error: `Project not found: ${project}` })
        if (!p.githubRepo) return jsonText({ linked: false, project: p, repo: null })
        const now = Date.now()
        const day = 24 * 3600 * 1000
        const last7 = new Date(now - 7 * day)
        const last30 = new Date(now - 30 * day)
        const [commits7, commits30, contributors, openPrs, lastEvent, closedPrRows] = await Promise.all([
          prisma.projectGithubEvent.count({
            where: { projectId: p.id, kind: 'PUSH_COMMIT', createdAt: { gte: last7 } },
          }),
          prisma.projectGithubEvent.count({
            where: { projectId: p.id, kind: 'PUSH_COMMIT', createdAt: { gte: last30 } },
          }),
          prisma.projectGithubEvent.groupBy({
            by: ['actorLogin'],
            where: { projectId: p.id, kind: 'PUSH_COMMIT', createdAt: { gte: last30 } },
            _count: { _all: true },
            orderBy: { _count: { actorLogin: 'desc' } },
            take: 10,
          }),
          prisma.projectGithubEvent.findMany({
            where: { projectId: p.id, kind: 'PR_OPENED' },
            select: { prNumber: true, title: true, url: true, actorLogin: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          }),
          prisma.projectGithubEvent.findFirst({
            where: { projectId: p.id, kind: 'PUSH_COMMIT' },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, actorLogin: true },
          }),
          prisma.projectGithubEvent.findMany({
            where: { projectId: p.id, kind: { in: ['PR_CLOSED', 'PR_MERGED'] } },
            select: { prNumber: true },
          }),
        ])
        const closedNums = new Set(closedPrRows.map((r) => r.prNumber).filter((n): n is number => n != null))
        const openPrList = openPrs.filter((p) => p.prNumber != null && !closedNums.has(p.prNumber))
        return jsonText({
          linked: true,
          project: p,
          stats: {
            commits7d: commits7,
            commits30d: commits30,
            contributors30d: contributors.length,
            openPrs: openPrList.length,
            lastPushAt: lastEvent?.createdAt ?? null,
            lastPushBy: lastEvent?.actorLogin ?? null,
          },
          contributors: contributors.map((c) => ({ login: c.actorLogin, commits: c._count._all })),
          openPrs: openPrList.slice(0, 10),
        })
      },
    )

    server.registerTool(
      'github_feed',
      {
        title: 'GitHub event feed',
        description: 'Recent GitHub events for a project. Optional kind filter.',
        inputSchema: {
          project: z.string().describe('Project id, name, or githubRepo (owner/repo)'),
          kind: z.enum([...EVENT_KINDS, 'ALL']).default('ALL'),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ project, kind, limit }) => {
        const p = await resolveProject(project)
        if (!p) return jsonText({ error: `Project not found: ${project}` })
        const events = await prisma.projectGithubEvent.findMany({
          where: {
            projectId: p.id,
            ...(kind !== 'ALL' ? { kind: kind as (typeof EVENT_KINDS)[number] } : {}),
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { matchedUser: { select: { id: true, name: true, email: true } } },
        })
        return jsonText({
          project: { id: p.id, name: p.name, githubRepo: p.githubRepo },
          count: events.length,
          events,
        })
      },
    )

    server.registerTool(
      'github_webhook_logs',
      {
        title: 'GitHub webhook delivery logs',
        description: 'Recent /webhooks/github delivery logs. Filter by status class or project.',
        inputSchema: {
          status: z.enum(['all', 'ok', 'fail', 'auth']).default('all'),
          project: z.string().optional().describe('Optional project id/name/repo filter'),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ status, project, limit }) => {
        const where: Record<string, unknown> = {}
        if (status === 'ok') where.statusCode = 200
        else if (status === 'fail') where.statusCode = { gte: 400 }
        else if (status === 'auth') where.statusCode = 401
        if (project) {
          const p = await resolveProject(project)
          if (!p) return jsonText({ error: `Project not found: ${project}` })
          where.projectId = p.id
        }
        const logs = await prisma.githubWebhookLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        return jsonText({ count: logs.length, logs })
      },
    )
  },
}
