// Admin overview: system-wide KPIs + per-project health + per-user load +
// consolidated risk report. Backs both the MCP overview tools and the
// /admin Overview panel. Keep Prisma-heavy aggregation here so the MCP
// tool handlers and HTTP endpoints stay thin.

import { prisma } from './db'

const LIVE_MS = 5 * 60 * 1000
const STALE_IN_PROGRESS_MS = 3 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / DAY_MS)
}

export type RiskSeverity = 'none' | 'low' | 'medium' | 'high'

export async function computeAdminOverview(opts: { recentAuditLimit?: number } = {}) {
  const recentAuditLimit = opts.recentAuditLimit ?? 8
  const now = new Date()
  const since24h = new Date(now.getTime() - DAY_MS)
  const since7d = new Date(now.getTime() - 7 * DAY_MS)

  const [
    userCount,
    blockedCount,
    roleGroups,
    projectCount,
    projectsByStatus,
    taskCount,
    tasksByStatus,
    overdueOpen,
    staleInProgress,
    agents,
    pendingAgents,
    webhooks24h,
    webhookSuccess24h,
    webhookEvents24h,
    closed7d,
    extensions7d,
    recentAudit,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { blocked: true } }),
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.project.count({ where: { archivedAt: null } }),
    prisma.project.groupBy({ by: ['status'], _count: true, where: { archivedAt: null } }),
    prisma.task.count(),
    prisma.task.groupBy({ by: ['status'], _count: true }),
    prisma.task.count({
      where: { status: { notIn: ['CLOSED'] }, dueAt: { lt: now, not: null } },
    }),
    prisma.task.count({
      where: {
        status: 'IN_PROGRESS',
        updatedAt: { lt: new Date(now.getTime() - STALE_IN_PROGRESS_MS) },
      },
    }),
    prisma.agent.findMany({ select: { status: true, lastSeenAt: true } }),
    prisma.agent.count({ where: { status: 'PENDING' } }),
    prisma.webhookRequestLog.count({ where: { createdAt: { gte: since24h } } }),
    prisma.webhookRequestLog.count({
      where: { createdAt: { gte: since24h }, statusCode: { lt: 400 } },
    }),
    prisma.webhookRequestLog.aggregate({
      _sum: { eventsIn: true },
      where: { createdAt: { gte: since24h } },
    }),
    prisma.task.count({ where: { status: 'CLOSED', closedAt: { gte: since7d } } }),
    prisma.projectExtension.count({ where: { createdAt: { gte: since7d } } }),
    recentAuditLimit > 0
      ? prisma.auditLog.findMany({
          take: recentAuditLimit,
          orderBy: { createdAt: 'desc' },
          include: { user: { select: { name: true, email: true } } },
        })
      : Promise.resolve([]),
  ])

  const liveAgents = agents.filter(
    (a) => a.status === 'APPROVED' && a.lastSeenAt && now.getTime() - a.lastSeenAt.getTime() < LIVE_MS,
  ).length

  return {
    timestamp: now.toISOString(),
    users: {
      total: userCount,
      blocked: blockedCount,
      byRole: Object.fromEntries(roleGroups.map((g) => [g.role, g._count])),
    },
    projects: {
      active: projectCount,
      byStatus: Object.fromEntries(projectsByStatus.map((g) => [g.status, g._count])),
    },
    tasks: {
      total: taskCount,
      byStatus: Object.fromEntries(tasksByStatus.map((g) => [g.status, g._count])),
      overdueOpen,
      staleInProgress,
      closed7d,
    },
    agents: {
      total: agents.length,
      pending: pendingAgents,
      live: liveAgents,
    },
    webhooks24h: {
      total: webhooks24h,
      success: webhookSuccess24h,
      successRate: webhooks24h > 0 ? Math.round((webhookSuccess24h / webhooks24h) * 1000) / 10 : null,
      eventsIn: webhookEvents24h._sum.eventsIn ?? 0,
    },
    velocity: {
      closed7d,
      extensions7d,
    },
    recentAudit: recentAudit.map((a) => ({
      id: a.id,
      action: a.action,
      detail: a.detail,
      userEmail: a.user?.email ?? null,
      createdAt: a.createdAt,
    })),
  }
}

