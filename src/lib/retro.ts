// Automated retrospective generator.
//
// Given a project and a time window, synthesizes a structured snapshot of
// what happened: tasks closed, tasks that slipped (had a dueAt in-window
// but didn't close by dueAt), tasks still blocked by dependencies,
// deadline pushes, GitHub activity, top contributors.
//
// The goal is to produce a retro draft a PM can paste into a doc or read
// aloud in standup — not a replacement for human judgment.

import { prisma } from './db'

export interface RetroOptions {
  projectId: string
  since: Date
  until?: Date
}

export interface RetroTaskRow {
  id: string
  title: string
  status: string
  priority: string
  assigneeEmail: string | null
  dueAt: Date | null
  closedAt: Date | null
  estimateHours: number | null
}

export interface RetroContributor {
  userId: string | null
  email: string | null
  name: string | null
  closed: number
  commits: number
  prsMerged: number
}

export interface RetroExtension {
  id: string
  previousEndAt: Date | null
  newEndAt: Date
  reason: string | null
  extendedBy: string | null
  createdAt: Date
}

export interface RetroGithubSummary {
  commits: number
  prsOpened: number
  prsMerged: number
  prsClosed: number
  reviews: number
}

export interface RetroResult {
  project: { id: string; name: string; status: string; endsAt: Date | null }
  window: { since: Date; until: Date; days: number }
  summary: {
    closed: number
    slipped: number
    stillBlocked: number
    extensions: number
    newTasks: number
    estimateHoursClosed: number
  }
  shipped: RetroTaskRow[]
  slipped: RetroTaskRow[]
  stillBlocked: RetroTaskRow[]
  biggestMisses: (RetroTaskRow & { daysOverDue: number })[]
  extensions: RetroExtension[]
  github: RetroGithubSummary
  contributors: RetroContributor[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysBetween(a: Date, b: Date) {
  return Math.max(0, Math.round((a.getTime() - b.getTime()) / DAY_MS))
}

export async function computeRetro(opts: RetroOptions): Promise<RetroResult | null> {
  const { projectId } = opts
  const since = opts.since
  const until = opts.until ?? new Date()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, status: true, endsAt: true },
  })
  if (!project) return null

  const [closedTasks, slippedTasks, blockedTasks, createdTasks, extensions, githubGroups, statusChanges] =
    await Promise.all([
      prisma.task.findMany({
        where: { projectId, closedAt: { gte: since, lte: until } },
        orderBy: { closedAt: 'desc' },
        include: { assignee: { select: { id: true, email: true, name: true } } },
      }),
      prisma.task.findMany({
        where: { projectId, dueAt: { gte: since, lte: until, not: null } },
        orderBy: { dueAt: 'asc' },
        include: { assignee: { select: { id: true, email: true, name: true } } },
      }),
      prisma.task.findMany({
        where: {
          projectId,
          status: { notIn: ['CLOSED'] },
          blockedBy: { some: { blockedBy: { status: { notIn: ['CLOSED'] } } } },
        },
        include: {
          assignee: { select: { id: true, email: true, name: true } },
          blockedBy: { include: { blockedBy: { select: { id: true, title: true, status: true } } } },
        },
      }),
      prisma.task.count({ where: { projectId, createdAt: { gte: since, lte: until } } }),
      prisma.projectExtension.findMany({
        where: { projectId, createdAt: { gte: since, lte: until } },
        orderBy: { createdAt: 'desc' },
        include: { extendedBy: { select: { name: true, email: true } } },
      }),
      prisma.projectGithubEvent.groupBy({
        by: ['kind'],
        _count: true,
        where: { projectId, createdAt: { gte: since, lte: until } },
      }),
      prisma.taskStatusChange.findMany({
        where: { task: { projectId }, createdAt: { gte: since, lte: until }, toStatus: 'CLOSED' },
        include: { author: { select: { id: true, email: true, name: true } } },
      }),
    ])

  const slippedFiltered = slippedTasks.filter(
    (t) => !t.closedAt || (t.dueAt && t.closedAt.getTime() > t.dueAt.getTime()),
  )

  const mapTask = (t: (typeof closedTasks)[number]): RetroTaskRow => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigneeEmail: t.assignee?.email ?? null,
    dueAt: t.dueAt,
    closedAt: t.closedAt,
    estimateHours: t.estimateHours,
  })

  const shipped = closedTasks.map(mapTask)
  const slipped = slippedFiltered.map(mapTask)

  const stillBlocked = blockedTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigneeEmail: t.assignee?.email ?? null,
    dueAt: t.dueAt,
    closedAt: t.closedAt,
    estimateHours: t.estimateHours,
  }))

  const biggestMisses = slippedFiltered
    .filter((t) => t.dueAt && t.dueAt < until)
    .map((t) => ({
      ...mapTask(t),
      daysOverDue: t.dueAt ? daysBetween(t.closedAt ?? until, t.dueAt) : 0,
    }))
    .sort((a, b) => b.daysOverDue - a.daysOverDue)
    .slice(0, 5)

  const github: RetroGithubSummary = {
    commits: 0,
    prsOpened: 0,
    prsMerged: 0,
    prsClosed: 0,
    reviews: 0,
  }
  for (const g of githubGroups) {
    if (g.kind === 'PUSH_COMMIT') github.commits = g._count
    else if (g.kind === 'PR_OPENED') github.prsOpened = g._count
    else if (g.kind === 'PR_MERGED') github.prsMerged = g._count
    else if (g.kind === 'PR_CLOSED') github.prsClosed = g._count
    else if (g.kind === 'PR_REVIEWED') github.reviews = g._count
  }

  const contribMap = new Map<string | null, RetroContributor>()
  const bumpContrib = (userId: string | null, email: string | null, name: string | null) => {
    const key = userId
    if (!contribMap.has(key)) {
      contribMap.set(key, { userId, email, name, closed: 0, commits: 0, prsMerged: 0 })
    }
    return contribMap.get(key)!
  }
  for (const t of closedTasks) {
    if (!t.assignee) continue
    bumpContrib(t.assignee.id, t.assignee.email, t.assignee.name).closed += 1
  }
  for (const sc of statusChanges) {
    if (!sc.author) continue
    // Count status-closer if different from assignee
    const row = bumpContrib(sc.author.id, sc.author.email, sc.author.name)
    // closed already incremented via closedTasks; don't double-count unless author differs
    if (!closedTasks.some((t) => t.assignee?.id === sc.author?.id && t.id === sc.taskId)) {
      row.closed += 1
    }
  }

  const ghByUser = await prisma.projectGithubEvent.groupBy({
    by: ['matchedUserId', 'kind'],
    _count: true,
    where: {
      projectId,
      createdAt: { gte: since, lte: until },
      matchedUserId: { not: null },
      kind: { in: ['PUSH_COMMIT', 'PR_MERGED'] },
    },
  })
  const ghUserIds = [...new Set(ghByUser.map((g) => g.matchedUserId).filter((v): v is string => !!v))]
  const ghUsers = ghUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ghUserIds } },
        select: { id: true, email: true, name: true },
      })
    : []
  const ghUserById = new Map(ghUsers.map((u) => [u.id, u]))
  for (const g of ghByUser) {
    if (!g.matchedUserId) continue
    const u = ghUserById.get(g.matchedUserId)
    const row = bumpContrib(g.matchedUserId, u?.email ?? null, u?.name ?? null)
    if (g.kind === 'PUSH_COMMIT') row.commits += g._count
    if (g.kind === 'PR_MERGED') row.prsMerged += g._count
  }

  const contributors = [...contribMap.values()]
    .filter((c) => c.closed + c.commits + c.prsMerged > 0)
    .sort((a, b) => b.closed + b.prsMerged * 2 - (a.closed + a.prsMerged * 2))
    .slice(0, 10)

  const estimateHoursClosed = Math.round(closedTasks.reduce((s, t) => s + (t.estimateHours ?? 0), 0) * 10) / 10

  return {
    project,
    window: { since, until, days: Math.max(1, Math.round((until.getTime() - since.getTime()) / DAY_MS)) },
    summary: {
      closed: shipped.length,
      slipped: slipped.length,
      stillBlocked: stillBlocked.length,
      extensions: extensions.length,
      newTasks: createdTasks,
      estimateHoursClosed,
    },
    shipped,
    slipped,
    stillBlocked,
    biggestMisses,
    extensions: extensions.map((e) => ({
      id: e.id,
      previousEndAt: e.previousEndAt,
      newEndAt: e.newEndAt,
      reason: e.reason,
      extendedBy: e.extendedBy?.email ?? null,
      createdAt: e.createdAt,
    })),
    github,
    contributors,
  }
}

