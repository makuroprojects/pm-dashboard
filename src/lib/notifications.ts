import type { NotificationKind } from '../../generated/prisma'
import { prisma } from './db'
import { broadcastToUser } from './presence'

export type NotifyInput = {
  recipientId: string
  actorId?: string | null
  kind: NotificationKind
  taskId?: string | null
  projectId?: string | null
  title: string
  body?: string | null
}

export async function createNotification(input: NotifyInput): Promise<void> {
  if (input.actorId && input.actorId === input.recipientId) return
  const n = await prisma.notification.create({
    data: {
      recipientId: input.recipientId,
      actorId: input.actorId ?? null,
      kind: input.kind,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
      title: input.title,
      body: input.body ?? null,
    },
  })
  try {
    broadcastToUser(input.recipientId, { type: 'notification', id: n.id, kind: n.kind, title: n.title })
  } catch {
    // broadcast is best-effort
  }
}

export async function notifyTaskAssigned(args: {
  taskId: string
  projectId: string
  taskTitle: string
  assigneeId: string
  actorId: string
  actorName: string
}): Promise<void> {
  await createNotification({
    recipientId: args.assigneeId,
    actorId: args.actorId,
    kind: 'TASK_ASSIGNED',
    taskId: args.taskId,
    projectId: args.projectId,
    title: `${args.actorName} assigned you a task`,
    body: args.taskTitle,
  })
}

export async function notifyTaskCommented(args: {
  taskId: string
  projectId: string
  taskTitle: string
  reporterId: string
  assigneeId: string | null
  actorId: string
  actorName: string
  commentSnippet: string
}): Promise<void> {
  const recipients = new Set<string>()
  if (args.assigneeId) recipients.add(args.assigneeId)
  if (args.reporterId) recipients.add(args.reporterId)
  recipients.delete(args.actorId)
  await Promise.all(
    [...recipients].map((recipientId) =>
      createNotification({
        recipientId,
        actorId: args.actorId,
        kind: 'TASK_COMMENTED',
        taskId: args.taskId,
        projectId: args.projectId,
        title: `${args.actorName} commented on "${args.taskTitle}"`,
        body: args.commentSnippet,
      }),
    ),
  )
}

export async function notifyTaskStatusChanged(args: {
  taskId: string
  projectId: string
  taskTitle: string
  reporterId: string
  assigneeId: string | null
  actorId: string
  actorName: string
  fromStatus: string
  toStatus: string
}): Promise<void> {
  const recipients = new Set<string>()
  if (args.assigneeId) recipients.add(args.assigneeId)
  if (args.reporterId) recipients.add(args.reporterId)
  recipients.delete(args.actorId)
  await Promise.all(
    [...recipients].map((recipientId) =>
      createNotification({
        recipientId,
        actorId: args.actorId,
        kind: 'TASK_STATUS_CHANGED',
        taskId: args.taskId,
        projectId: args.projectId,
        title: `"${args.taskTitle}" moved to ${args.toStatus.replace('_', ' ')}`,
        body: `${args.actorName} changed status from ${args.fromStatus.replace('_', ' ')}`,
      }),
    ),
  )
}

const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000

export async function runDueSoonSweep(): Promise<{ dueSoon: number; overdue: number }> {
  const now = new Date()
  const soon = new Date(now.getTime() + DUE_SOON_WINDOW_MS)

  const dueSoonTasks = await prisma.task.findMany({
    where: {
      assigneeId: { not: null },
      status: { in: ['OPEN', 'IN_PROGRESS', 'REOPENED'] },
      dueAt: { gte: now, lte: soon },
    },
    select: { id: true, title: true, projectId: true, assigneeId: true, dueAt: true },
  })

  const overdueTasks = await prisma.task.findMany({
    where: {
      assigneeId: { not: null },
      status: { in: ['OPEN', 'IN_PROGRESS', 'REOPENED'] },
      dueAt: { lt: now },
    },
    select: { id: true, title: true, projectId: true, assigneeId: true, dueAt: true },
  })

  let dueSoonCount = 0
  let overdueCount = 0

  for (const t of dueSoonTasks) {
    if (!t.assigneeId) continue
    const already = await prisma.notification.findFirst({
      where: {
        recipientId: t.assigneeId,
        taskId: t.id,
        kind: 'TASK_DUE_SOON',
        createdAt: { gt: new Date(now.getTime() - DUE_SOON_WINDOW_MS) },
      },
      select: { id: true },
    })
    if (already) continue
    await createNotification({
      recipientId: t.assigneeId,
      kind: 'TASK_DUE_SOON',
      taskId: t.id,
      projectId: t.projectId,
      title: `"${t.title}" is due soon`,
      body: t.dueAt ? `Due ${t.dueAt.toLocaleString()}` : null,
    })
    dueSoonCount++
  }

  for (const t of overdueTasks) {
    if (!t.assigneeId) continue
    const already = await prisma.notification.findFirst({
      where: {
        recipientId: t.assigneeId,
        taskId: t.id,
        kind: 'TASK_OVERDUE',
        createdAt: { gt: new Date(now.getTime() - DUE_SOON_WINDOW_MS) },
      },
      select: { id: true },
    })
    if (already) continue
    await createNotification({
      recipientId: t.assigneeId,
      kind: 'TASK_OVERDUE',
      taskId: t.id,
      projectId: t.projectId,
      title: `"${t.title}" is overdue`,
      body: t.dueAt ? `Was due ${t.dueAt.toLocaleString()}` : null,
    })
    overdueCount++
  }

  return { dueSoon: dueSoonCount, overdue: overdueCount }
}
