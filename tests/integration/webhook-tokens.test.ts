import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestApp, createTestSession, prisma, seedTestUser } from '../helpers'

const app = createTestApp()
const AGENT_ID = '00000000-0000-4000-8000-pmwtok00test'
const NAME_PREFIX = 'pmdash-test-token'

async function cleanup() {
  await prisma.activityEvent.deleteMany({ where: { agent: { agentId: AGENT_ID } } })
  await prisma.agent.deleteMany({ where: { agentId: AGENT_ID } })
  await prisma.webhookToken.deleteMany({ where: { name: { startsWith: NAME_PREFIX } } })
  await prisma.session.deleteMany({ where: { user: { email: { endsWith: '@wt-test.local' } } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@wt-test.local' } } })
}

async function superAdminSession() {
  const u = await seedTestUser('super@wt-test.local', 'x', 'Super', 'SUPER_ADMIN')
  return { userId: u.id, cookie: `session=${await createTestSession(u.id)}` }
}

async function userSession() {
  const u = await seedTestUser('user@wt-test.local', 'x', 'User', 'USER')
  return { userId: u.id, cookie: `session=${await createTestSession(u.id)}` }
}

describe('Webhook tokens admin API', () => {
  beforeAll(async () => {
    await cleanup()
  })
  afterAll(async () => {
    await cleanup()
  })

  test('list/create require SUPER_ADMIN', async () => {
    const { cookie } = await userSession()
    const list = await app.handle(new Request('http://localhost/api/admin/webhook-tokens', { headers: { cookie } }))
    expect(list.status).toBe(403)
    const create = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${NAME_PREFIX}-denied` }),
      }),
    )
    expect(create.status).toBe(403)
  })

  test('create returns raw token once + list hides it', async () => {
    const { cookie } = await superAdminSession()
    const res = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${NAME_PREFIX}-a` }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { raw: string; token: { id: string; tokenPrefix: string; status: string } }
    expect(body.raw.startsWith('pmw_')).toBe(true)
    expect(body.token.status).toBe('ACTIVE')
    expect(body.token.tokenPrefix).toBe(body.raw.slice(0, 12))

    const list = await app.handle(new Request('http://localhost/api/admin/webhook-tokens', { headers: { cookie } }))
    const listed = (await list.json()) as { tokens: Array<{ id: string; tokenPrefix: string }> }
    const found = listed.tokens.find((t) => t.id === body.token.id)
    expect(found).toBeDefined()
    expect((found as any).tokenHash).toBeUndefined()
    expect((found as any).raw).toBeUndefined()
  })

  test('patch toggles status; revoked cannot reactivate', async () => {
    const { cookie } = await superAdminSession()
    const created = (await (
      await app.handle(
        new Request('http://localhost/api/admin/webhook-tokens', {
          method: 'POST',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${NAME_PREFIX}-b` }),
        }),
      )
    ).json()) as { token: { id: string } }

    const patch = async (status: string) =>
      app.handle(
        new Request(`http://localhost/api/admin/webhook-tokens/${created.token.id}`, {
          method: 'PATCH',
          headers: { cookie, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        }),
      )

    expect((await patch('DISABLED')).status).toBe(200)
    expect((await patch('ACTIVE')).status).toBe(200)
    expect((await patch('REVOKED')).status).toBe(200)
    expect((await patch('ACTIVE')).status).toBe(400)
  })
})

describe('Webhook auth via DB token', () => {
  beforeAll(async () => {
    await cleanup()
  })
  afterAll(async () => {
    await cleanup()
  })

  async function createActiveToken(): Promise<string> {
    const { cookie } = await superAdminSession()
    const res = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${NAME_PREFIX}-webhook` }),
      }),
    )
    const body = (await res.json()) as { raw: string }
    return body.raw
  }

  function webhookReq(token: string) {
    return new Request('http://localhost/webhooks/aw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ agent_id: AGENT_ID, hostname: 'host', os_user: 'u', events: [] }),
    })
  }

  test('active DB token is accepted', async () => {
    const raw = await createActiveToken()
    const res = await app.handle(webhookReq(raw))
    expect(res.status).toBe(200)
  })

  test('disabled token returns 403', async () => {
    const raw = await createActiveToken()
    const t = await prisma.webhookToken.findFirstOrThrow({ where: { tokenPrefix: raw.slice(0, 12) } })
    await prisma.webhookToken.update({ where: { id: t.id }, data: { status: 'DISABLED' } })
    const res = await app.handle(webhookReq(raw))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toContain('disabled')
  })

  test('revoked token returns 403', async () => {
    const raw = await createActiveToken()
    const t = await prisma.webhookToken.findFirstOrThrow({ where: { tokenPrefix: raw.slice(0, 12) } })
    await prisma.webhookToken.update({ where: { id: t.id }, data: { status: 'REVOKED' } })
    const res = await app.handle(webhookReq(raw))
    expect(res.status).toBe(403)
  })

  test('expired token returns 403', async () => {
    const raw = await createActiveToken()
    const t = await prisma.webhookToken.findFirstOrThrow({ where: { tokenPrefix: raw.slice(0, 12) } })
    await prisma.webhookToken.update({ where: { id: t.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const res = await app.handle(webhookReq(raw))
    expect(res.status).toBe(403)
  })

  test('unknown token returns 401', async () => {
    await createActiveToken() // ensure at least one active token so we don't hit 503
    const res = await app.handle(webhookReq('pmw_unknown-garbage'))
    expect(res.status).toBe(401)
  })

  test('lastUsedAt is updated on accepted request', async () => {
    const raw = await createActiveToken()
    const before = await prisma.webhookToken.findFirstOrThrow({ where: { tokenPrefix: raw.slice(0, 12) } })
    expect(before.lastUsedAt).toBeNull()
    await app.handle(webhookReq(raw))
    const after = await prisma.webhookToken.findFirstOrThrow({ where: { tokenPrefix: raw.slice(0, 12) } })
    expect(after.lastUsedAt).not.toBeNull()
  })
})

describe('Token variants', () => {
  beforeAll(async () => {
    await cleanup()
  })
  afterAll(async () => {
    await cleanup()
  })

  async function createWithExpiry(expiresAt: string | null, name = `${NAME_PREFIX}-var-${Date.now()}`) {
    const { cookie } = await superAdminSession()
    const res = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expiresAt }),
      }),
    )
    return { status: res.status, body: await res.json() }
  }

  test('two active tokens both accepted', async () => {
    const a = (await createWithExpiry(null, `${NAME_PREFIX}-multi-a`)).body as { raw: string }
    const b = (await createWithExpiry(null, `${NAME_PREFIX}-multi-b`)).body as { raw: string }

    const webhookReq = (t: string) =>
      new Request('http://localhost/webhooks/aw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
        body: JSON.stringify({ agent_id: AGENT_ID, hostname: 'h', os_user: 'u', events: [] }),
      })

    expect((await app.handle(webhookReq(a.raw))).status).toBe(200)
    expect((await app.handle(webhookReq(b.raw))).status).toBe(200)
  })

  test('token with future expiry is accepted', async () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const { status, body } = await createWithExpiry(inOneHour, `${NAME_PREFIX}-future`)
    expect(status).toBe(200)
    const raw = (body as { raw: string }).raw
    const res = await app.handle(
      new Request('http://localhost/webhooks/aw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${raw}` },
        body: JSON.stringify({ agent_id: AGENT_ID, hostname: 'h', os_user: 'u', events: [] }),
      }),
    )
    expect(res.status).toBe(200)
  })

  test('rejects invalid expiresAt string', async () => {
    const { status } = await createWithExpiry('not-a-date', `${NAME_PREFIX}-bad-date`)
    expect(status).toBe(400)
  })

  test('rejects empty name', async () => {
    const { cookie } = await superAdminSession()
    const res = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens', {
        method: 'POST',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '   ' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('patch with invalid status returns 400', async () => {
    const { cookie } = await superAdminSession()
    const created = (await createWithExpiry(null, `${NAME_PREFIX}-patch-bad`)).body as {
      token: { id: string }
    }
    const res = await app.handle(
      new Request(`http://localhost/api/admin/webhook-tokens/${created.token.id}`, {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'LOL' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('patch non-existent id returns 404', async () => {
    const { cookie } = await superAdminSession()
    const res = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens/00000000-0000-0000-0000-000000000000', {
        method: 'PATCH',
        headers: { cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      }),
    )
    expect(res.status).toBe(404)
  })

  test('delete non-existent id returns 404', async () => {
    const { cookie } = await superAdminSession()
    const res = await app.handle(
      new Request('http://localhost/api/admin/webhook-tokens/00000000-0000-0000-0000-000000000000', {
        method: 'DELETE',
        headers: { cookie },
      }),
    )
    expect(res.status).toBe(404)
  })

  test('delete active token removes it from webhook auth', async () => {
    const { cookie } = await superAdminSession()
    const created = (await createWithExpiry(null, `${NAME_PREFIX}-delete-me`)).body as {
      raw: string
      token: { id: string }
    }
    const webhookReq = () =>
      new Request('http://localhost/webhooks/aw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.raw}` },
        body: JSON.stringify({ agent_id: AGENT_ID, hostname: 'h', os_user: 'u', events: [] }),
      })
    expect((await app.handle(webhookReq())).status).toBe(200)
    await app.handle(
      new Request(`http://localhost/api/admin/webhook-tokens/${created.token.id}`, {
        method: 'DELETE',
        headers: { cookie },
      }),
    )
    expect((await app.handle(webhookReq())).status).toBe(401)
  })

  test('unauthenticated caller gets 401 on admin API', async () => {
    const res = await app.handle(new Request('http://localhost/api/admin/webhook-tokens'))
    expect(res.status).toBe(401)
  })

  test('tokenPrefix is unique-enough to identify token without full hash lookup', async () => {
    const { body } = await createWithExpiry(null, `${NAME_PREFIX}-prefix-check`)
    const raw = (body as { raw: string }).raw
    expect(raw.slice(0, 4)).toBe('pmw_')
    expect(raw.length).toBeGreaterThan(30)
    const prefix = raw.slice(0, 12)
    const found = await prisma.webhookToken.findFirst({ where: { tokenPrefix: prefix } })
    expect(found).not.toBeNull()
  })
})
