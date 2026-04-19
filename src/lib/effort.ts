// Evidence-based effort tracking: correlates pm-watch ActivityEvent (from
// ActivityWatch window watchers) with Task.startsAt/closedAt windows to
// produce "actualHours" per task, alongside ghost/phantom detectors.
//
// Attribution: an ActivityEvent belongs to an Agent; the Agent.claimedById
// identifies the user. A task's "actual hours" is the sum of window-bucket
// event durations from that user's agents that fall inside the task's
// active period.

import { prisma } from './db'

const HOUR_MS = 60 * 60 * 1000
const WINDOW_BUCKET_MARKER = 'window'
const DEFAULT_STALE_DAYS = 3
const DEFAULT_PHANTOM_WINDOW_DAYS = 7

export interface TaskEffort {
  taskId: string
  assigneeId: string | null
  estimateHours: number | null
  actualHours: number | null
  eventCount: number
  windowStart: Date | null
  windowEnd: Date | null
  variancePercent: number | null
  verdict: 'under' | 'on' | 'over' | 'missing-estimate' | 'no-assignee' | 'no-activity'
}

function secondsToHours(seconds: number) {
  return Math.round((seconds / 3600) * 100) / 100
}

function variancePercent(estimate: number, actual: number) {
  if (estimate === 0) return null
  return Math.round(((actual - estimate) / estimate) * 1000) / 10
}

function verdictFor(estimate: number | null, actual: number | null, assigneeId: string | null): TaskEffort['verdict'] {
  if (!assigneeId) return 'no-assignee'
  if (actual === null || actual === 0) return 'no-activity'
  if (estimate === null) return 'missing-estimate'
  const pct = (actual - estimate) / estimate
  if (pct > 0.25) return 'over'
  if (pct < -0.25) return 'under'
  return 'on'
}

async function sumWindowSecondsForUser(
  userId: string,
  start: Date,
  end: Date,
): Promise<{ seconds: number; count: number }> {
  const events = await prisma.activityEvent.findMany({
    where: {
      agent: { claimedById: userId },
      bucketId: { contains: WINDOW_BUCKET_MARKER },
      timestamp: { gte: start, lte: end },
    },
    select: { duration: true },
  })
  const seconds = events.reduce((s, e) => s + e.duration, 0)
  return { seconds, count: events.length }
}

export async function computeTaskEffort(taskId: string): Promise<TaskEffort | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      assigneeId: true,
      estimateHours: true,
      startsAt: true,
      closedAt: true,
      createdAt: true,
    },
  })
  if (!task) return null

  const assigneeId = task.assigneeId
  const windowStart = task.startsAt ?? task.createdAt
  const windowEnd = task.closedAt ?? new Date()

  if (!assigneeId) {
    return {
      taskId: task.id,
      assigneeId: null,
      estimateHours: task.estimateHours,
      actualHours: null,
      eventCount: 0,
      windowStart,
      windowEnd,
      variancePercent: null,
      verdict: 'no-assignee',
    }
  }

  const { seconds, count } = await sumWindowSecondsForUser(assigneeId, windowStart, windowEnd)
  const actualHours = secondsToHours(seconds)
  const vp = task.estimateHours !== null && actualHours > 0 ? variancePercent(task.estimateHours, actualHours) : null

  return {
    taskId: task.id,
    assigneeId,
    estimateHours: task.estimateHours,
    actualHours,
    eventCount: count,
    windowStart,
    windowEnd,
    variancePercent: vp,
    verdict: verdictFor(task.estimateHours, actualHours, assigneeId),
  }
}

export interface EffortReportRow {
  taskId: string
  title: string
  status: string
  priority: string
  projectId: string
  projectName: string
  assigneeId: string | null
  assigneeEmail: string | null
  estimateHours: number | null
  actualHours: number
  variancePercent: number | null
  verdict: TaskEffort['verdict']
  startsAt: Date | null
  closedAt: Date | null
}

/**
 * Batched effort report across many tasks. Groups ActivityEvent rows by
 * assignee in one query, then attributes per-task. For tasks without an
 * assignee or window-bucket data, actualHours is 0.
 */
