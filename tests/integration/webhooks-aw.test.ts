import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestApp, prisma, seedTestUser } from '../helpers'

const app = createTestApp()
const TOKEN = process.env.PMW_WEBHOOK_TOKEN || ''
const AGENT_ID = '00000000-0000-4000-8000-pmwaw00test1'

function payload(events: unknown[] = []) {
  return {
    agent_id: AGENT_ID,
    hostname: 'test-host',
    os_user: 'tester',
    events,
  }
}

function req(body: unknown, token = TOKEN) {
  return new Request('http://localhost/webhooks/aw', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}

async function cleanup() {
  await prisma.activityEvent.deleteMany({ where: { agent: { agentId: AGENT_ID } } })
  await prisma.agent.deleteMany({ where: { agentId: AGENT_ID } })
}

describe('POST /webhooks/aw', () => {
  beforeAll(async () => {
    await cleanup()
  })
  afterAll(async () => {
    await cleanup()
  })

  test('returns 503 when no env token and no DB tokens configured', async () => {
    if (TOKEN) return // only meaningful when env token unset
    const restore = await prisma.webhookToken.findMany()
    await prisma.webhookToken.deleteMany()
    try {
      const res = await app.handle(req(payload(), ''))
      expect(res.status).toBe(503)
    } finally {
      for (const t of restore) {
        await prisma.webhookToken.create({ data: t }).catch(() => {})
      }
    }
  })

  test('rejects bad bearer token', async () => {
    if (!TOKEN) return
    const res = await app.handle(req(payload(), 'wrong-token'))
    expect(res.status).toBe(401)
  })

  test('rejects missing agent_id', async () => {
    if (!TOKEN) return
    const res = await app.handle(req({ hostname: 'h', os_user: 'u', events: [] }))
    expect(res.status).toBe(400)
  })

  test('upserts agent as PENDING and drops events until approved', async () => {
    if (!TOKEN) return
    const events = [
      {
        bucket_id: 'aw-watcher-window_test-host',
        event_id: 1,
        timestamp: '2026-04-17T08:14:22.481Z',
        duration: 12.5,
        data: { app: 'Code', title: 'file.ts' },
      },
      {
        bucket_id: 'aw-watcher-afk_test-host',
        event_id: 42,
        timestamp: '2026-04-17T08:14:35.002Z',
        duration: 60,
        data: { status: 'not-afk' },
      },
    ]
    const res = await app.handle(req(payload(events)))
    expect(res.status).toBe(202)
    const body = (await res.json()) as {
      ok: boolean
      inserted: number
      skipped: number
      reason?: string
      agent: { status: string }
    }
    expect(body.ok).toBe(true)
    expect(body.inserted).toBe(0)
    expect(body.skipped).toBe(2)
    expect(body.reason).toBe('agent_pending')
    expect(body.agent.status).toBe('PENDING')

    const agent = await prisma.agent.findUnique({ where: { agentId: AGENT_ID } })
    expect(agent).not.toBeNull()
    expect(agent?.hostname).toBe('test-host')
    expect(agent?.osUser).toBe('tester')
    const eventCount = await prisma.activityEvent.count({ where: { agentId: agent?.id } })
    expect(eventCount).toBe(0)
  })

  test('APPROVED agent ingests events; duplicates skipped via composite unique', async () => {
    if (!TOKEN) return
    await prisma.agent.update({ where: { agentId: AGENT_ID }, data: { status: 'APPROVED' } })
    const events = [
      {
        bucket_id: 'aw-watcher-window_test-host',
        event_id: 1,
        timestamp: '2026-04-17T08:14:22.481Z',
        duration: 12.5,
        data: { app: 'Code' },
      },
      {
        bucket_id: 'aw-watcher-window_test-host',
        event_id: 2,
        timestamp: '2026-04-17T08:14:30.000Z',
        duration: 8.0,
        data: { app: 'Chrome' },
      },
    ]
    const first = await app.handle(req(payload(events)))
    expect(first.status).toBe(200)
    const firstBody = (await first.json()) as { inserted: number }
    expect(firstBody.inserted).toBe(2)

    const replay = await app.handle(req(payload([events[0]])))
    const replayBody = (await replay.json()) as { inserted: number; skipped: number }
    expect(replayBody.inserted).toBe(0)
    expect(replayBody.skipped).toBe(1)
  })

  test('REVOKED agent is rejected (but still touched)', async () => {
    if (!TOKEN) return
    await prisma.agent.update({ where: { agentId: AGENT_ID }, data: { status: 'REVOKED' } })
    const res = await app.handle(req(payload([])))
    expect(res.status).toBe(403)
    // restore for subsequent tests if any
    await prisma.agent.update({ where: { agentId: AGENT_ID }, data: { status: 'PENDING' } })
  })
})

describe('Admin agents API', () => {
  test('GET /api/admin/agents requires SUPER_ADMIN', async () => {
    const user = await seedTestUser('agents-test-user@example.com', 'x', 'U', 'USER')
    const token = crypto.randomUUID()
    await prisma.session.create({
      data: { token, userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    })
    const res = await app.handle(
      new Request('http://localhost/api/admin/agents', {
        headers: { cookie: `session=${token}` },
      }),
    )
    expect(res.status).toBe(403)
    await prisma.session.deleteMany({ where: { userId: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  })
})