function fmtDate(d: Date | null | undefined) {
  if (!d) return '—'
  return d.toISOString().slice(0, 10)
}

export function renderRetroMarkdown(r: RetroResult): string {
  const lines: string[] = []
  lines.push(`# Retrospective — ${r.project.name}`)
  lines.push('')
  lines.push(`**Window:** ${fmtDate(r.window.since)} → ${fmtDate(r.window.until)} (${r.window.days}d)`)
  lines.push(`**Project status:** ${r.project.status}`)
  if (r.project.endsAt) lines.push(`**Deadline:** ${fmtDate(r.project.endsAt)}`)
  lines.push('')

  lines.push('## TL;DR')
  lines.push(
    `- ✅ ${r.summary.closed} tasks shipped (${r.summary.estimateHoursClosed}h estimated) · 🐢 ${r.summary.slipped} slipped · 🚧 ${r.summary.stillBlocked} still blocked`,
  )
  lines.push(
    `- 📅 ${r.summary.extensions} deadline push${r.summary.extensions === 1 ? '' : 'es'} · 🆕 ${r.summary.newTasks} new tasks created`,
  )
  if (r.github.commits + r.github.prsOpened + r.github.prsMerged > 0) {
    lines.push(
      `- 🐙 GitHub: ${r.github.commits} commits, ${r.github.prsOpened} PRs opened, ${r.github.prsMerged} merged, ${r.github.reviews} reviews`,
    )
  }
  lines.push('')

  if (r.shipped.length > 0) {
    lines.push('## Shipped')
    for (const t of r.shipped.slice(0, 25))
      lines.push(
        `- **${t.title}** (${t.priority}) — ${t.assigneeEmail ?? 'unassigned'} · closed ${fmtDate(t.closedAt)}`,
      )
    if (r.shipped.length > 25) lines.push(`- _…and ${r.shipped.length - 25} more_`)
    lines.push('')
  }

  if (r.slipped.length > 0) {
    lines.push('## Slipped')
    for (const t of r.slipped.slice(0, 25))
      lines.push(
        `- **${t.title}** (${t.priority}) — ${t.assigneeEmail ?? 'unassigned'} · due ${fmtDate(t.dueAt)} · ${t.closedAt ? `closed ${fmtDate(t.closedAt)}` : 'still open'}`,
      )
    if (r.slipped.length > 25) lines.push(`- _…and ${r.slipped.length - 25} more_`)
    lines.push('')
  }

  if (r.biggestMisses.length > 0) {
    lines.push('## Biggest misses')
    for (const t of r.biggestMisses)
      lines.push(`- **${t.title}** — ${t.daysOverDue}d overdue · ${t.assigneeEmail ?? 'unassigned'}`)
    lines.push('')
  }

  if (r.stillBlocked.length > 0) {
    lines.push('## Still blocked')
    for (const t of r.stillBlocked.slice(0, 15))
      lines.push(`- **${t.title}** (${t.priority}) — ${t.assigneeEmail ?? 'unassigned'}`)
    if (r.stillBlocked.length > 15) lines.push(`- _…and ${r.stillBlocked.length - 15} more_`)
    lines.push('')
  }

  if (r.extensions.length > 0) {
    lines.push('## Deadline pushes')
    for (const e of r.extensions)
      lines.push(
        `- ${fmtDate(e.previousEndAt)} → ${fmtDate(e.newEndAt)} by ${e.extendedBy ?? 'system'}${e.reason ? ` — ${e.reason}` : ''}`,
      )
    lines.push('')
  }

  if (r.contributors.length > 0) {
    lines.push('## Top contributors')
    for (const c of r.contributors)
      lines.push(
        `- **${c.name ?? c.email ?? 'unknown'}** — ${c.closed} closed · ${c.commits} commits · ${c.prsMerged} PRs merged`,
      )
    lines.push('')
  }

  lines.push('---')
  lines.push(`_Generated ${new Date().toISOString()} by pm-dashboard._`)
  return lines.join('\n')
}
