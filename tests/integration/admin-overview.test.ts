import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cleanupTestData, createTestApp, createTestSession, prisma, seedTestUser } from '../helpers'

const app = createTestApp()

let userToken: string
let adminToken: string
let superToken: string
let projectId: string

beforeAll(async () => {
  await cleanupTestData()
  await prisma.task.deleteMany()
  await prisma.project.deleteMany()

  const user = await seedTestUser('user-cockpit@example.com', 'x', 'U', 'USER')
  const admin = await seedTestUser('admin-cockpit@example.com', 'x', 'A', 'ADMIN')
  const sa = await seedTestUser('sa-cockpit@example.com', 'x', 'S', 'SUPER_ADMIN')
  userToken = await createTestSession(user.id)
  adminToken = await createTestSession(admin.id)
  superToken = await createTestSession(sa.id)

  const now = new Date()
  const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)

  const project = await prisma.project.create({
    data: {
      name: 'Cockpit test project',
      description: 'test',
      ownerId: admin.id,
      status: 'ACTIVE',
      priority: 'HIGH',
    },
  })
  projectId = project.id
  await prisma.projectMember.create({ data: { projectId: project.id, userId: admin.id, role: 'OWNER' } })

  await prisma.task.create({
    data: {
      projectId: project.id,
      kind: 'TASK',
      title: 'Overdue task',
      description: 'd',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      reporterId: admin.id,
      assigneeId: admin.id,
      dueAt: past,
    },
  })
})

afterAll(async () => {
  await prisma.task.deleteMany({ where: { projectId } })
  await prisma.projectMember.deleteMany({ where: { projectId } })
  await prisma.project.deleteMany({ where: { id: projectId } })
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
  '/api/admin/overview/kpis',
  '/api/admin/overview/risks',
  '/api/admin/overview/health',
  '/api/admin/overview/load',
]

describe('admin overview cockpit endpoints: auth gating', () => {
  for (const path of ENDPOINTS) {
    test(`${path} — 401 without cookie`, async () => {
      const res = await get(path)
      expect(res.status).toBe(401)
    })
    test(`${path} — 403 for USER`, async () => {
      const res = await get(path, userToken)
      expect(res.status).toBe(403)
    })
    test(`${path} — 200 for ADMIN`, async () => {
      const res = await get(path, adminToken)
      expect(res.status).toBe(200)
    })
    test(`${path} — 200 for SUPER_ADMIN`, async () => {
      const res = await get(path, superToken)
      expect(res.status).toBe(200)
    })
  }
})

describe('GET /api/admin/overview/kpis', () => {
  test('returns users, projects, tasks, agents, velocity blocks', async () => {
    const res = await get('/api/admin/overview/kpis', adminToken)
    const body = await res.json()
    expect(body.users.total).toBeGreaterThanOrEqual(3)
    expect(body.projects.active).toBeGreaterThanOrEqual(1)
    expect(body.tasks.overdueOpen).toBeGreaterThanOrEqual(1)
    expect(body.velocity).toBeDefined()
    expect(body.agents).toBeDefined()
    expect(Array.isArray(body.recentAudit)).toBe(true)
  })
})

describe('GET /api/admin/overview/risks', () => {
  test('flags the overdue task', async () => {
    const res = await get('/api/admin/overview/risks', adminToken)
    const body = await res.json()
    expect(body.severity).toBeDefined()
    expect(body.summary.overdueTasks).toBeGreaterThanOrEqual(1)
    const flagged = body.overdueTasks.find((t: { project: string }) => t.project === 'Cockpit test project')
    expect(flagged).toBeDefined()
    expect(flagged.daysOverdue).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /api/admin/overview/health', () => {
  test('returns per-project grade A-F and score', async () => {
    const res = await get('/api/admin/overview/health', adminToken)
    const body = await res.json()
    expect(body.count).toBeGreaterThanOrEqual(1)
    const row = body.projects.find((p: { id: string }) => p.id === projectId)
    expect(row).toBeDefined()
    expect(['A', 'B', 'C', 'D', 'E', 'F']).toContain(row.grade)
    expect(row.score).toBeGreaterThanOrEqual(0)
    expect(row.score).toBeLessThanOrEqual(100)
    expect(row.overdueTasks).toBeGreaterThanOrEqual(1)
  })
})

describe('GET /api/admin/overview/load', () => {
  test('returns per-user load with overloaded flag', async () => {
    const res = await get('/api/admin/overview/load', adminToken)
    const body = await res.json()
    expect(Array.isArray(body.rows)).toBe(true)
    const row = body.rows.find((r: { email: string | null }) => r.email === 'admin-cockpit@example.com')
    expect(row).toBeDefined()
    expect(row.open).toBeGreaterThanOrEqual(1)
    expect(row.overdue).toBeGreaterThanOrEqual(1)
    expect(row.highPriority).toBeGreaterThanOrEqual(1)
    expect(typeof row.overloaded).toBe('boolean')
  })
})
