import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createTestApp, prisma } from '../helpers'

const app = createTestApp()
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || ''
const REPO = 'pm-test-org/pm-test-webhook-repo'
const PROJECT_NAME = 'github-webhook-test-project'
let projectId: string | null = null
let ownerId: string | null = null

function sign(body: string, secret: string) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
}

function req(body: unknown, event: string, signature?: string, deliveryId = 'test-delivery-1') {
  const raw = JSON.stringify(body)
  return new Request('http://localhost/webhooks/github', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': event,
      'X-GitHub-Delivery': deliveryId,
      ...(signature ? { 'X-Hub-Signature-256': signature } : {}),
    },
    body: raw,
  })
}

async function cleanup() {
  if (projectId) {
    await prisma.projectGithubEvent.deleteMany({ where: { projectId } })
    await prisma.githubWebhookLog.deleteMany({ where: { projectId } })
    await prisma.projectMember.deleteMany({ where: { projectId } })
    await prisma.project.deleteMany({ where: { id: projectId } })
  }
  await prisma.project.deleteMany({ where: { githubRepo: REPO } })
  if (ownerId) {
    await prisma.session.deleteMany({ where: { userId: ownerId } })
    await prisma.user.deleteMany({ where: { id: ownerId } })
  }
}

describe('POST /webhooks/github', () => {
  beforeAll(async () => {
    await cleanup()
    const owner = await prisma.user.upsert({
      where: { email: 'gh-webhook-owner@test.local' },
      update: {},
      create: {
        email: 'gh-webhook-owner@test.local',
        name: 'GH Webhook Owner',
        password: await Bun.password.hash('x', { algorithm: 'bcrypt' }),
      },
    })
    ownerId = owner.id
    const project = await prisma.project.create({
      data: {
        name: PROJECT_NAME,
        ownerId: owner.id,
        githubRepo: REPO,
        members: { create: { userId: owner.id, role: 'OWNER' } },
      },
    })
    projectId = project.id
  })
  afterAll(async () => {
    await cleanup()
  })

  test('503 when secret is unconfigured', async () => {
    if (SECRET) return
    const res = await app.handle(req({}, 'ping', 'sha256=whatever'))
    expect(res.status).toBe(503)
  })

  test('401 on missing signature', async () => {
    if (!SECRET) return
    const res = await app.handle(req({ zen: 'x' }, 'ping'))
    expect(res.status).toBe(401)
  })

  test('401 on bad signature', async () => {
    if (!SECRET) return
    const res = await app.handle(req({ zen: 'x' }, 'ping', 'sha256=deadbeef'))
    expect(res.status).toBe(401)
  })

  test('ping returns ok with valid signature', async () => {
    if (!SECRET) return
    const body = { zen: 'hi' }
    const raw = JSON.stringify(body)
    const res = await app.handle(req(body, 'ping', sign(raw, SECRET)))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok: boolean; pong: boolean }
    expect(json.pong).toBe(true)
  })

  test('400 on missing repository', async () => {
    if (!SECRET) return
    const body = { commits: [] }
    const raw = JSON.stringify(body)
    const res = await app.handle(req(body, 'push', sign(raw, SECRET)))
    expect(res.status).toBe(400)
  })

  test('404 when repo is not linked to any project', async () => {
    if (!SECRET) return
    const body = {
      repository: { full_name: 'other-org/unlinked-repo' },
      commits: [],
    }
    const raw = JSON.stringify(body)
    const res = await app.handle(req(body, 'push', sign(raw, SECRET)))
    expect(res.status).toBe(404)
  })

  test('push inserts commits + dedups on repeat delivery', async () => {
    if (!SECRET) return
    const body = {
      repository: { full_name: REPO },
      ref: 'refs/heads/main',
      pusher: { name: 'alice', email: 'gh-webhook-owner@test.local' },
      commits: [
        {
          id: 'abc1234567890abcdef1234567890abcdef12345',
          message: 'feat: initial commit\n\nbody',
          timestamp: '2026-04-17T12:00:00Z',
          url: 'https://github.com/x/y/commit/abc',
          author: { name: 'Alice', email: 'gh-webhook-owner@test.local', username: 'alice' },
        },
        {
          id: 'def5678901def5678901def5678901def5678901',
          message: 'fix: bug',
          timestamp: '2026-04-17T12:05:00Z',
          url: 'https://github.com/x/y/commit/def',
          author: { name: 'Alice', email: 'gh-webhook-owner@test.local', username: 'alice' },
        },
      ],
    }
    const raw = JSON.stringify(body)
    const res1 = await app.handle(req(body, 'push', sign(raw, SECRET), 'delivery-push-1'))
    expect(res1.status).toBe(200)
    const j1 = (await res1.json()) as { inserted: number; received: number }
    expect(j1.received).toBe(2)
    expect(j1.inserted).toBe(2)

    const res2 = await app.handle(req(body, 'push', sign(raw, SECRET), 'delivery-push-2'))
    expect(res2.status).toBe(200)
    const j2 = (await res2.json()) as { inserted: number; received: number }
    expect(j2.inserted).toBe(0)

    const events = await prisma.projectGithubEvent.findMany({
      where: { projectId: projectId!, kind: 'PUSH_COMMIT' },
    })
    expect(events.length).toBe(2)
    const matched = events.find((e) => e.actorEmail === 'gh-webhook-owner@test.local')
    expect(matched?.matchedUserId).toBe(ownerId!)
  })

  test('pull_request opened → PR_OPENED, closed merged → PR_MERGED', async () => {
    if (!SECRET) return
    const base = {
      repository: { full_name: REPO },
      pull_request: {
        number: 42,
        title: 'Add feature X',
        html_url: 'https://github.com/x/y/pull/42',
        user: { login: 'bob' },
        created_at: '2026-04-17T13:00:00Z',
      },
    }

    const openedBody = { ...base, action: 'opened' }
    const openedRaw = JSON.stringify(openedBody)
    const r1 = await app.handle(req(openedBody, 'pull_request', sign(openedRaw, SECRET), 'del-pr-1'))
    expect(r1.status).toBe(200)

    const mergedBody = {
      ...base,
      action: 'closed',
      pull_request: { ...base.pull_request, merged: true, merged_at: '2026-04-17T14:00:00Z' },
    }
    const mergedRaw = JSON.stringify(mergedBody)
    const r2 = await app.handle(req(mergedBody, 'pull_request', sign(mergedRaw, SECRET), 'del-pr-2'))
    expect(r2.status).toBe(200)

    const events = await prisma.projectGithubEvent.findMany({
      where: { projectId: projectId!, prNumber: 42 },
      orderBy: { createdAt: 'asc' },
    })
    expect(events.map((e) => e.kind)).toEqual(['PR_OPENED', 'PR_MERGED'])
  })

  test('pull_request_review → PR_REVIEWED', async () => {
    if (!SECRET) return
    const body = {
      repository: { full_name: REPO },
      action: 'submitted',
      pull_request: { number: 42, title: 'Add feature X', html_url: 'https://github.com/x/y/pull/42' },
      review: { state: 'approved', user: { login: 'carol' }, submitted_at: '2026-04-17T15:00:00Z' },
    }
    const raw = JSON.stringify(body)
    const res = await app.handle(req(body, 'pull_request_review', sign(raw, SECRET), 'del-rev-1'))
    expect(res.status).toBe(200)
    const review = await prisma.projectGithubEvent.findFirst({
      where: { projectId: projectId!, kind: 'PR_REVIEWED', prNumber: 42 },
    })
    expect(review).not.toBeNull()
    expect(review?.actorLogin).toBe('carol')
  })

  test('logs are written for every request', async () => {
    if (!SECRET) return
    const logs = await prisma.githubWebhookLog.findMany({ where: { projectId: projectId! } })
    expect(logs.length).toBeGreaterThan(0)
  })
})
