import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cleanupTestData, createTestApp, createTestSession, prisma, seedTestUser } from '../helpers'

const app = createTestApp()

let userToken: string
let adminToken: string
let superToken: string
let adminUserId: string
let createdProjectId: string
let createdTaskId: string
let createdAgentId: string

beforeAll(async () => {
  await cleanupTestData()
  await prisma.activityEvent.deleteMany()
  await prisma.agent.deleteMany()
  await prisma.task.deleteMany()
  await prisma.project.deleteMany()
  const user = await seedTestUser('user-effort@example.com', 'x', 'U', 'USER')
  const admin = await seedTestUser('admin-effort@example.com', 'x', 'A', 'ADMIN')
  const sa = await seedTestUser('sa-effort@example.com', 'x', 'S', 'SUPER_ADMIN')
  adminUserId = admin.id
  userToken = await createTestSession(user.id)
  adminToken = await createTestSession(admin.id)
  superToken = await createTestSession(sa.id)

  const project = await prisma.project.create({
    data: { name: 'Effort test project', description: 'test', ownerId: admin.id, status: 'ACTIVE' },
  })
  createdProjectId = project.id
  await prisma.projectMember.create({ data: { projectId: project.id, userId: admin.id, role: 'OWNER' } })

  const now = new Date()
  const startsAt = new Date(now.getTime() - 4 * 60 * 60 * 1000) // 4h ago
  const task = await prisma.task.create({
    data: {
      projectId: project.id,
      kind: 'TASK',
      title: 'Effort sample',
      description: 'd',
      status: 'IN_PROGRESS',
      priority: 'MEDIUM',
      reporterId: admin.id,
      assigneeId: admin.id,
      startsAt,
      estimateHours: 2,
    },
  })
  createdTaskId = task.id

  const agent = await prisma.agent.create({
    data: {
      agentId: 'agent-effort-test',
      hostname: 'testhost',
      osUser: 'tester',
      status: 'APPROVED',
      claimedById: admin.id,
      lastSeenAt: now,
    },
  })
  createdAgentId = agent.id

  // 2 window events totaling 3600s (1 hour) within the task window
  await prisma.activityEvent.createMany({
    data: [
      {
        agentId: agent.id,
        bucketId: 'aw-watcher-window_testhost',
        eventId: 1,
        timestamp: new Date(startsAt.getTime() + 30 * 60 * 1000),
        duration: 1800,
        data: { app: 'Code', title: 'effort.ts' },
      },
      {
        agentId: agent.id,
        bucketId: 'aw-watcher-window_testhost',
        eventId: 2,
        timestamp: new Date(startsAt.getTime() + 90 * 60 * 1000),
        duration: 1800,
        data: { app: 'Chrome', title: 'docs' },
      },
    ],
  })
})

afterAll(async () => {
  await prisma.activityEvent.deleteMany({ where: { agentId: createdAgentId } })
  await prisma.agent.deleteMany({ where: { id: createdAgentId } })
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

const ENDPOINTS = [
  '/api/admin/effort',
  '/api/admin/effort/ghost',
  '/api/admin/effort/phantom',
  `/api/admin/effort/task/${'placeholder'}`, // replaced in test
]

describe('admin effort endpoints: auth gating', () => {
  for (const path of ENDPOINTS.slice(0, 3)) {
    test(`${path} — 401 without cookie`, async () => {
      const res = await get(path)
      expect(res.status).toBe(401)
    })
    test(`${path} — 403 for USER role`, async () => {
      const res = await get(path, userToken)
      expect(res.status).toBe(403)
    })
    test(`${path} — 200 for ADMIN role`, async () => {
      const res = await get(path, adminToken)
      expect(res.status).toBe(200)
    })
    test(`${path} — 200 for SUPER_ADMIN role`, async () => {
      const res = await get(path, superToken)
      expect(res.status).toBe(200)
    })
  }

  test('/effort/task/:id — 404 for unknown task', async () => {
    const res = await get('/api/admin/effort/task/does-not-exist', adminToken)
    expect(res.status).toBe(404)
  })
})

describe('GET /api/admin/effort', () => {
  test('returns rows with verdict + computed actualHours', async () => {
    const res = await get(`/api/admin/effort?projectId=${createdProjectId}`, adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.rows)).toBe(true)
    expect(body.rows.length).toBeGreaterThanOrEqual(1)
    const row = body.rows.find((r: { taskId: string }) => r.taskId === createdTaskId)
    expect(row).toBeDefined()
    expect(row.actualHours).toBeCloseTo(1, 1) // 3600s = 1h
    expect(row.estimateHours).toBe(2)
    expect(row.verdict).toBe('under') // actual 1h vs estimate 2h → 50% under
    expect(row.assigneeEmail).toBe('admin-effort@example.com')
  })
})

describe('GET /api/admin/effort/task/:id', () => {
  test('returns single task effort detail', async () => {
    const res = await get(`/api/admin/effort/task/${createdTaskId}`, adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.taskId).toBe(createdTaskId)
    expect(body.eventCount).toBe(2)
    expect(body.actualHours).toBeCloseTo(1, 1)
    expect(body.assigneeId).toBe(adminUserId)
  })
})

describe('GET /api/admin/effort/ghost', () => {
  test('returns rows with staleDays echo', async () => {
    const res = await get('/api/admin/effort/ghost?staleDays=3', adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.staleDays).toBe(3)
    expect(Array.isArray(body.rows)).toBe(true)
  })
})

describe('GET /api/admin/effort/phantom', () => {
  test('returns phantom per-user breakdown', async () => {
    const res = await get('/api/admin/effort/phantom?days=7', adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.days).toBe(7)
    expect(Array.isArray(body.rows)).toBe(true)
    // admin has 1h of activity covered by an IN_PROGRESS task → tracked
    const adminRow = body.rows.find((r: { userId: string }) => r.userId === adminUserId)
    if (adminRow) {
      expect(adminRow.totalHours).toBeCloseTo(1, 1)
      expect(adminRow.trackedHours).toBeCloseTo(1, 1)
      expect(adminRow.phantomHours).toBeCloseTo(0, 1)
    }
  })
})