export async function computeProjectHealth(
  opts: { projectId?: string; includeArchived?: boolean; limit?: number } = {},
) {
  const { projectId, includeArchived = false, limit = 50 } = opts
  const now = new Date()
  const since7d = new Date(now.getTime() - 7 * DAY_MS)
  const projectWhere: Record<string, unknown> = {}
  if (projectId) projectWhere.id = projectId
  if (!includeArchived) projectWhere.archivedAt = null

  const projects = await prisma.project.findMany({
    where: projectWhere,
    include: {
      owner: { select: { email: true, name: true } },
      _count: { select: { tasks: true, members: true, extensions: true } },
    },
    orderBy: [{ priority: 'desc' }, { endsAt: 'asc' }],
    take: limit,
  })
  if (projects.length === 0) {
    return { count: 0, projects: [] as ProjectHealthRow[] }
  }

  const ids = projects.map((p) => p.id)
  const [statusGroups, overdueGroups, closedGroups, blockedRaw] = await Promise.all([
    prisma.task.groupBy({ by: ['projectId', 'status'], where: { projectId: { in: ids } }, _count: true }),
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, status: { notIn: ['CLOSED'] }, dueAt: { lt: now, not: null } },
      _count: true,
    }),
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, status: 'CLOSED', closedAt: { gte: since7d } },
      _count: true,
    }),
    prisma.taskDependency.findMany({
      where: { task: { projectId: { in: ids }, status: { notIn: ['CLOSED'] } } },
      select: { task: { select: { projectId: true } } },
    }),
  ])

  const byProject = new Map<
    string,
    { status: Record<string, number>; overdue: number; closed7d: number; blocked: number }
  >()
  for (const p of projects) {
    byProject.set(p.id, { status: {}, overdue: 0, closed7d: 0, blocked: 0 })
  }
  for (const s of statusGroups) {
    const b = byProject.get(s.projectId)
    if (b) b.status[s.status] = s._count
  }
  for (const o of overdueGroups) {
    const b = byProject.get(o.projectId)
    if (b) b.overdue = o._count
  }
  for (const c of closedGroups) {
    const b = byProject.get(c.projectId)
    if (b) b.closed7d = c._count
  }
  for (const d of blockedRaw) {
    const b = byProject.get(d.task.projectId)
    if (b) b.blocked += 1
  }

  const results: ProjectHealthRow[] = projects.map((p) => {
    const bucket = byProject.get(p.id)!
    const openTotal = Object.entries(bucket.status)
      .filter(([k]) => k !== 'CLOSED')
      .reduce((n, [, v]) => n + v, 0)
    const daysUntilDue = p.endsAt ? daysBetween(p.endsAt, now) : null
    const pastDue = p.endsAt ? p.endsAt.getTime() < now.getTime() && p.status !== 'COMPLETED' : false
    const extensions = p._count.extensions

    let score = 100
    if (pastDue) score -= 35
    if (bucket.overdue > 0) score -= Math.min(25, bucket.overdue * 5)
    if (bucket.blocked > 0) score -= Math.min(15, bucket.blocked * 3)
    if (extensions > 2) score -= 10
    if (extensions > 4) score -= 5
    if (openTotal > 0 && bucket.closed7d === 0 && p.status === 'ACTIVE') score -= 10
    score = Math.max(0, Math.min(100, score))

    const grade =
      score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 45 ? 'D' : score >= 30 ? 'E' : 'F'

    return {
      id: p.id,
      name: p.name,
      status: p.status,
      priority: p.priority,
      owner: p.owner.email,
      endsAt: p.endsAt,
      daysUntilDue,
      pastDue,
      counts: p._count,
      taskStatus: bucket.status,
      openTasks: openTotal,
      overdueTasks: bucket.overdue,
      blockedTasks: bucket.blocked,
      closed7d: bucket.closed7d,
      extensions,
      score,
      grade,
    }
  })

  results.sort((a, b) => a.score - b.score)

  return { count: results.length, projects: results }
}

export interface ProjectHealthRow {
  id: string
  name: string
  status: string
  priority: string
  owner: string
  endsAt: Date | null
  daysUntilDue: number | null
  pastDue: boolean
  counts: { tasks: number; members: number; extensions: number }
  taskStatus: Record<string, number>
  openTasks: number
  overdueTasks: number
  blockedTasks: number
  closed7d: number
  extensions: number
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
}

export async function computeTeamLoad(opts: { projectId?: string; includeUnassigned?: boolean; limit?: number } = {}) {
  const { projectId, includeUnassigned = true, limit = 50 } = opts
  const now = new Date()
  const since7d = new Date(now.getTime() - 7 * DAY_MS)
  const baseWhere: Record<string, unknown> = {}
  if (projectId) baseWhere.projectId = projectId

  const [openRows, overdueGroups, closedGroups] = await Promise.all([
    prisma.task.findMany({
      where: { ...baseWhere, status: { notIn: ['CLOSED'] } },
      select: { assigneeId: true, estimateHours: true, priority: true },
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { ...baseWhere, status: { notIn: ['CLOSED'] }, dueAt: { lt: now, not: null } },
      _count: true,
    }),
    prisma.task.groupBy({
      by: ['assigneeId'],
      where: { ...baseWhere, status: 'CLOSED', closedAt: { gte: since7d } },
      _count: true,
    }),
  ])

  type Bucket = {
    open: number
    estimateHours: number
    highPriority: number
    overdue: number
    closed7d: number
  }
  const bucket = (): Bucket => ({ open: 0, estimateHours: 0, highPriority: 0, overdue: 0, closed7d: 0 })
  const map = new Map<string | null, Bucket>()

  for (const t of openRows) {
    const key = t.assigneeId
    if (!includeUnassigned && !key) continue
    const b = map.get(key) ?? bucket()
    b.open += 1
    if (t.estimateHours) b.estimateHours += t.estimateHours
    if (t.priority === 'HIGH' || t.priority === 'CRITICAL') b.highPriority += 1
    map.set(key, b)
  }
  for (const g of overdueGroups) {
    if (!includeUnassigned && !g.assigneeId) continue
    const b = map.get(g.assigneeId) ?? bucket()
    b.overdue = g._count
    map.set(g.assigneeId, b)
  }
  for (const g of closedGroups) {
    if (!includeUnassigned && !g.assigneeId) continue
    const b = map.get(g.assigneeId) ?? bucket()
    b.closed7d = g._count
    map.set(g.assigneeId, b)
  }

  const userIds = [...map.keys()].filter((k): k is string => k !== null)
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true, role: true },
      })
    : []
  const userById = new Map(users.map((u) => [u.id, u]))

  const rows = [...map.entries()].map(([userId, b]) => {
    const u = userId ? userById.get(userId) : null
    const overloaded = b.open >= 10 || b.estimateHours > 80 || b.overdue >= 3
    return {
      userId,
      email: u?.email ?? null,
      name: u?.name ?? (userId ? '(unknown)' : '(unassigned)'),
      role: u?.role ?? null,
      open: b.open,
      estimateHours: Math.round(b.estimateHours * 10) / 10,
      highPriority: b.highPriority,
      overdue: b.overdue,
      closed7d: b.closed7d,
      overloaded,
    }
  })
  rows.sort((a, b) => b.open - a.open)

  return { count: rows.length, rows: rows.slice(0, limit) }
}

