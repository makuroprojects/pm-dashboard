import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { cleanupTestData, createTestApp, createTestSession, prisma, seedTestUser } from '../helpers'

const app = createTestApp()

let userToken: string
let adminToken: string
let superToken: string

beforeAll(async () => {
  await cleanupTestData()
  const user = await seedTestUser('user-admin-test@example.com', 'x', 'U', 'USER')
  const admin = await seedTestUser('admin-admin-test@example.com', 'x', 'A', 'ADMIN')
  const sa = await seedTestUser('sa-admin-test@example.com', 'x', 'S', 'SUPER_ADMIN')
  userToken = await createTestSession(user.id)
  adminToken = await createTestSession(admin.id)
  superToken = await createTestSession(sa.id)
})

afterAll(async () => {
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

const ADMIN_READ_ENDPOINTS = [
  '/api/admin/users',
  '/api/admin/logs/audit',
  '/api/admin/sessions',
  '/api/admin/agents',
  '/api/admin/health',
]

describe('admin read endpoints: auth gating', () => {
  for (const path of ADMIN_READ_ENDPOINTS) {
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
})

describe('GET /api/admin/health response shape', () => {
  test('returns services, sessions, agents, webhooks, retention, env', async () => {
    const res = await get('/api/admin/health', superToken)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(typeof body.timestamp).toBe('string')

    expect(body.services).toBeDefined()
    expect(body.services.db).toBeDefined()
    expect(typeof body.services.db.ok).toBe('boolean')
    expect(body.services.redis).toBeDefined()
    expect(typeof body.services.redis.ok).toBe('boolean')

    expect(body.sessions).toBeDefined()
    expect(typeof body.sessions.total).toBe('number')
    expect(typeof body.sessions.active).toBe('number')
    expect(typeof body.sessions.online).toBe('number')

    expect(body.agents).toBeDefined()
    expect(typeof body.agents.total).toBe('number')
    expect(typeof body.agents.live).toBe('number')
    expect(typeof body.agents.pending).toBe('number')

    expect(body.webhooks).toBeDefined()
    expect(typeof body.webhooks.total24h).toBe('number')
    expect(typeof body.webhooks.eventsIn24h).toBe('number')
    expect(typeof body.webhooks.activeTokens).toBe('number')

    expect(body.retention).toBeDefined()
    expect(typeof body.retention.auditLogDays).toBe('number')
    expect(typeof body.retention.webhookLogDays).toBe('number')

    expect(Array.isArray(body.env)).toBe(true)
    const dbUrlEntry = body.env.find((e: { key: string }) => e.key === 'DATABASE_URL')
    expect(dbUrlEntry).toBeDefined()
    expect(dbUrlEntry.required).toBe(true)
  })

  test('reports at least the three seeded active sessions', async () => {
    const res = await get('/api/admin/health', superToken)
    const body = await res.json()
    expect(body.sessions.active).toBeGreaterThanOrEqual(3)
  })
})

describe('GET /api/admin/sessions response shape', () => {
  test('returns summary + sessions array with current users', async () => {
    const res = await get('/api/admin/sessions', adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(Array.isArray(body.sessions)).toBe(true)
    expect(body.summary).toBeDefined()
    expect(typeof body.summary.totalSessions).toBe('number')
    expect(typeof body.summary.activeSessions).toBe('number')
    expect(body.summary.byRole).toBeDefined()

    const emails = body.sessions.map((s: { userEmail: string }) => s.userEmail)
    expect(emails).toContain('admin-admin-test@example.com')
    expect(emails).toContain('sa-admin-test@example.com')
  })
})

describe('GET /api/admin/users response shape', () => {
  test('ADMIN can read the user list', async () => {
    const res = await get('/api/admin/users', adminToken)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.users)).toBe(true)
    const roles = new Set(body.users.map((u: { role: string }) => u.role))
    expect(roles.has('ADMIN')).toBe(true)
    expect(roles.has('SUPER_ADMIN')).toBe(true)
  })
})