export async function effortReport(opts: {
  projectId?: string
  onlyClosed?: boolean
  limit?: number
}): Promise<EffortReportRow[]> {
  const { projectId, onlyClosed, limit = 100 } = opts
  const where: Record<string, unknown> = {}
  if (projectId) where.projectId = projectId
  if (onlyClosed) where.status = 'CLOSED'

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ closedAt: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, email: true } },
    },
  })

  if (tasks.length === 0) return []

  const rows: EffortReportRow[] = []
  for (const t of tasks) {
    const windowStart = t.startsAt ?? t.createdAt
    const windowEnd = t.closedAt ?? new Date()
    let seconds = 0
    if (t.assigneeId) {
      const { seconds: s } = await sumWindowSecondsForUser(t.assigneeId, windowStart, windowEnd)
      seconds = s
    }
    const actualHours = secondsToHours(seconds)
    const vp = t.estimateHours !== null && actualHours > 0 ? variancePercent(t.estimateHours, actualHours) : null
    rows.push({
      taskId: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      projectId: t.projectId,
      projectName: t.project.name,
      assigneeId: t.assigneeId,
      assigneeEmail: t.assignee?.email ?? null,
      estimateHours: t.estimateHours,
      actualHours,
      variancePercent: vp,
      verdict: verdictFor(t.estimateHours, actualHours, t.assigneeId),
      startsAt: t.startsAt,
      closedAt: t.closedAt,
    })
  }
  return rows
}

export interface GhostTaskRow {
  taskId: string
  title: string
  status: string
  priority: string
  projectId: string
  projectName: string
  assigneeEmail: string | null
  daysStale: number
  assigneeOnlineLast24h: boolean
  actualHoursLast7d: number
}

/**
 * Ghost tasks: IN_PROGRESS tasks that haven't moved in `staleDays` days.
 * Augmented with a signal — did the assignee's agents have *any* activity
 * in the last 24h? If yes, the user is active but this task has stalled.
 * If no, they may be offline / on leave / forgot the task.
 */
export async function detectGhostTasks(opts: { staleDays?: number; limit?: number } = {}): Promise<GhostTaskRow[]> {
  const staleDays = opts.staleDays ?? DEFAULT_STALE_DAYS
  const limit = opts.limit ?? 50
  const staleBefore = new Date(Date.now() - staleDays * 24 * HOUR_MS)
  const last24h = new Date(Date.now() - 24 * HOUR_MS)
  const last7d = new Date(Date.now() - 7 * 24 * HOUR_MS)

  const tasks = await prisma.task.findMany({
    where: { status: 'IN_PROGRESS', updatedAt: { lt: staleBefore } },
    orderBy: { updatedAt: 'asc' },
    take: limit,
    include: {
      project: { select: { id: true, name: true } },
      assignee: { select: { id: true, email: true } },
    },
  })

  if (tasks.length === 0) return []

  const assigneeIds = [...new Set(tasks.map((t) => t.assigneeId).filter((v): v is string => !!v))]
  const activityByUser = new Map<string, { online24h: boolean; seconds7d: number }>()

  if (assigneeIds.length > 0) {
    const [recent, seven] = await Promise.all([
      prisma.activityEvent.findMany({
        where: {
          agent: { claimedById: { in: assigneeIds } },
          bucketId: { contains: WINDOW_BUCKET_MARKER },
          timestamp: { gte: last24h },
        },
        select: { duration: true, agent: { select: { claimedById: true } } },
      }),
      prisma.activityEvent.findMany({
        where: {
          agent: { claimedById: { in: assigneeIds } },
          bucketId: { contains: WINDOW_BUCKET_MARKER },
          timestamp: { gte: last7d },
        },
        select: { duration: true, agent: { select: { claimedById: true } } },
      }),
    ])
    for (const uid of assigneeIds) activityByUser.set(uid, { online24h: false, seconds7d: 0 })
    for (const e of recent) {
      const uid = e.agent.claimedById
      if (!uid) continue
      const b = activityByUser.get(uid)
      if (b) b.online24h = true
    }
    for (const e of seven) {
      const uid = e.agent.claimedById
      if (!uid) continue
      const b = activityByUser.get(uid)
      if (b) b.seconds7d += e.duration
    }
  }

  const now = Date.now()
  return tasks.map((t) => {
    const bucket = t.assigneeId ? activityByUser.get(t.assigneeId) : null
    return {
      taskId: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      projectId: t.projectId,
      projectName: t.project.name,
      assigneeEmail: t.assignee?.email ?? null,
      daysStale: Math.round((now - t.updatedAt.getTime()) / (24 * HOUR_MS)),
      assigneeOnlineLast24h: bucket?.online24h ?? false,
      actualHoursLast7d: bucket ? secondsToHours(bucket.seconds7d) : 0,
    }
  })
}