export async function computeRiskReport(opts: { staleDays?: number; offlineHours?: number } = {}) {
  const { staleDays = 3, offlineHours = 1 } = opts
  const now = new Date()
  const staleBefore = new Date(now.getTime() - staleDays * DAY_MS)
  const offlineBefore = new Date(now.getTime() - offlineHours * 60 * 60 * 1000)

  const [overdueTasks, staleTasks, pastDueProjects, pendingAgents, offlineAgents] = await Promise.all([
    prisma.task.findMany({
      where: { status: { notIn: ['CLOSED'] }, dueAt: { lt: now, not: null } },
      take: 50,
      orderBy: { dueAt: 'asc' },
      include: {
        assignee: { select: { email: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.task.findMany({
      where: { status: 'IN_PROGRESS', updatedAt: { lt: staleBefore } },
      take: 50,
      orderBy: { updatedAt: 'asc' },
      include: {
        assignee: { select: { email: true, name: true } },
        project: { select: { id: true, name: true } },
      },
    }),
    prisma.project.findMany({
      where: {
        archivedAt: null,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
        endsAt: { lt: now, not: null },
      },
      take: 50,
      orderBy: { endsAt: 'asc' },
      include: { owner: { select: { email: true } } },
    }),
    prisma.agent.findMany({
      where: { status: 'PENDING' },
      select: { id: true, agentId: true, hostname: true, osUser: true, createdAt: true },
    }),
    prisma.agent.findMany({
      where: { status: 'APPROVED', lastSeenAt: { lt: offlineBefore } },
      select: { id: true, agentId: true, hostname: true, lastSeenAt: true },
      orderBy: { lastSeenAt: 'asc' },
      take: 20,
    }),
  ])

  const requiredEnv = [
    { key: 'DATABASE_URL', set: !!Bun.env.DATABASE_URL },
    { key: 'REDIS_URL', set: !!Bun.env.REDIS_URL },
    { key: 'GOOGLE_CLIENT_ID', set: !!Bun.env.GOOGLE_CLIENT_ID },
    { key: 'GOOGLE_CLIENT_SECRET', set: !!Bun.env.GOOGLE_CLIENT_SECRET },
  ]
  const missingEnv = requiredEnv.filter((e) => !e.set).map((e) => e.key)

  const severity: RiskSeverity =
    pastDueProjects.length > 0 || missingEnv.length > 0
      ? 'high'
      : overdueTasks.length > 5 || staleTasks.length > 5 || pendingAgents.length > 0
        ? 'medium'
        : overdueTasks.length > 0 || staleTasks.length > 0 || offlineAgents.length > 0
          ? 'low'
          : 'none'

  return {
    timestamp: now.toISOString(),
    severity,
    summary: {
      overdueTasks: overdueTasks.length,
      staleTasks: staleTasks.length,
      pastDueProjects: pastDueProjects.length,
      pendingAgents: pendingAgents.length,
      offlineAgents: offlineAgents.length,
      missingEnv: missingEnv.length,
    },
    overdueTasks: overdueTasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueAt: t.dueAt,
      daysOverdue: t.dueAt ? daysBetween(now, t.dueAt) : null,
      assignee: t.assignee?.email ?? null,
      project: t.project.name,
      projectId: t.project.id,
    })),
    staleTasks: staleTasks.map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      updatedAt: t.updatedAt,
      daysStale: daysBetween(now, t.updatedAt),
      assignee: t.assignee?.email ?? null,
      project: t.project.name,
      projectId: t.project.id,
    })),
    pastDueProjects: pastDueProjects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      priority: p.priority,
      owner: p.owner.email,
      endsAt: p.endsAt,
      daysOverdue: p.endsAt ? daysBetween(now, p.endsAt) : null,
    })),
    pendingAgents,
    offlineAgents,
    missingEnv,
  }
}
