import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cleanupTestData, createTestApp, createTestSession, prisma, seedTestUser } from '../helpers'

const app = createTestApp()

let nonMemberToken: string
let memberToken: string
let adminToken: string
let ownerId: string
let memberId: string
let createdProjectId: string
let shippedTaskId: string
let slippedTaskId: string

beforeAll(async () => {
  await cleanupTestData()
  await prisma.projectGithubEvent.deleteMany()
  await prisma.projectExtension.deleteMany()
  await prisma.task.deleteMany()
  await prisma.projectMember.deleteMany()
  await prisma.project.deleteMany()

  const owner = await seedTestUser('owner-retro@example.com', 'x', 'Owner', 'USER')
  const member = await seedTestUser('member-retro@example.com', 'x', 'Member', 'USER')
  const nonMember = await seedTestUser('nonmember-retro@example.com', 'x', 'NonMember', 'USER')
  const admin = await seedTestUser('admin-retro@example.com', 'x', 'Admin', 'ADMIN')
  ownerId = owner.id
  memberId = member.id

  memberToken = await createTestSession(member.id)
  nonMemberToken = await createTestSession(nonMember.id)
  adminToken = await createTestSession(admin.id)

  const project = await prisma.project.create({
    data: { name: 'Retro test project', description: 'test', ownerId: owner.id, status: 'ACTIVE' },
  })
  createdProjectId = project.id
  await prisma.projectMember.createMany({
    data: [
      { projectId: project.id, userId: owner.id, role: 'OWNER' },
      { projectId: project.id, userId: member.id, role: 'MEMBER' },
    ],
  })

  const now = new Date()
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000)
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000)
  const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

  const shipped = await prisma.task.create({
    data: {
      projectId: project.id,
      kind: 'TASK',
      title: 'Shipped feature',
      description: 'done',
      status: 'CLOSED',
      priority: 'MEDIUM',
      reporterId: owner.id,
      assigneeId: member.id,
      startsAt: tenDaysAgo,
      dueAt: fiveDaysAgo,
      estimateHours: 4,
      closedAt: fiveDaysAgo,
    },
  })
  shippedTaskId = shipped.id

  const slipped = await prisma.task.create({
    data: {
      projectId: project.id,
      kind: 'TASK',
      title: 'Slipped task',
      description: 'late',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      reporterId: owner.id,
      assigneeId: member.id,
      startsAt: tenDaysAgo,
      dueAt: twoDaysAgo,
      estimateHours: 8,
    },
  })
  slippedTaskId = slipped.id

  await prisma.projectExtension.create({
    data: {
      projectId: project.id,
      previousEndAt: fiveDaysAgo,
      newEndAt: new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000),
      reason: 'Slipped; need more time',
      extendedById: owner.id,
      createdAt: twoDaysAgo,
    },
  })
})

afterAll(async () => {
  await prisma.projectGithubEvent.deleteMany({ where: { projectId: createdProjectId } })
  await prisma.projectExtension.deleteMany({ where: { projectId: createdProjectId } })
  await prisma.task.deleteMany({ where: { projectId: createdProjectId } })
  await prisma.projectMember.deleteMany({ where: { projectId: createdProjectId } })
  await prisma.project.deleteMany({ where: { id: createdProjectId } })
  await cleanupTestData()
  await prisma.$disconnect()
})

function get(pathname: string, token?: string) {
  return app.handle(
    new Request(`http://localhost${pathname}`, {
      headers: token ? { cookie: `session=${token}` } : {},
    }),
  )
}

describe('GET /api/projects/:id/retro — auth gating', () => {
  test('401 without cookie', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`)
    expect(res.status).toBe(401)
  })
  test('403 for non-member USER', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`, nonMemberToken)
    expect(res.status).toBe(403)
  })
  test('200 for project member', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`, memberToken)
    expect(res.status).toBe(200)
  })
  test('200 for ADMIN even when not a member', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`, adminToken)
    expect(res.status).toBe(200)
  })
  test('404 for unknown project (admin bypasses membership)', async () => {
    const res = await get('/api/projects/does-not-exist/retro', adminToken)
    expect(res.status).toBe(404)
  })
  test('400 for invalid since/until', async () => {
    const res = await get(
      `/api/projects/${createdProjectId}/retro?since=not-a-date`,
      adminToken,
    )
    expect(res.status).toBe(400)
  })
})

describe('GET /api/projects/:id/retro — JSON shape', () => {
  test('returns shipped, slipped, extensions, summary', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`, adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project.id).toBe(createdProjectId)
    expect(body.window.days).toBeGreaterThanOrEqual(13)
    expect(body.summary.closed).toBe(1)
    expect(body.summary.slipped).toBeGreaterThanOrEqual(1)
    expect(body.summary.extensions).toBe(1)
    expect(body.summary.estimateHoursClosed).toBe(4)

    expect(Array.isArray(body.shipped)).toBe(true)
    const shipped = body.shipped.find((t: { id: string }) => t.id === shippedTaskId)
    expect(shipped).toBeDefined()
    expect(shipped.assigneeEmail).toBe('member-retro@example.com')

    const slippedRow = body.slipped.find((t: { id: string }) => t.id === slippedTaskId)
    expect(slippedRow).toBeDefined()
    expect(slippedRow.closedAt).toBeNull()

    expect(body.extensions.length).toBe(1)
    expect(body.extensions[0].reason).toBe('Slipped; need more time')
  })

  test('biggestMisses flags the overdue slipped task', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`, adminToken)
    const body = await res.json()
    expect(body.biggestMisses.length).toBeGreaterThanOrEqual(1)
    const miss = body.biggestMisses.find((t: { id: string }) => t.id === slippedTaskId)
    expect(miss).toBeDefined()
    expect(miss.daysOverDue).toBeGreaterThanOrEqual(1)
  })

  test('contributors include the member who closed a task', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro`, adminToken)
    const body = await res.json()
    const row = body.contributors.find((c: { userId: string | null }) => c.userId === memberId)
    expect(row).toBeDefined()
    expect(row.closed).toBeGreaterThanOrEqual(1)
    expect(row.email).toBe('member-retro@example.com')
  })
})

describe('GET /api/projects/:id/retro?format=md — markdown', () => {
  test('returns text/markdown with expected sections', async () => {
    const res = await get(`/api/projects/${createdProjectId}/retro?format=md`, adminToken)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') ?? '').toContain('text/markdown')
    const body = await res.text()
    expect(body).toContain('# Retrospective — Retro test project')
    expect(body).toContain('## TL;DR')
    expect(body).toContain('## Shipped')
    expect(body).toContain('## Slipped')
    expect(body).toContain('## Deadline pushes')
    expect(body).toContain('Shipped feature')
  })
})