export interface PhantomRow {
  userId: string
  email: string
  totalHours: number
  trackedHours: number
  phantomHours: number
  phantomPercent: number | null
  openTaskCount: number
}

/**
 * Phantom work: activity captured by pm-watch that cannot be attributed to
 * any IN_PROGRESS task. Per-user, over the last `days` window.
 *
 * "Tracked hours" = sum of window-bucket durations that overlap with at
 * least one IN_PROGRESS task assigned to that user during the event's time.
 * "Phantom hours" = totalHours − trackedHours.
 *
 * A simpler proxy is used here: if the user had *any* IN_PROGRESS task
 * whose [startsAt..closedAt∨now] covers the event's timestamp, the event
 * counts as tracked. Otherwise phantom.
 */
export async function computePhantomWork(opts: { days?: number; limit?: number } = {}): Promise<PhantomRow[]> {
  const days = opts.days ?? DEFAULT_PHANTOM_WINDOW_DAYS
  const limit = opts.limit ?? 50
  const since = new Date(Date.now() - days * 24 * HOUR_MS)
  const now = new Date()

  const events = await prisma.activityEvent.findMany({
    where: {
      bucketId: { contains: WINDOW_BUCKET_MARKER },
      timestamp: { gte: since },
      agent: { claimedById: { not: null } },
    },
    select: {
      timestamp: true,
      duration: true,
      agent: { select: { claimedById: true } },
    },
  })

  const byUser = new Map<string, { total: number; events: { ts: Date; dur: number }[] }>()
  for (const e of events) {
    const uid = e.agent.claimedById
    if (!uid) continue
    let b = byUser.get(uid)
    if (!b) {
      b = { total: 0, events: [] }
      byUser.set(uid, b)
    }
    b.total += e.duration
    b.events.push({ ts: e.timestamp, dur: e.duration })
  }

  if (byUser.size === 0) return []

  const userIds = [...byUser.keys()]
  const [users, tasks] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
    prisma.task.findMany({
      where: {
        assigneeId: { in: userIds },
        OR: [{ status: 'IN_PROGRESS' }, { closedAt: { gte: since } }],
      },
      select: { assigneeId: true, startsAt: true, createdAt: true, closedAt: true, status: true },
    }),
  ])
  const emailById = new Map(users.map((u) => [u.id, u.email]))
  const windowsByUser = new Map<string, { start: Date; end: Date }[]>()
  const openCountByUser = new Map<string, number>()
  for (const t of tasks) {
    if (!t.assigneeId) continue
    const list = windowsByUser.get(t.assigneeId) ?? []
    list.push({ start: t.startsAt ?? t.createdAt, end: t.closedAt ?? now })
    windowsByUser.set(t.assigneeId, list)
    if (t.status === 'IN_PROGRESS') openCountByUser.set(t.assigneeId, (openCountByUser.get(t.assigneeId) ?? 0) + 1)
  }

  const rows: PhantomRow[] = []
  for (const [userId, bucket] of byUser) {
    const windows = windowsByUser.get(userId) ?? []
    let trackedSeconds = 0
    for (const e of bucket.events) {
      const covered = windows.some((w) => w.start.getTime() <= e.ts.getTime() && e.ts.getTime() <= w.end.getTime())
      if (covered) trackedSeconds += e.dur
    }
    const total = secondsToHours(bucket.total)
    const tracked = secondsToHours(trackedSeconds)
    const phantom = Math.round((total - tracked) * 100) / 100
    rows.push({
      userId,
      email: emailById.get(userId) ?? '(unknown)',
      totalHours: total,
      trackedHours: tracked,
      phantomHours: phantom < 0 ? 0 : phantom,
      phantomPercent: total > 0 ? Math.round((phantom / total) * 1000) / 10 : null,
      openTaskCount: openCountByUser.get(userId) ?? 0,
    })
  }
  rows.sort((a, b) => b.phantomHours - a.phantomHours)
  return rows.slice(0, limit)
}
