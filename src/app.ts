import { cors } from '@elysiajs/cors'
import { html } from '@elysiajs/html'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Elysia } from 'elysia'
import { createMcpServer, type McpScope } from '../scripts/mcp/server'
import { computeAdminOverview, computeProjectHealth, computeRiskReport, computeTeamLoad } from './lib/admin-overview'
import { appLog, clearAppLogs, getAppLogs } from './lib/applog'
import { prisma } from './lib/db'
import { computePhantomWork, computeTaskEffort, detectGhostTasks, effortReport } from './lib/effort'
import { env } from './lib/env'
import { normalizeGithubRepo, verifyGithubSignature } from './lib/github'
import { notifyTaskAssigned, notifyTaskCommented, notifyTaskStatusChanged } from './lib/notifications'
import { addConnection, broadcastToAdmins, getOnlineUserIds, removeConnection } from './lib/presence'
import { redis } from './lib/redis'
import { computeRetro, renderRetroMarkdown } from './lib/retro'
import { parseSchema } from './lib/schema-parser'
import { generateWebhookToken, verifyWebhookToken } from './lib/webhook-tokens'

function getIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? request.headers.get('x-real-ip') ?? 'unknown'
}

function audit(userId: string | null, action: string, detail: string | null, ip: string) {
  prisma.auditLog.create({ data: { userId, action, detail, ip } }).catch(() => {})
}

// In-memory login throttle: track recent failed attempts per IP.
// Limit: 10 failed attempts per 15 minutes. Successful login clears the counter.
const LOGIN_RATE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_RATE_MAX = 10
const loginAttempts = new Map<string, number[]>()

function loginAttemptsRemaining(ip: string): number {
  const now = Date.now()
  const arr = (loginAttempts.get(ip) ?? []).filter((t) => now - t < LOGIN_RATE_WINDOW_MS)
  loginAttempts.set(ip, arr)
  return Math.max(0, LOGIN_RATE_MAX - arr.length)
}

function recordLoginFailure(ip: string) {
  const arr = loginAttempts.get(ip) ?? []
  arr.push(Date.now())
  loginAttempts.set(ip, arr)
}

function clearLoginAttempts(ip: string) {
  loginAttempts.delete(ip)
}

function sessionCookie(value: string, maxAgeSec: number): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
}

async function requireAuth(request: Request): Promise<{ userId: string; role: string; email: string } | null> {
  const cookie = request.headers.get('cookie') ?? ''
  const token = cookie.match(/session=([^;]+)/)?.[1]
  if (!token) return null
  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { select: { id: true, role: true, email: true, blocked: true } } },
  })
  if (!session || session.expiresAt < new Date() || session.user.blocked) return null
  return { userId: session.user.id, role: session.user.role, email: session.user.email }
}

function getAllowedTaskTransitions(current: string, kind: 'TASK' | 'BUG' | 'QC'): string[] {
  if (kind === 'TASK') {
    const m: Record<string, string[]> = {
      OPEN: ['IN_PROGRESS', 'CLOSED'],
      IN_PROGRESS: ['OPEN', 'CLOSED'],
      CLOSED: ['REOPENED'],
      REOPENED: ['IN_PROGRESS', 'CLOSED'],
      READY_FOR_QC: ['CLOSED', 'REOPENED'],
    }
    return m[current] ?? []
  }
  const m: Record<string, string[]> = {
    OPEN: ['IN_PROGRESS', 'CLOSED'],
    IN_PROGRESS: ['READY_FOR_QC', 'CLOSED'],
    READY_FOR_QC: ['CLOSED', 'REOPENED'],
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: ['REOPENED'],
  }
  return m[current] ?? []
}

function computeActualHours(task: { startsAt: Date | null; createdAt: Date; closedAt: Date | null }): number | null {
  if (!task.closedAt) return null
  const start = (task.startsAt ?? task.createdAt).getTime()
  const end = task.closedAt.getTime()
  if (end <= start) return 0
  return Math.round(((end - start) / 3_600_000) * 100) / 100
}

function computeProgressPercent(task: {
  progressPercent: number | null
  status: string
  checklist?: { done: boolean }[]
}): number | null {
  if (task.status === 'CLOSED') return 100
  if (task.checklist && task.checklist.length > 0) {
    const done = task.checklist.filter((c) => c.done).length
    return Math.round((done / task.checklist.length) * 100)
  }
  return task.progressPercent
}

interface TaskAwFocus {
  focusHours: number
  eventCount: number
  windowStart: string
  windowEnd: string
  topApps: Array<{ app: string; seconds: number }>
  topTitles: Array<{ app: string; title: string; seconds: number }>
  matchKeywords: string[]
  matchedHours: number | null
}

async function computeTaskAwFocus(task: {
  id: string
  title: string
  route: string | null
  assigneeId: string | null
  startsAt: Date | null
  createdAt: Date
  closedAt: Date | null
}): Promise<TaskAwFocus | null> {
  if (!task.assigneeId) return null
  const agents = await prisma.agent.findMany({
    where: { claimedById: task.assigneeId, status: 'APPROVED' },
    select: { id: true },
  })
  if (agents.length === 0) return null
  const windowStart = task.startsAt ?? task.createdAt
  const windowEnd = task.closedAt ?? new Date()
  if (windowEnd.getTime() <= windowStart.getTime()) return null
  const events = await prisma.activityEvent.findMany({
    where: {
      agentId: { in: agents.map((a) => a.id) },
      timestamp: { gte: windowStart, lte: windowEnd },
      bucketId: { startsWith: 'aw-watcher-window' },
    },
    select: { duration: true, data: true },
    take: 20_000,
  })
  if (events.length === 0) {
    return {
      focusHours: 0,
      eventCount: 0,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      topApps: [],
      topTitles: [],
      matchKeywords: [],
      matchedHours: null,
    }
  }
  const keywords = Array.from(
    new Set(
      [task.title, task.route ?? '']
        .join(' ')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4),
    ),
  ).slice(0, 12)
  const appTotals = new Map<string, number>()
  const titleTotals = new Map<string, { app: string; title: string; seconds: number }>()
  let totalSeconds = 0
  let matchedSeconds = 0
  for (const e of events) {
    const d = (e.data ?? {}) as Record<string, unknown>
    const app = typeof d.app === 'string' ? d.app : null
    const title = typeof d.title === 'string' ? d.title : null
    if (!app) continue
    totalSeconds += e.duration
    appTotals.set(app, (appTotals.get(app) ?? 0) + e.duration)
    if (title) {
      const key = `${app}::${title}`
      const cur = titleTotals.get(key) ?? { app, title, seconds: 0 }
      cur.seconds += e.duration
      titleTotals.set(key, cur)
      if (keywords.length > 0) {
        const haystack = `${app} ${title}`.toLowerCase()
        if (keywords.some((k) => haystack.includes(k))) matchedSeconds += e.duration
      }
    }
  }
  const topApps = [...appTotals.entries()]
    .map(([app, seconds]) => ({ app, seconds: Math.round(seconds) }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
  const topTitles = [...titleTotals.values()]
    .map((v) => ({ app: v.app, title: v.title, seconds: Math.round(v.seconds) }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 5)
  return {
    focusHours: Math.round((totalSeconds / 3600) * 100) / 100,
    eventCount: events.length,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    topApps,
    topTitles,
    matchKeywords: keywords,
    matchedHours: keywords.length > 0 ? Math.round((matchedSeconds / 3600) * 100) / 100 : null,
  }
}

async function requireProjectMember(
  projectId: string,
  userId: string,
): Promise<{ role: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER' } | null> {
  const m = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  })
  return m
}

type ProjectRole = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'

function isSystemAdmin(role: string | undefined | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

function canManageProject(auth: { role: string }, membership: { role: ProjectRole } | null): boolean {
  if (isSystemAdmin(auth.role)) return true
  return membership?.role === 'OWNER' || membership?.role === 'PM'
}

function canGrantProjectOwner(auth: { role: string }, membership: { role: ProjectRole } | null): boolean {
  if (auth.role === 'SUPER_ADMIN') return true
  return membership?.role === 'OWNER'
}

export function createApp() {
  appLog('info', 'Server starting')

  return (
    new Elysia()
      .use(cors())
      .use(html())

      // ─── Global Error Handler ────────────────────────
      .onError(({ code, error, request }) => {
        if (code === 'NOT_FOUND') {
          return new Response(JSON.stringify({ error: 'Not Found', status: 404 }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const url = new URL(request.url)
        const message = error instanceof Error ? error.message : String(error)
        appLog('error', `${request.method} ${url.pathname} — ${message}`)
        console.error('[Server Error]', error)
        return new Response(JSON.stringify({ error: 'Internal Server Error', status: 500 }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      })

      // ─── Request timing + logging ─────────────────────
      .onRequest(({ request }) => {
        ;(request as any).__startTime = performance.now()
      })
      .onAfterResponse(({ request, set }) => {
        const url = new URL(request.url)
        if (url.pathname.startsWith('/api/')) {
          const status = typeof set.status === 'number' ? set.status : 200
          const level = status >= 500 ? ('error' as const) : status >= 400 ? ('warn' as const) : ('info' as const)
          appLog(level, `${request.method} ${url.pathname} ${status}`)
          const duration = Math.round(performance.now() - ((request as any).__startTime || 0))
          broadcastToAdmins({
            type: 'request',
            method: request.method,
            path: url.pathname,
            status,
            duration,
            timestamp: new Date().toISOString(),
          })
        }
      })

      // API routes
      .get('/health', () => ({ status: 'ok' }))

      // ─── Auth API ──────────────────────────────────────
      .post('/api/auth/login', async ({ request, set }) => {
        const ip = getIp(request)
        if (loginAttemptsRemaining(ip) === 0) {
          audit(null, 'LOGIN_THROTTLED', null, ip)
          appLog('warn', `Login throttled from ${ip}`, ip)
          set.status = 429
          return { error: 'Terlalu banyak percobaan login. Coba lagi beberapa menit.' }
        }
        let body: { email?: unknown; password?: unknown }
        try {
          body = (await request.json()) as typeof body
        } catch {
          set.status = 400
          return { error: 'Invalid JSON' }
        }
        const email = typeof body?.email === 'string' ? body.email.trim() : ''
        const password = typeof body?.password === 'string' ? body.password : ''
        if (!email || !password) {
          set.status = 400
          return { error: 'email dan password wajib diisi' }
        }
        let user = await prisma.user.findUnique({ where: { email } })
        if (!user || !(await Bun.password.verify(password, user.password))) {
          recordLoginFailure(ip)
          audit(user?.id ?? null, 'LOGIN_FAILED', `email: ${email}`, ip)
          appLog('warn', `Login failed: ${email}`, ip)
          set.status = 401
          return { error: 'Email atau password salah' }
        }
        if (user.blocked) {
          audit(user.id, 'LOGIN_BLOCKED', null, ip)
          appLog('warn', `Login blocked: ${email}`, ip)
          set.status = 403
          return { error: 'Akun Anda telah diblokir. Hubungi administrator.' }
        }
        // Auto-promote super admin from env
        if (env.SUPER_ADMIN_EMAILS.includes(user.email) && user.role !== 'SUPER_ADMIN') {
          user = await prisma.user.update({ where: { id: user.id }, data: { role: 'SUPER_ADMIN' } })
        }
        clearLoginAttempts(ip)
        const token = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
        await prisma.session.create({ data: { token, userId: user.id, expiresAt } })
        set.headers['set-cookie'] = sessionCookie(token, 86400)
        audit(user.id, 'LOGIN', `via email`, ip)
        appLog('info', `Login: ${email} (${user.role})`, ip)
        return { user: { id: user.id, name: user.name, email: user.email, role: user.role } }
      })

      .post('/api/auth/logout', async ({ request, set }) => {
        const ip = getIp(request)
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (token) {
          const session = await prisma.session.findUnique({ where: { token }, select: { userId: true } })
          if (session) {
            audit(session.userId, 'LOGOUT', null, ip)
            appLog('info', `Logout: userId=${session.userId}`, ip)
          }
          await prisma.session.deleteMany({ where: { token } })
        }
        set.headers['set-cookie'] = sessionCookie('', 0)
        return { ok: true }
      })

      .get('/api/auth/session', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { user: null }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { id: true, name: true, email: true, role: true, blocked: true } } },
        })
        if (!session || session.expiresAt < new Date()) {
          if (session) await prisma.session.delete({ where: { id: session.id } })
          set.status = 401
          return { user: null }
        }
        return { user: session.user }
      })

      // ─── Google OAuth ──────────────────────────────────
      .get('/api/auth/google', ({ request, set }) => {
        const origin = new URL(request.url).origin
        const params = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          redirect_uri: `${origin}/api/auth/callback/google`,
          response_type: 'code',
          scope: 'openid email profile',
          access_type: 'offline',
          prompt: 'consent',
        })
        set.status = 302
        set.headers.location = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
      })

      .get('/api/auth/callback/google', async ({ request, set }) => {
        const ip = getIp(request)
        const url = new URL(request.url)
        const code = url.searchParams.get('code')
        const origin = url.origin

        if (!code) {
          set.status = 302
          set.headers.location = '/login?error=google_failed'
          return
        }

        // Exchange code for tokens
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            redirect_uri: `${origin}/api/auth/callback/google`,
            grant_type: 'authorization_code',
          }),
        })

        if (!tokenRes.ok) {
          appLog('warn', 'Google OAuth token exchange failed', ip)
          set.status = 302
          set.headers.location = '/login?error=google_failed'
          return
        }

        const tokens = (await tokenRes.json()) as { access_token: string }

        // Get user info
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        })

        if (!userInfoRes.ok) {
          appLog('warn', 'Google OAuth userinfo fetch failed', ip)
          set.status = 302
          set.headers.location = '/login?error=google_failed'
          return
        }

        const googleUser = (await userInfoRes.json()) as { email: string; name: string }

        // Upsert user (no password for Google users)
        const isSuperAdmin = env.SUPER_ADMIN_EMAILS.includes(googleUser.email)
        const user = await prisma.user.upsert({
          where: { email: googleUser.email },
          update: { name: googleUser.name, ...(isSuperAdmin ? { role: 'SUPER_ADMIN' } : {}) },
          create: {
            email: googleUser.email,
            name: googleUser.name,
            password: '',
            role: isSuperAdmin ? 'SUPER_ADMIN' : 'USER',
          },
        })

        // Create session
        const token = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
        await prisma.session.create({ data: { token, userId: user.id, expiresAt } })

        set.headers['set-cookie'] = sessionCookie(token, 86400)
        audit(user.id, 'LOGIN', 'via Google OAuth', ip)
        appLog('info', `Login (Google): ${googleUser.email} (${user.role})`, ip)
        const defaultRoute = user.role === 'SUPER_ADMIN' || user.role === 'ADMIN' ? '/admin' : '/pm'
        set.status = 302
        set.headers.location = defaultRoute
      })

      // ─── Admin API (SUPER_ADMIN only) ───────────────────
      .get('/api/admin/users', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || !isSystemAdmin(session.user.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const users = await prisma.user.findMany({
          select: { id: true, name: true, email: true, role: true, blocked: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        })
        return { users }
      })

      .put('/api/admin/users/:id/role', async ({ request, params, set }) => {
        const ip = getIp(request)
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { id: true, role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        if (session.user.id === params.id) {
          set.status = 400
          return { error: 'Tidak bisa mengubah role sendiri' }
        }
        const { role } = (await request.json()) as { role: string }
        if (!['USER', 'QC', 'ADMIN'].includes(role)) {
          set.status = 400
          return { error: 'Role tidak valid (USER, QC, atau ADMIN)' }
        }
        const target = await prisma.user.findUnique({ where: { id: params.id }, select: { email: true, role: true } })
        if (target?.role === 'SUPER_ADMIN') {
          set.status = 400
          return { error: 'Tidak bisa mengubah role SUPER_ADMIN' }
        }
        const user = await prisma.user.update({
          where: { id: params.id },
          data: { role: role as 'USER' | 'QC' | 'ADMIN' },
          select: { id: true, name: true, email: true, role: true, blocked: true, createdAt: true },
        })
        audit(params.id, 'ROLE_CHANGED', `${target?.role} → ${role} by ${session.user.id}`, ip)
        appLog('info', `Role changed: ${user.email} ${target?.role} → ${role}`)
        return { user }
      })

      .put('/api/admin/users/:id/block', async ({ request, params, set }) => {
        const ip = getIp(request)
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { id: true, role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        if (session.user.id === params.id) {
          set.status = 400
          return { error: 'Tidak bisa memblokir diri sendiri' }
        }
        const { blocked } = (await request.json()) as { blocked: boolean }
        const user = await prisma.user.update({
          where: { id: params.id },
          data: { blocked },
          select: { id: true, name: true, email: true, role: true, blocked: true, createdAt: true },
        })
        // Delete all sessions if blocked
        if (blocked) {
          await prisma.session.deleteMany({ where: { userId: params.id } })
        }
        const action = blocked ? 'BLOCKED' : 'UNBLOCKED'
        audit(params.id, action, `by ${session.user.id}`, ip)
        appLog('info', `User ${action.toLowerCase()}: ${user.email}`)
        return { user }
      })

      // ─── WebSocket Presence ──────────────────────────────
      .ws('/ws/presence', {
        async open(ws) {
          // Authenticate via cookie
          const cookie = ws.data.headers?.cookie ?? ''
          const token = (cookie as string).match(/session=([^;]+)/)?.[1]
          if (!token) {
            ws.close(4001, 'Unauthorized')
            return
          }
          const session = await prisma.session.findUnique({
            where: { token },
            include: { user: { select: { id: true, role: true } } },
          })
          if (!session || session.expiresAt < new Date()) {
            ws.close(4001, 'Unauthorized')
            return
          }

          const isAdmin = session.user.role === 'SUPER_ADMIN' || session.user.role === 'ADMIN'
          ;(ws.data as unknown as { userId: string }).userId = session.user.id
          addConnection(ws as any, session.user.id, isAdmin)
        },
        close(ws) {
          removeConnection(ws as any)
        },
        message() {
          // No client messages expected
        },
      })

      // ─── Presence REST (for initial load) ──────────────
      .get('/api/admin/presence', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        return { online: getOnlineUserIds() }
      })

      // ─── Log API (SUPER_ADMIN only) ────────────────────
      .get('/api/admin/logs/app', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const url = new URL(request.url)
        const level = url.searchParams.get('level') as any
        const limit = parseInt(url.searchParams.get('limit') ?? '100', 10)
        const afterId = parseInt(url.searchParams.get('afterId') ?? '0', 10)
        return { logs: await getAppLogs({ level: level || undefined, limit, afterId: afterId || undefined }) }
      })

      .get('/api/admin/logs/audit', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || !isSystemAdmin(session.user.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const url = new URL(request.url)
        const userId = url.searchParams.get('userId')
        const action = url.searchParams.get('action')
        const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '100', 10), 500)

        const where: Record<string, any> = {}
        if (userId) where.userId = userId
        if (action) where.action = action

        const logs = await prisma.auditLog.findMany({
          where,
          include: { user: { select: { name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        return { logs }
      })

      .delete('/api/admin/logs/app', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        await clearAppLogs()
        appLog('info', 'App logs cleared manually')
        return { ok: true }
      })

      .delete('/api/admin/logs/audit', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { id: true, role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const { count } = await prisma.auditLog.deleteMany()
        appLog('info', `Audit logs cleared manually (${count} entries)`)
        return { ok: true, deleted: count }
      })

      // ─── Schema API (SUPER_ADMIN only) ──────────────────
      .get('/api/admin/schema', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const fs = await import('node:fs')
        const schemaPath = `${process.cwd()}/prisma/schema.prisma`
        if (!fs.existsSync(schemaPath)) {
          set.status = 404
          return { error: 'Schema not found' }
        }
        const raw = fs.readFileSync(schemaPath, 'utf-8')
        return { schema: parseSchema(raw) }
      })

      // ─── Routes Metadata API (SUPER_ADMIN only) ─────────
      .get('/api/admin/routes', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const routes: { method: string; path: string; auth: string; category: string; description: string }[] = [
          // Frontend routes
          { method: 'PAGE', path: '/', auth: 'public', category: 'frontend', description: 'Landing page' },
          {
            method: 'PAGE',
            path: '/login',
            auth: 'public',
            category: 'frontend',
            description: 'Login page (email/password + Google OAuth)',
          },
          {
            method: 'PAGE',
            path: '/dev',
            auth: 'superAdmin',
            category: 'frontend',
            description: 'Dev console (SUPER_ADMIN only)',
          },
          {
            method: 'PAGE',
            path: '/admin',
            auth: 'admin',
            category: 'frontend',
            description: 'Admin console (ADMIN+)',
          },
          {
            method: 'PAGE',
            path: '/pm',
            auth: 'authenticated',
            category: 'frontend',
            description: 'Project Manager (all authenticated)',
          },
          {
            method: 'PAGE',
            path: '/settings',
            auth: 'authenticated',
            category: 'frontend',
            description: 'User settings (all authenticated)',
          },
          {
            method: 'PAGE',
            path: '/dashboard',
            auth: 'admin',
            category: 'frontend',
            description: 'Legacy — redirects to /admin',
          },
          {
            method: 'PAGE',
            path: '/profile',
            auth: 'authenticated',
            category: 'frontend',
            description: 'Legacy — redirects to /settings',
          },
          {
            method: 'PAGE',
            path: '/blocked',
            auth: 'authenticated',
            category: 'frontend',
            description: 'Blocked user info page',
          },
          // Auth
          {
            method: 'POST',
            path: '/api/auth/login',
            auth: 'public',
            category: 'auth',
            description: 'Email/password login',
          },
          {
            method: 'POST',
            path: '/api/auth/logout',
            auth: 'authenticated',
            category: 'auth',
            description: 'Logout (delete session)',
          },
          {
            method: 'GET',
            path: '/api/auth/session',
            auth: 'public',
            category: 'auth',
            description: 'Check current session',
          },
          {
            method: 'GET',
            path: '/api/auth/google',
            auth: 'public',
            category: 'auth',
            description: 'Google OAuth redirect',
          },
          {
            method: 'GET',
            path: '/api/auth/callback/google',
            auth: 'public',
            category: 'auth',
            description: 'Google OAuth callback',
          },
          // Admin
          {
            method: 'GET',
            path: '/api/admin/users',
            auth: 'superAdmin',
            category: 'admin',
            description: 'List all users',
          },
          {
            method: 'PUT',
            path: '/api/admin/users/:id/role',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Change user role',
          },
          {
            method: 'PUT',
            path: '/api/admin/users/:id/block',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Block/unblock user',
          },
          {
            method: 'GET',
            path: '/api/admin/presence',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Online user IDs',
          },
          {
            method: 'GET',
            path: '/api/admin/logs/app',
            auth: 'superAdmin',
            category: 'admin',
            description: 'App logs (Redis)',
          },
          {
            method: 'GET',
            path: '/api/admin/logs/audit',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Audit logs (DB)',
          },
          {
            method: 'DELETE',
            path: '/api/admin/logs/app',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Clear app logs',
          },
          {
            method: 'DELETE',
            path: '/api/admin/logs/audit',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Clear audit logs',
          },
          {
            method: 'GET',
            path: '/api/admin/schema',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Database schema (Prisma)',
          },
          {
            method: 'GET',
            path: '/api/admin/routes',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Routes metadata',
          },
          {
            method: 'GET',
            path: '/api/admin/project-structure',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Project file structure',
          },
          {
            method: 'GET',
            path: '/api/admin/env-map',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Environment variables map',
          },
          {
            method: 'GET',
            path: '/api/admin/test-coverage',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Test coverage mapping',
          },
          {
            method: 'GET',
            path: '/api/admin/dependencies',
            auth: 'superAdmin',
            category: 'admin',
            description: 'NPM dependencies graph',
          },
          {
            method: 'GET',
            path: '/api/admin/migrations',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Migration timeline',
          },
          {
            method: 'GET',
            path: '/api/admin/sessions',
            auth: 'superAdmin',
            category: 'admin',
            description: 'Active sessions (live)',
          },
          // pm-watch
          {
            method: 'POST',
            path: '/webhooks/aw',
            auth: 'bearer',
            category: 'pm-watch',
            description: 'ActivityWatch ingestion webhook (Bearer DB token or PMW_WEBHOOK_TOKEN fallback)',
          },
          {
            method: 'GET',
            path: '/api/me/agents',
            auth: 'authenticated',
            category: 'pm-watch',
            description: "Current user's own approved pm-watch agents (device list)",
          },
          {
            method: 'GET',
            path: '/api/me/notifications',
            auth: 'authenticated',
            category: 'notifications',
            description: 'List notifications for current user (query: ?limit=50&unread=1)',
          },
          {
            method: 'GET',
            path: '/api/me/notifications/unread-count',
            auth: 'authenticated',
            category: 'notifications',
            description: 'Unread notification count for current user',
          },
          {
            method: 'POST',
            path: '/api/me/notifications/:id/read',
            auth: 'authenticated',
            category: 'notifications',
            description: 'Mark a notification as read',
          },
          {
            method: 'POST',
            path: '/api/me/notifications/read-all',
            auth: 'authenticated',
            category: 'notifications',
            description: 'Mark all notifications as read',
          },
          {
            method: 'DELETE',
            path: '/api/me/notifications/:id',
            auth: 'authenticated',
            category: 'notifications',
            description: 'Delete a notification',
          },
          {
            method: 'GET',
            path: '/api/admin/agents',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'List pm-watch agents (with claim + event counts)',
          },
          {
            method: 'POST',
            path: '/api/admin/agents/:id/approve',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Approve agent and assign to user',
          },
          {
            method: 'POST',
            path: '/api/admin/agents/:id/revoke',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Revoke agent (blocks future ingestion)',
          },
          {
            method: 'GET',
            path: '/api/admin/webhook-tokens',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'List webhook API tokens',
          },
          {
            method: 'POST',
            path: '/api/admin/webhook-tokens',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Create webhook token (returns plaintext once)',
          },
          {
            method: 'PATCH',
            path: '/api/admin/webhook-tokens/:id',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Disable / enable / revoke webhook token',
          },
          {
            method: 'DELETE',
            path: '/api/admin/webhook-tokens/:id',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Delete webhook token permanently',
          },
          {
            method: 'GET',
            path: '/api/admin/webhooks/stats',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Webhook monitor: 24h/7d aggregates + per-token/per-agent hits',
          },
          {
            method: 'GET',
            path: '/api/admin/webhooks/logs',
            auth: 'superAdmin',
            category: 'pm-watch',
            description: 'Webhook request log stream (filter: status=all|ok|fail|auth)',
          },
          // Users (for pickers)
          {
            method: 'GET',
            path: '/api/users',
            auth: 'authenticated',
            category: 'users',
            description: 'Lightweight user directory for member/assignee pickers',
          },
          // Projects
          {
            method: 'GET',
            path: '/api/projects',
            auth: 'authenticated',
            category: 'projects',
            description: 'List projects user is a member of',
          },
          {
            method: 'POST',
            path: '/api/projects',
            auth: 'authenticated',
            category: 'projects',
            description: 'Create project (creator becomes OWNER)',
          },
          {
            method: 'GET',
            path: '/api/projects/:id',
            auth: 'authenticated',
            category: 'projects',
            description: 'Project detail with members + task count (members only)',
          },
          {
            method: 'PATCH',
            path: '/api/projects/:id',
            auth: 'authenticated',
            category: 'projects',
            description: 'Update project name/description/archived (OWNER or PM)',
          },
          {
            method: 'DELETE',
            path: '/api/projects/:id',
            auth: 'authenticated',
            category: 'projects',
            description: 'Delete project permanently — cascades members/tasks/milestones (OWNER or SUPER_ADMIN)',
          },
          {
            method: 'POST',
            path: '/api/projects/:id/members',
            auth: 'authenticated',
            category: 'projects',
            description: 'Add member to project (OWNER, PM, or system admin)',
          },
          {
            method: 'PATCH',
            path: '/api/projects/:id/members/:userId',
            auth: 'authenticated',
            category: 'projects',
            description: 'Change member role (OWNER, PM, or system admin; OWNER role requires OWNER or SUPER_ADMIN)',
          },
          {
            method: 'DELETE',
            path: '/api/projects/:id/members/:userId',
            auth: 'authenticated',
            category: 'projects',
            description: 'Remove member (OWNER, PM, or system admin)',
          },
          {
            method: 'POST',
            path: '/api/projects/:id/extend',
            auth: 'authenticated',
            category: 'projects',
            description: 'Extend project deadline (OWNER, PM, or system admin)',
          },
          {
            method: 'GET',
            path: '/api/projects/:id/extensions',
            auth: 'authenticated',
            category: 'projects',
            description: 'List deadline extension history (members only)',
          },
          {
            method: 'GET',
            path: '/api/milestones',
            auth: 'authenticated',
            category: 'projects',
            description: 'List milestones across all projects user is a member of',
          },
          {
            method: 'GET',
            path: '/api/projects/:id/milestones',
            auth: 'authenticated',
            category: 'projects',
            description: 'List project milestones (members only)',
          },
          {
            method: 'POST',
            path: '/api/projects/:id/milestones',
            auth: 'authenticated',
            category: 'projects',
            description: 'Create milestone (OWNER or PM)',
          },
          {
            method: 'PATCH',
            path: '/api/milestones/:id',
            auth: 'authenticated',
            category: 'projects',
            description: 'Update milestone or toggle completion (OWNER or PM)',
          },
          {
            method: 'DELETE',
            path: '/api/milestones/:id',
            auth: 'authenticated',
            category: 'projects',
            description: 'Delete milestone (OWNER or PM)',
          },
          // Tasks
          {
            method: 'GET',
            path: '/api/tasks',
            auth: 'authenticated',
            category: 'tasks',
            description: 'List tasks (filter: projectId, status, kind, assigneeId, mine=1) — member scope',
          },
          {
            method: 'POST',
            path: '/api/tasks',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Create task in a project (member only)',
          },
          {
            method: 'GET',
            path: '/api/tasks/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Task detail with comments + evidence (member only)',
          },
          {
            method: 'PATCH',
            path: '/api/tasks/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Update task fields (member only; status transitions enforced)',
          },
          {
            method: 'DELETE',
            path: '/api/tasks/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Delete task (OWNER/PM or SUPER_ADMIN)',
          },
          {
            method: 'POST',
            path: '/api/tasks/:id/comments',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Comment on task (member only)',
          },
          {
            method: 'POST',
            path: '/api/tasks/:id/evidence',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Attach evidence to task (member only)',
          },
          {
            method: 'POST',
            path: '/api/tasks/:id/evidence/upload',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Upload evidence file (multipart; max UPLOAD_MAX_BYTES)',
          },
          {
            method: 'GET',
            path: '/api/evidence/:file',
            auth: 'authenticated',
            category: 'tasks',
            description: "Stream evidence file (member of owning task's project)",
          },
          {
            method: 'GET',
            path: '/api/projects/:id/github/summary',
            auth: 'authenticated',
            category: 'github',
            description: 'GitHub repo stats for project (commits/contributors/openPRs/lastPush)',
          },
          {
            method: 'GET',
            path: '/api/projects/:id/github/feed',
            auth: 'authenticated',
            category: 'github',
            description: 'Paginated GitHub events for project (?limit=&kind=)',
          },
          {
            method: 'POST',
            path: '/webhooks/github',
            auth: 'hmac',
            category: 'github',
            description: 'GitHub webhook ingestion (HMAC SHA-256 via GITHUB_WEBHOOK_SECRET)',
          },
          {
            method: 'POST',
            path: '/mcp',
            auth: 'shared-secret',
            category: 'mcp',
            description: 'MCP HTTP fallback (Bearer MCP_SECRET readonly / MCP_SECRET_ADMIN full)',
          },
          {
            method: 'GET',
            path: '/api/projects/:id/tags',
            auth: 'authenticated',
            category: 'tasks',
            description: 'List project tags (member only)',
          },
          {
            method: 'POST',
            path: '/api/projects/:id/tags',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Create project tag (member with write access)',
          },
          {
            method: 'PATCH',
            path: '/api/tags/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Rename/recolor tag (member with write access)',
          },
          {
            method: 'DELETE',
            path: '/api/tags/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Delete tag (member with write access)',
          },
          {
            method: 'POST',
            path: '/api/tasks/:id/dependencies',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Add blocked-by dependency (same-project only)',
          },
          {
            method: 'DELETE',
            path: '/api/tasks/:id/dependencies/:blockedById',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Remove blocked-by dependency',
          },
          {
            method: 'POST',
            path: '/api/tasks/:id/checklist',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Add checklist item (member with write access)',
          },
          {
            method: 'PATCH',
            path: '/api/checklist/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Toggle/rename checklist item',
          },
          {
            method: 'DELETE',
            path: '/api/checklist/:id',
            auth: 'authenticated',
            category: 'tasks',
            description: 'Delete checklist item',
          },
          // Activity (pm-watch / AW)
          {
            method: 'GET',
            path: '/api/activity',
            auth: 'authenticated',
            category: 'activity',
            description: 'List my ActivityWatch events (filter: from, to, bucketId, agentId, limit)',
          },
          {
            method: 'GET',
            path: '/api/activity/summary',
            auth: 'authenticated',
            category: 'activity',
            description: 'Aggregate stats for my AW events (today/week totals, top apps, top windows)',
          },
          {
            method: 'GET',
            path: '/api/activity/agents',
            auth: 'authenticated',
            category: 'activity',
            description: 'List my approved pm-watch agents (used for filtering)',
          },
          {
            method: 'GET',
            path: '/api/activity/calendar',
            auth: 'authenticated',
            category: 'activity',
            description: 'Per-day event counts & durations for a month (YYYY-MM) for calendar indicators',
          },
          {
            method: 'GET',
            path: '/api/activity/heatmap',
            auth: 'authenticated',
            category: 'activity',
            description: 'Per-day activity aggregates for a full year (YYYY) — powers the yearly heatmap',
          },
          // Utility
          { method: 'GET', path: '/health', auth: 'public', category: 'utility', description: 'Health check' },
          { method: 'GET', path: '/api/hello', auth: 'public', category: 'utility', description: 'Hello world (GET)' },
          { method: 'PUT', path: '/api/hello', auth: 'public', category: 'utility', description: 'Hello world (PUT)' },
          {
            method: 'GET',
            path: '/api/hello/:name',
            auth: 'public',
            category: 'utility',
            description: 'Hello with name param',
          },
          // WebSocket
          {
            method: 'WS',
            path: '/ws/presence',
            auth: 'authenticated',
            category: 'realtime',
            description: 'Real-time presence tracking',
          },
        ]

        const byMethod: Record<string, number> = {}
        const byAuth: Record<string, number> = {}
        const byCategory: Record<string, number> = {}
        for (const r of routes) {
          byMethod[r.method] = (byMethod[r.method] || 0) + 1
          byAuth[r.auth] = (byAuth[r.auth] || 0) + 1
          byCategory[r.category] = (byCategory[r.category] || 0) + 1
        }

        return {
          routes,
          summary: { total: routes.length, byMethod, byAuth, byCategory },
        }
      })

      // ─── Project Structure API (SUPER_ADMIN only) ──────
      .get('/api/admin/project-structure', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const fs = await import('node:fs')
        const path = await import('node:path')
        const root = process.cwd()
        const scanDirs = ['src', 'prisma', 'tests']
        const skipDirs = new Set(['node_modules', 'dist', 'generated', '.git', '.next'])
        const exts = new Set(['.ts', '.tsx'])

        interface FileInfo {
          path: string
          category: string
          lines: number
          exports: string[]
          imports: { from: string; names: string[] }[]
        }

        interface DirInfo {
          path: string
          category: string
          fileCount: number
        }

        const files: FileInfo[] = []
        const dirs: DirInfo[] = []

        function categorize(filePath: string): string {
          if (filePath.startsWith('src/frontend/routes/')) return 'route'
          if (filePath.startsWith('src/frontend/hooks/')) return 'hook'
          if (filePath.startsWith('src/frontend/components/')) return 'component'
          if (filePath.startsWith('src/frontend')) return 'frontend'
          if (filePath.startsWith('src/lib/')) return 'lib'
          if (filePath.startsWith('prisma/')) return 'prisma'
          if (filePath.startsWith('tests/unit/')) return 'test-unit'
          if (filePath.startsWith('tests/integration/')) return 'test-integration'
          if (filePath.startsWith('tests/')) return 'test'
          if (filePath.startsWith('src/')) return 'backend'
          return 'config'
        }

        function parseFile(filePath: string, content: string): FileInfo {
          const lines = content.split('\n').length
          const exports: string[] = []
          const imports: { from: string; names: string[] }[] = []

          // Parse exports
          for (const m of content.matchAll(
            /export\s+(?:default\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g,
          )) {
            exports.push(m[1])
          }
          if (
            /export\s+default\s+/.test(content) &&
            !exports.some(
              (e) => content.includes(`export default function ${e}`) || content.includes(`export default class ${e}`),
            )
          ) {
            exports.push('default')
          }

          // Parse imports
          for (const m of content.matchAll(
            /import\s+(?:\{([^}]+)\}|(\w+))(?:\s*,\s*\{([^}]+)\})?\s+from\s+['"]([^'"]+)['"]/g,
          )) {
            const names: string[] = []
            if (m[1])
              names.push(
                ...m[1]
                  .split(',')
                  .map((s) => s.trim().split(' as ')[0].trim())
                  .filter(Boolean),
              )
            if (m[2]) names.push(m[2])
            if (m[3])
              names.push(
                ...m[3]
                  .split(',')
                  .map((s) => s.trim().split(' as ')[0].trim())
                  .filter(Boolean),
              )
            let from = m[4]
            // Resolve relative imports to project-relative paths
            if (from.startsWith('.')) {
              const dir = path.dirname(filePath)
              from = path.normalize(path.join(dir, from)).replace(/\\/g, '/')
              // Try resolve extension
              for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
                if (fs.existsSync(path.join(root, from + ext))) {
                  from = from + ext
                  break
                }
                if (fs.existsSync(path.join(root, from))) break
              }
            }
            imports.push({ from, names })
          }

          return { path: filePath, category: categorize(filePath), lines, exports, imports }
        }

        function scan(dir: string) {
          const absDir = path.join(root, dir)
          if (!fs.existsSync(absDir)) return
          const entries = fs.readdirSync(absDir, { withFileTypes: true })
          let fileCount = 0

          for (const entry of entries) {
            if (skipDirs.has(entry.name)) continue
            const rel = path.join(dir, entry.name).replace(/\\/g, '/')
            if (entry.isDirectory()) {
              scan(rel)
            } else if (exts.has(path.extname(entry.name))) {
              const content = fs.readFileSync(path.join(root, rel), 'utf-8')
              files.push(parseFile(rel, content))
              fileCount++
            }
          }

          dirs.push({ path: dir, category: categorize(`${dir}/`), fileCount })
        }

        for (const d of scanDirs) scan(d)

        // Sort
        files.sort((a, b) => a.path.localeCompare(b.path))
        dirs.sort((a, b) => a.path.localeCompare(b.path))

        const totalLines = files.reduce((s, f) => s + f.lines, 0)
        const totalExports = files.reduce((s, f) => s + f.exports.length, 0)
        const totalImports = files.reduce((s, f) => s + f.imports.length, 0)
        const byCategory: Record<string, number> = {}
        for (const f of files) {
          byCategory[f.category] = (byCategory[f.category] || 0) + 1
        }

        return {
          files,
          directories: dirs,
          summary: { totalFiles: files.length, totalLines, totalExports, totalImports, byCategory },
        }
      })

      // ─── Environment Map API (SUPER_ADMIN only) ─────────
      .get('/api/admin/env-map', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const fs = await import('node:fs')
        const path = await import('node:path')
        const root = process.cwd()

        // Define all env variables used in the project
        const envDefs: {
          name: string
          envKey: string
          required: boolean
          default: string | null
          category: string
          description: string
        }[] = [
          {
            name: 'DATABASE_URL',
            envKey: 'DATABASE_URL',
            required: true,
            default: null,
            category: 'database',
            description: 'PostgreSQL connection string',
          },
          {
            name: 'REDIS_URL',
            envKey: 'REDIS_URL',
            required: true,
            default: null,
            category: 'cache',
            description: 'Redis connection string',
          },
          {
            name: 'GOOGLE_CLIENT_ID',
            envKey: 'GOOGLE_CLIENT_ID',
            required: true,
            default: null,
            category: 'auth',
            description: 'Google OAuth client ID',
          },
          {
            name: 'GOOGLE_CLIENT_SECRET',
            envKey: 'GOOGLE_CLIENT_SECRET',
            required: true,
            default: null,
            category: 'auth',
            description: 'Google OAuth client secret',
          },
          {
            name: 'SUPER_ADMIN_EMAIL',
            envKey: 'SUPER_ADMIN_EMAIL',
            required: false,
            default: '(empty)',
            category: 'auth',
            description: 'Comma-separated emails to auto-promote to SUPER_ADMIN',
          },
          {
            name: 'PORT',
            envKey: 'PORT',
            required: false,
            default: '3000',
            category: 'app',
            description: 'Server port',
          },
          {
            name: 'NODE_ENV',
            envKey: 'NODE_ENV',
            required: false,
            default: 'development',
            category: 'app',
            description: 'Environment mode',
          },
          {
            name: 'REACT_EDITOR',
            envKey: 'REACT_EDITOR',
            required: false,
            default: 'code',
            category: 'app',
            description: 'Editor for click-to-source',
          },
          {
            name: 'AUDIT_LOG_RETENTION_DAYS',
            envKey: 'AUDIT_LOG_RETENTION_DAYS',
            required: false,
            default: '90',
            category: 'app',
            description: 'Days to keep audit logs',
          },
          {
            name: 'WEBHOOK_LOG_RETENTION_DAYS',
            envKey: 'WEBHOOK_LOG_RETENTION_DAYS',
            required: false,
            default: '7',
            category: 'app',
            description: 'Days to keep /webhooks/aw request logs',
          },
          {
            name: 'MCP_SECRET',
            envKey: 'MCP_SECRET',
            required: false,
            default: '(empty)',
            category: 'mcp',
            description: 'Shared secret for readonly MCP tools (local server + /mcp HTTP)',
          },
          {
            name: 'MCP_SECRET_ADMIN',
            envKey: 'MCP_SECRET_ADMIN',
            required: false,
            default: '(empty)',
            category: 'mcp',
            description: 'Shared secret for admin/write MCP tools',
          },
          {
            name: 'PMW_WEBHOOK_TOKEN',
            envKey: 'PMW_WEBHOOK_TOKEN',
            required: false,
            default: '(empty)',
            category: 'webhooks',
            description: 'Fallback bearer token for /webhooks/aw when no DB tokens are active',
          },
          {
            name: 'PMW_EVENT_BATCH_MAX',
            envKey: 'PMW_EVENT_BATCH_MAX',
            required: false,
            default: '500',
            category: 'webhooks',
            description: 'Max events per /webhooks/aw request (413 on overflow)',
          },
          {
            name: 'GITHUB_WEBHOOK_SECRET',
            envKey: 'GITHUB_WEBHOOK_SECRET',
            required: false,
            default: '(empty)',
            category: 'webhooks',
            description: 'HMAC SHA-256 secret for /webhooks/github signature verification',
          },
          {
            name: 'UPLOADS_DIR',
            envKey: 'UPLOADS_DIR',
            required: false,
            default: './uploads',
            category: 'app',
            description: 'Local directory for task evidence uploads',
          },
          {
            name: 'UPLOAD_MAX_BYTES',
            envKey: 'UPLOAD_MAX_BYTES',
            required: false,
            default: '10485760',
            category: 'app',
            description: 'Max evidence upload size in bytes (default 10 MiB)',
          },
          {
            name: 'DIRECT_URL',
            envKey: 'DIRECT_URL',
            required: false,
            default: '(same as DATABASE_URL)',
            category: 'database',
            description: 'Prisma direct URL (bypasses connection pool for migrations)',
          },
        ]

        // Scan files for env usage
        const srcFiles = [
          'src/lib/env.ts',
          'src/lib/db.ts',
          'src/lib/redis.ts',
          'src/lib/applog.ts',
          'src/app.ts',
          'src/index.tsx',
          'src/vite.ts',
        ]
        const fileContents: Record<string, string> = {}
        for (const f of srcFiles) {
          const absPath = path.join(root, f)
          if (fs.existsSync(absPath)) fileContents[f] = fs.readFileSync(absPath, 'utf-8')
        }

        const variables = envDefs.map((def) => {
          const usedBy: string[] = []
          for (const [file, content] of Object.entries(fileContents)) {
            if (content.includes(def.envKey) || content.includes(`env.${def.name}`)) {
              usedBy.push(file)
            }
          }
          return {
            name: def.name,
            required: def.required,
            isSet: !!process.env[def.envKey],
            default: def.default,
            category: def.category,
            description: def.description,
            usedBy,
          }
        })

        const byCategory: Record<string, number> = {}
        let setCount = 0
        let requiredCount = 0
        for (const v of variables) {
          byCategory[v.category] = (byCategory[v.category] || 0) + 1
          if (v.isSet) setCount++
          if (v.required) requiredCount++
        }

        return {
          variables,
          summary: {
            total: variables.length,
            set: setCount,
            unset: variables.length - setCount,
            required: requiredCount,
            byCategory,
          },
        }
      })

      // ─── Test Coverage Map API (SUPER_ADMIN only) ──────
      .get('/api/admin/test-coverage', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const fs = await import('node:fs')
        const pathMod = await import('node:path')
        const root = process.cwd()
        const exts = new Set(['.ts', '.tsx'])
        const skipDirs = new Set(['node_modules', 'dist', 'generated', '.git'])

        interface SrcFile {
          path: string
          lines: number
          exports: string[]
          testedBy: string[]
          coverage: string
        }
        interface TestFile {
          path: string
          lines: number
          type: string
          targets: string[]
        }

        function scanDir(dir: string, collect: string[]) {
          const abs = pathMod.join(root, dir)
          if (!fs.existsSync(abs)) return
          for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
            if (skipDirs.has(entry.name)) continue
            const rel = pathMod.join(dir, entry.name).replace(/\\/g, '/')
            if (entry.isDirectory()) scanDir(rel, collect)
            else if (exts.has(pathMod.extname(entry.name))) collect.push(rel)
          }
        }

        const srcPaths: string[] = []
        scanDir('src', srcPaths)
        const srcFiltered = srcPaths.filter((f) => !f.includes('routeTree.gen'))

        const testPaths: string[] = []
        scanDir('tests', testPaths)
        const testFiltered = testPaths.filter((f) => f.includes('.test.'))

        // Parse test files
        const testFiles: TestFile[] = testFiltered.map((tp) => {
          const content = fs.readFileSync(pathMod.join(root, tp), 'utf-8')
          const lines = content.split('\n').length
          const type = tp.includes('/unit/') ? 'unit' : tp.includes('/integration/') ? 'integration' : 'other'
          const targets: string[] = []
          // Direct imports
          for (const m of content.matchAll(/from\s+['"]([^'"]*(?:src|lib)[^'"]*)['"]/g)) {
            let resolved = m[1].replace(/^.*?src\//, 'src/')
            if (resolved.startsWith('.')) {
              resolved = pathMod.normalize(pathMod.join(pathMod.dirname(tp), resolved)).replace(/\\/g, '/')
            }
            // Try resolve
            for (const ext of ['', '.ts', '.tsx']) {
              const full = resolved + ext
              if (srcFiltered.includes(full)) {
                targets.push(full)
                break
              }
            }
          }
          // API fetch patterns → app.ts
          if (/fetch\(['"`]\/api\//.test(content) || /createApp|createTestApp/.test(content)) {
            if (!targets.includes('src/app.ts')) targets.push('src/app.ts')
          }
          return { path: tp, lines, type, targets: [...new Set(targets)] }
        })

        // Build source file info
        const testedByMap: Record<string, string[]> = {}
        for (const t of testFiles) {
          for (const target of t.targets) {
            if (!testedByMap[target]) testedByMap[target] = []
            testedByMap[target].push(t.path)
          }
        }

        const sourceFiles: SrcFile[] = srcFiltered.map((sp) => {
          const content = fs.readFileSync(pathMod.join(root, sp), 'utf-8')
          const lines = content.split('\n').length
          const exports: string[] = []
          for (const m of content.matchAll(
            /export\s+(?:default\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g,
          )) {
            exports.push(m[1])
          }
          const tb = testedByMap[sp] || []
          const coverage = tb.length === 0 ? 'uncovered' : tb.some((t) => t.includes('/unit/')) ? 'covered' : 'partial'
          return { path: sp, lines, exports, testedBy: tb, coverage }
        })

        const covered = sourceFiles.filter((f) => f.coverage === 'covered').length
        const partial = sourceFiles.filter((f) => f.coverage === 'partial').length
        const uncovered = sourceFiles.filter((f) => f.coverage === 'uncovered').length

        return {
          sourceFiles,
          testFiles,
          summary: {
            totalSource: sourceFiles.length,
            totalTests: testFiles.length,
            covered,
            partial,
            uncovered,
            coveragePercent: Math.round(((covered + partial * 0.5) / sourceFiles.length) * 100),
          },
        }
      })

      // ─── Dependencies Graph API (SUPER_ADMIN only) ─────
      .get('/api/admin/dependencies', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const fs = await import('node:fs')
        const pathMod = await import('node:path')
        const root = process.cwd()
        const pkgPath = pathMod.join(root, 'package.json')
        if (!fs.existsSync(pkgPath)) {
          set.status = 404
          return { error: 'package.json not found' }
        }

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
        const deps: Record<string, string> = pkg.dependencies || {}
        const devDeps: Record<string, string> = pkg.devDependencies || {}

        // Categorize packages
        const catMap: Record<string, string> = {
          elysia: 'server',
          '@elysiajs/cors': 'server',
          '@elysiajs/html': 'server',
          react: 'ui',
          'react-dom': 'ui',
          '@mantine/core': 'ui',
          '@mantine/hooks': 'ui',
          '@tanstack/react-router': 'ui',
          '@tanstack/react-query': 'ui',
          '@xyflow/react': 'ui',
          'react-icons': 'ui',
          '@prisma/client': 'database',
          prisma: 'database',
          vite: 'build',
          typescript: 'build',
          '@biomejs/biome': 'build',
          '@vitejs/plugin-react': 'build',
          '@tanstack/router-plugin': 'build',
        }

        // Scan source for package imports
        const srcFiles: string[] = []
        function scanSrc(dir: string) {
          const abs = pathMod.join(root, dir)
          if (!fs.existsSync(abs)) return
          for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
            if (['node_modules', 'dist', 'generated', '.git'].includes(e.name)) continue
            const rel = pathMod.join(dir, e.name).replace(/\\/g, '/')
            if (e.isDirectory()) scanSrc(rel)
            else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(rel)
          }
        }
        scanSrc('src')

        const fileContents: Record<string, string> = {}
        for (const f of srcFiles) {
          fileContents[f] = fs.readFileSync(pathMod.join(root, f), 'utf-8')
        }

        const allPkgs: { name: string; version: string; type: string; category: string; usedBy: string[] }[] = []

        for (const [name, version] of Object.entries(deps)) {
          const usedBy: string[] = []
          const importPattern = new RegExp(`from\\s+['"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
          for (const [file, content] of Object.entries(fileContents)) {
            if (importPattern.test(content)) usedBy.push(file)
          }
          allPkgs.push({ name, version, type: 'runtime', category: catMap[name] || 'other', usedBy })
        }

        for (const [name, version] of Object.entries(devDeps)) {
          allPkgs.push({ name, version, type: 'dev', category: catMap[name] || 'build', usedBy: [] })
        }

        const byCategory: Record<string, number> = {}
        let runtime = 0,
          dev = 0
        for (const p of allPkgs) {
          byCategory[p.category] = (byCategory[p.category] || 0) + 1
          if (p.type === 'runtime') runtime++
          else dev++
        }

        return {
          packages: allPkgs,
          summary: { total: allPkgs.length, runtime, dev, byCategory },
        }
      })

      // ─── Migrations Timeline API (SUPER_ADMIN only) ────
      .get('/api/admin/migrations', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const fs = await import('node:fs')
        const pathMod = await import('node:path')
        const root = process.cwd()
        const migrationsDir = pathMod.join(root, 'prisma/migrations')

        if (!fs.existsSync(migrationsDir)) {
          return {
            migrations: [],
            summary: { totalMigrations: 0, firstMigration: null, lastMigration: null, totalChanges: 0 },
          }
        }

        const entries = fs
          .readdirSync(migrationsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory() && /^\d{14}_/.test(e.name))
          .sort((a, b) => a.name.localeCompare(b.name))

        const migrations = entries.map((entry) => {
          const sqlPath = pathMod.join(migrationsDir, entry.name, 'migration.sql')
          let sql = ''
          const changes: string[] = []

          if (fs.existsSync(sqlPath)) {
            sql = fs.readFileSync(sqlPath, 'utf-8')
            // Extract change summaries
            for (const m of sql.matchAll(
              /^(CREATE TABLE|ALTER TABLE|CREATE INDEX|CREATE UNIQUE INDEX|DROP TABLE|DROP INDEX|CREATE TYPE|ALTER TYPE)\s+["']?(\w+)["']?/gim,
            )) {
              changes.push(`${m[1]} ${m[2]}`)
            }
            // Also catch Prisma enum creation pattern
            for (const m of sql.matchAll(/CREATE TYPE\s+"(\w+)"/g)) {
              if (!changes.some((c) => c.includes(m[1]))) changes.push(`CREATE TYPE ${m[1]}`)
            }
          }

          // Parse date from folder name: YYYYMMDDHHMMSS_name
          const dateStr = entry.name.substring(0, 14)
          const createdAt = new Date(
            `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}T${dateStr.slice(8, 10)}:${dateStr.slice(10, 12)}:${dateStr.slice(12, 14)}.000Z`,
          ).toISOString()

          const name = entry.name.substring(15) // Remove timestamp prefix + underscore

          return { name, folder: entry.name, createdAt, changes, sql: sql.substring(0, 800) }
        })

        const totalChanges = migrations.reduce((s, m) => s + m.changes.length, 0)

        return {
          migrations,
          summary: {
            totalMigrations: migrations.length,
            firstMigration: migrations[0]?.createdAt || null,
            lastMigration: migrations[migrations.length - 1]?.createdAt || null,
            totalChanges,
          },
        }
      })

      // ─── Sessions Live API (SUPER_ADMIN only) ──────────
      .get('/api/admin/sessions', async ({ request, set }) => {
        const cookie = request.headers.get('cookie') ?? ''
        const token = cookie.match(/session=([^;]+)/)?.[1]
        if (!token) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { role: true } } },
        })
        if (!session || session.expiresAt < new Date() || !isSystemAdmin(session.user.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const onlineIds = new Set(getOnlineUserIds())
        const sessions = await prisma.session.findMany({
          include: { user: { select: { id: true, name: true, email: true, role: true, blocked: true } } },
          orderBy: { createdAt: 'desc' },
        })

        const now = new Date()
        const result = sessions.map((s) => ({
          id: s.id,
          userId: s.user.id,
          userName: s.user.name,
          userEmail: s.user.email,
          userRole: s.user.role,
          userBlocked: s.user.blocked,
          isOnline: onlineIds.has(s.user.id),
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          isExpired: s.expiresAt < now,
        }))

        const byRole: Record<string, number> = {}
        const uniqueUsers = new Set<string>()
        let active = 0,
          expired = 0
        for (const s of result) {
          uniqueUsers.add(s.userId)
          byRole[s.userRole] = (byRole[s.userRole] || 0) + 1
          if (s.isExpired) expired++
          else active++
        }

        return {
          sessions: result,
          summary: {
            totalSessions: result.length,
            activeSessions: active,
            expiredSessions: expired,
            onlineUsers: onlineIds.size,
            byRole,
          },
        }
      })

      // ─── System Health ────────────────────────────────
      .get('/api/admin/health', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }

        const now = Date.now()
        const since24h = new Date(now - 24 * 60 * 60 * 1000)
        const LIVE_MS = 5 * 60 * 1000

        const dbStart = Date.now()
        let dbOk = false
        let dbLatencyMs: number | null = null
        let dbError: string | null = null
        try {
          await prisma.$queryRawUnsafe('SELECT 1')
          dbOk = true
          dbLatencyMs = Date.now() - dbStart
        } catch (e) {
          dbError = e instanceof Error ? e.message : 'unknown'
        }

        const redisStart = Date.now()
        let redisOk = false
        let redisLatencyMs: number | null = null
        let redisError: string | null = null
        try {
          await redis.send('PING', [])
          redisOk = true
          redisLatencyMs = Date.now() - redisStart
        } catch (e) {
          redisError = e instanceof Error ? e.message : 'unknown'
        }

        const [
          agents,
          sessionsTotal,
          sessionsActive,
          webhookTotal,
          webhookOk,
          webhookFail,
          webhookAuthFail,
          webhookEvents,
          auditLogCount,
          webhookLogCount,
          agentsCount,
          tokensActive,
        ] = await Promise.all([
          prisma.agent.findMany({ select: { status: true, lastSeenAt: true } }),
          prisma.session.count(),
          prisma.session.count({ where: { expiresAt: { gt: new Date(now) } } }),
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since24h } } }),
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since24h }, statusCode: { lt: 400 } } }),
          prisma.webhookRequestLog.count({
            where: { createdAt: { gte: since24h }, statusCode: { gte: 400 }, reason: { not: 'unauthorized' } },
          }),
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since24h }, reason: 'unauthorized' } }),
          prisma.webhookRequestLog.aggregate({
            _sum: { eventsIn: true },
            where: { createdAt: { gte: since24h } },
          }),
          prisma.auditLog.count(),
          prisma.webhookRequestLog.count(),
          prisma.agent.count(),
          prisma.webhookToken.count({ where: { status: 'ACTIVE' } }),
        ])

        const agentSummary = {
          total: agentsCount,
          pending: agents.filter((a) => a.status === 'PENDING').length,
          approved: agents.filter((a) => a.status === 'APPROVED').length,
          revoked: agents.filter((a) => a.status === 'REVOKED').length,
          live: agents.filter((a) => a.status === 'APPROVED' && a.lastSeenAt && now - a.lastSeenAt.getTime() < LIVE_MS)
            .length,
        }

        const webhooks = {
          total24h: webhookTotal,
          success24h: webhookOk,
          fail24h: webhookFail,
          authFail24h: webhookAuthFail,
          eventsIn24h: webhookEvents._sum.eventsIn ?? 0,
          successRate: webhookTotal > 0 ? Math.round((webhookOk / webhookTotal) * 1000) / 10 : null,
          activeTokens: tokensActive,
        }

        const retention = {
          auditLogDays: env.AUDIT_LOG_RETENTION_DAYS,
          auditLogCount,
          webhookLogDays: env.WEBHOOK_LOG_RETENTION_DAYS,
          webhookLogCount,
        }

        const envChecks: { key: string; set: boolean; required: boolean; note?: string }[] = [
          { key: 'DATABASE_URL', set: !!Bun.env.DATABASE_URL, required: true },
          { key: 'REDIS_URL', set: !!Bun.env.REDIS_URL, required: true },
          { key: 'GOOGLE_CLIENT_ID', set: !!Bun.env.GOOGLE_CLIENT_ID, required: true },
          { key: 'GOOGLE_CLIENT_SECRET', set: !!Bun.env.GOOGLE_CLIENT_SECRET, required: true },
          {
            key: 'PMW_WEBHOOK_TOKEN',
            set: !!Bun.env.PMW_WEBHOOK_TOKEN,
            required: false,
            note: tokensActive > 0 ? 'DB tokens active, env fallback unused' : 'env fallback in use',
          },
          { key: 'GITHUB_WEBHOOK_SECRET', set: !!Bun.env.GITHUB_WEBHOOK_SECRET, required: false },
          { key: 'MCP_SECRET', set: !!Bun.env.MCP_SECRET, required: false },
          { key: 'SUPER_ADMIN_EMAIL', set: !!Bun.env.SUPER_ADMIN_EMAIL, required: false },
        ]

        return {
          timestamp: new Date(now).toISOString(),
          services: {
            db: { ok: dbOk, latencyMs: dbLatencyMs, error: dbError },
            redis: { ok: redisOk, latencyMs: redisLatencyMs, error: redisError },
          },
          sessions: {
            total: sessionsTotal,
            active: sessionsActive,
            online: getOnlineUserIds().length,
          },
          agents: agentSummary,
          webhooks,
          retention,
          env: envChecks,
        }
      })

      // ─── Effort tracking (pm-watch × tasks) ──────────
      .get('/api/admin/effort', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const projectId = typeof query.projectId === 'string' ? query.projectId : undefined
        const onlyClosed = query.onlyClosed === 'true'
        const limit = Math.min(500, Math.max(1, Number(query.limit) || 100))
        const rows = await effortReport({ projectId, onlyClosed, limit })
        return { count: rows.length, rows }
      })

      .get('/api/admin/effort/task/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const effort = await computeTaskEffort(params.id)
        if (!effort) {
          set.status = 404
          return { error: 'Task not found' }
        }
        return effort
      })

      .get('/api/admin/effort/ghost', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const staleDays = Math.min(30, Math.max(1, Number(query.staleDays) || 3))
        const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
        const rows = await detectGhostTasks({ staleDays, limit })
        return { count: rows.length, staleDays, rows }
      })

      .get('/api/admin/effort/phantom', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const days = Math.min(90, Math.max(1, Number(query.days) || 7))
        const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
        const rows = await computePhantomWork({ days, limit })
        return { count: rows.length, days, rows }
      })

      // ─── Admin Overview Cockpit ───────────────────────
      .get('/api/admin/overview/risks', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const staleDays = Math.min(30, Math.max(1, Number(query.staleDays) || 3))
        const offlineHours = Math.min(720, Math.max(1, Number(query.offlineHours) || 1))
        return computeRiskReport({ staleDays, offlineHours })
      })

      .get('/api/admin/overview/health', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const projectId = typeof query.projectId === 'string' ? query.projectId : undefined
        const includeArchived = query.includeArchived === 'true'
        const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
        return computeProjectHealth({ projectId, includeArchived, limit })
      })

      .get('/api/admin/overview/load', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const projectId = typeof query.projectId === 'string' ? query.projectId : undefined
        const includeUnassigned = query.includeUnassigned !== 'false'
        const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
        return computeTeamLoad({ projectId, includeUnassigned, limit })
      })

      .get('/api/admin/overview/kpis', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const recentAuditLimit = Math.min(50, Math.max(0, Number(query.recentAuditLimit) || 8))
        return computeAdminOverview({ recentAuditLimit })
      })

      // ─── Projects API ─────────────────────────────────
      .get('/api/users', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const users = await prisma.user.findMany({
          where: { blocked: false },
          select: { id: true, name: true, email: true, role: true },
          orderBy: { name: 'asc' },
        })
        return { users }
      })

      .get('/api/projects', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = isSystemAdmin(auth.role)
        const projectInclude = {
          owner: { select: { id: true, name: true, email: true } },
          _count: { select: { members: true, tasks: true, milestones: true } },
        }
        const memberships = await prisma.projectMember.findMany({
          where: { userId: auth.userId },
          include: { project: { include: projectInclude } },
          orderBy: { joinedAt: 'desc' },
        })
        const roleByProject = new Map<string, 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'>()
        const joinedAtByProject = new Map<string, Date>()
        for (const m of memberships) {
          roleByProject.set(m.projectId, m.role)
          joinedAtByProject.set(m.projectId, m.joinedAt)
        }
        const projectRows = isAdmin
          ? await prisma.project.findMany({
              include: projectInclude,
              orderBy: { createdAt: 'desc' },
            })
          : memberships.map((m) => m.project)
        const projectIds = projectRows.map((p) => p.id)
        const grouped = projectIds.length
          ? await prisma.task.groupBy({
              by: ['projectId', 'status'],
              where: { projectId: { in: projectIds } },
              _count: { _all: true },
            })
          : []
        const statsByProject = new Map<string, Record<string, number>>()
        for (const g of grouped) {
          const row = statsByProject.get(g.projectId) ?? {}
          row[g.status] = g._count._all
          statsByProject.set(g.projectId, row)
        }
        const milestonesDone = projectIds.length
          ? await prisma.projectMilestone.groupBy({
              by: ['projectId'],
              where: { projectId: { in: projectIds }, completedAt: { not: null } },
              _count: { _all: true },
            })
          : []
        const doneByProject = new Map<string, number>(milestonesDone.map((m) => [m.projectId, m._count._all]))
        return {
          projects: projectRows.map((p) => {
            const s = statsByProject.get(p.id) ?? {}
            return {
              ...p,
              myRole: roleByProject.get(p.id) ?? null,
              joinedAt: joinedAtByProject.get(p.id) ?? null,
              taskStats: {
                open: s.OPEN ?? 0,
                inProgress: s.IN_PROGRESS ?? 0,
                readyForQc: s.READY_FOR_QC ?? 0,
                reopened: s.REOPENED ?? 0,
                closed: s.CLOSED ?? 0,
                total:
                  (s.OPEN ?? 0) + (s.IN_PROGRESS ?? 0) + (s.READY_FOR_QC ?? 0) + (s.REOPENED ?? 0) + (s.CLOSED ?? 0),
              },
              milestoneStats: {
                done: doneByProject.get(p.id) ?? 0,
                total: p._count.milestones,
              },
            }
          }),
        }
      })

      .post('/api/projects', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'ADMIN' && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Only admins can create projects' }
        }
        const body = (await request.json()) as {
          name?: string
          description?: string
          status?: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
          priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
          startsAt?: string | null
          endsAt?: string | null
        }
        if (!body.name?.trim()) {
          set.status = 400
          return { error: 'name wajib diisi' }
        }
        const endsAt = body.endsAt ? new Date(body.endsAt) : null
        const project = await prisma.project.create({
          data: {
            name: body.name.trim(),
            description: body.description ?? null,
            ownerId: auth.userId,
            status: body.status ?? 'ACTIVE',
            priority: body.priority ?? 'MEDIUM',
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
            endsAt,
            originalEndAt: endsAt,
            members: { create: { userId: auth.userId, role: 'OWNER' } },
          },
          include: {
            owner: { select: { id: true, name: true, email: true } },
            _count: { select: { members: true, tasks: true } },
          },
        })
        audit(auth.userId, 'PROJECT_CREATED', `${project.name} (${project.id})`, getIp(request))
        appLog('info', `Project created: ${project.name} by ${auth.email}`)
        return { project }
      })

      .get('/api/projects/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const project = await prisma.project.findUnique({
          where: { id: params.id },
          include: {
            owner: { select: { id: true, name: true, email: true } },
            members: {
              include: { user: { select: { id: true, name: true, email: true, role: true } } },
              orderBy: { joinedAt: 'asc' },
            },
            _count: { select: { tasks: true } },
          },
        })
        if (!project) {
          set.status = 404
          return { error: 'Project not found' }
        }
        const grouped = await prisma.task.groupBy({
          by: ['status'],
          where: { projectId: params.id },
          _count: { _all: true },
        })
        const s: Record<string, number> = {}
        for (const g of grouped) s[g.status] = g._count._all
        const taskStats = {
          open: s.OPEN ?? 0,
          inProgress: s.IN_PROGRESS ?? 0,
          readyForQc: s.READY_FOR_QC ?? 0,
          reopened: s.REOPENED ?? 0,
          closed: s.CLOSED ?? 0,
          total: (s.OPEN ?? 0) + (s.IN_PROGRESS ?? 0) + (s.READY_FOR_QC ?? 0) + (s.REOPENED ?? 0) + (s.CLOSED ?? 0),
        }
        return { project: { ...project, taskStats }, myRole: membership?.role ?? null }
      })

      .patch('/api/projects/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can modify project' }
        }
        const body = (await request.json()) as {
          name?: string
          description?: string | null
          status?: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
          priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
          startsAt?: string | null
          endsAt?: string | null
          archived?: boolean
          githubRepo?: string | null
        }
        const existing = await prisma.project.findUnique({
          where: { id: params.id },
          select: { endsAt: true, originalEndAt: true },
        })
        if (!existing) {
          set.status = 404
          return { error: 'Project not found' }
        }
        const data: Record<string, unknown> = {}
        if (body.name !== undefined) data.name = body.name
        if (body.description !== undefined) data.description = body.description
        if (body.status !== undefined) data.status = body.status
        if (body.priority !== undefined) data.priority = body.priority
        if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(body.startsAt) : null
        if (body.endsAt !== undefined) {
          const newEnd = body.endsAt ? new Date(body.endsAt) : null
          data.endsAt = newEnd
          if (existing.originalEndAt == null && newEnd != null) {
            data.originalEndAt = newEnd
          }
        }
        if (body.archived !== undefined) data.archivedAt = body.archived ? new Date() : null
        if (body.githubRepo !== undefined) {
          if (body.githubRepo === null || body.githubRepo === '') {
            data.githubRepo = null
          } else {
            const normalized = normalizeGithubRepo(body.githubRepo)
            if (!normalized) {
              set.status = 400
              return { error: 'Invalid GitHub repo — use owner/repo or full URL' }
            }
            data.githubRepo = normalized
          }
        }
        try {
          const project = await prisma.project.update({ where: { id: params.id }, data })
          audit(auth.userId, 'PROJECT_UPDATED', `${project.id} ${Object.keys(data).join(',')}`, getIp(request))
          return { project }
        } catch (e) {
          const err = e as { code?: string }
          if (err.code === 'P2002') {
            set.status = 409
            return { error: 'This GitHub repo is already linked to another project' }
          }
          throw e
        }
      })

      .delete('/api/projects/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const me = await prisma.user.findUnique({ where: { id: auth.userId }, select: { role: true } })
        const membership = await requireProjectMember(params.id, auth.userId)
        const isOwner = membership?.role === 'OWNER'
        const isSuperAdmin = me?.role === 'SUPER_ADMIN'
        if (!isOwner && !isSuperAdmin) {
          set.status = 403
          return { error: 'Only the project OWNER or SUPER_ADMIN can delete a project' }
        }
        const project = await prisma.project.findUnique({ where: { id: params.id }, select: { id: true, name: true } })
        if (!project) {
          set.status = 404
          return { error: 'Project not found' }
        }
        await prisma.project.delete({ where: { id: params.id } })
        audit(auth.userId, 'PROJECT_DELETED', `${project.id} ${project.name}`, getIp(request))
        return { ok: true }
      })

      .get('/api/projects/:id/github/summary', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const project = await prisma.project.findUnique({
          where: { id: params.id },
          select: { id: true, githubRepo: true },
        })
        if (!project) {
          set.status = 404
          return { error: 'Project not found' }
        }
        if (!project.githubRepo) {
          return { linked: false, repo: null }
        }
        const now = Date.now()
        const day = 24 * 3600 * 1000
        const last7 = new Date(now - 7 * day)
        const last30 = new Date(now - 30 * day)

        const [commits7, commits30, contributors, openPrs, lastEvent, recentEvents, allPushes] = await Promise.all([
          prisma.projectGithubEvent.count({
            where: { projectId: params.id, kind: 'PUSH_COMMIT', createdAt: { gte: last7 } },
          }),
          prisma.projectGithubEvent.count({
            where: { projectId: params.id, kind: 'PUSH_COMMIT', createdAt: { gte: last30 } },
          }),
          prisma.projectGithubEvent.groupBy({
            by: ['actorLogin'],
            where: { projectId: params.id, kind: 'PUSH_COMMIT', createdAt: { gte: last30 } },
            _count: { _all: true },
            orderBy: { _count: { actorLogin: 'desc' } },
            take: 8,
          }),
          prisma.projectGithubEvent.findMany({
            where: { projectId: params.id, kind: 'PR_OPENED' },
            select: { prNumber: true, title: true, url: true, actorLogin: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 30,
          }),
          prisma.projectGithubEvent.findFirst({
            where: { projectId: params.id, kind: 'PUSH_COMMIT' },
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true, actorLogin: true },
          }),
          prisma.projectGithubEvent.findMany({
            where: { projectId: params.id },
            orderBy: { createdAt: 'desc' },
            take: 15,
            include: { matchedUser: { select: { id: true, name: true, email: true } } },
          }),
          prisma.projectGithubEvent.findMany({
            where: { projectId: params.id, kind: { in: ['PR_CLOSED', 'PR_MERGED'] } },
            select: { prNumber: true },
          }),
        ])

        const closedPrNums = new Set(allPushes.map((p) => p.prNumber).filter((n): n is number => n != null))
        const openPrList = openPrs.filter((p) => p.prNumber != null && !closedPrNums.has(p.prNumber))

        return {
          linked: true,
          repo: project.githubRepo,
          stats: {
            commits7d: commits7,
            commits30d: commits30,
            contributors30d: contributors.length,
            openPrs: openPrList.length,
            lastPushAt: lastEvent?.createdAt ?? null,
            lastPushBy: lastEvent?.actorLogin ?? null,
          },
          contributors: contributors.map((c) => ({ login: c.actorLogin, commits: c._count._all })),
          openPrs: openPrList.slice(0, 5),
          recent: recentEvents,
        }
      })

      .get('/api/projects/:id/github/feed', async ({ request, params, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const limit = Math.min(100, Math.max(1, parseInt((query.limit as string) ?? '50', 10) || 50))
        const kindParam = typeof query.kind === 'string' ? query.kind.toUpperCase() : null
        const validKinds = ['PUSH_COMMIT', 'PR_OPENED', 'PR_CLOSED', 'PR_MERGED', 'PR_REVIEWED'] as const
        const kind = validKinds.includes(kindParam as (typeof validKinds)[number])
          ? (kindParam as (typeof validKinds)[number])
          : null
        const events = await prisma.projectGithubEvent.findMany({
          where: { projectId: params.id, ...(kind ? { kind } : {}) },
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: { matchedUser: { select: { id: true, name: true, email: true } } },
        })
        return { events }
      })

      // ─── Retrospective ───────────────────────────────
      .get('/api/projects/:id/retro', async ({ request, params, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN' && auth.role !== 'ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const now = Date.now()
        const defaultSince = new Date(now - 14 * 24 * 60 * 60 * 1000)
        const since = typeof query.since === 'string' ? new Date(query.since) : defaultSince
        const until = typeof query.until === 'string' ? new Date(query.until) : new Date(now)
        if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || until <= since) {
          set.status = 400
          return { error: 'Invalid since/until' }
        }
        const retro = await computeRetro({ projectId: params.id, since, until })
        if (!retro) {
          set.status = 404
          return { error: 'Project not found' }
        }
        if (query.format === 'md' || query.format === 'markdown') {
          set.headers['content-type'] = 'text/markdown; charset=utf-8'
          return renderRetroMarkdown(retro)
        }
        return retro
      })

      .post('/api/projects/:id/members', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can add members' }
        }
        const body = (await request.json()) as { userId?: string; role?: string }
        if (!body.userId) {
          set.status = 400
          return { error: 'userId wajib diisi' }
        }
        const role = (body.role ?? 'MEMBER') as 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'
        if (role === 'OWNER' && !canGrantProjectOwner(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER or SUPER_ADMIN can grant OWNER role' }
        }
        const existingMember = await prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId: params.id, userId: body.userId } },
        })
        if (existingMember) {
          set.status = 409
          return { error: 'User is already a member of this project' }
        }
        const member = await prisma.projectMember.create({
          data: { projectId: params.id, userId: body.userId, role },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        })
        audit(auth.userId, 'PROJECT_MEMBER_ADDED', `${params.id} ← ${body.userId} (${role})`, getIp(request))
        return { member }
      })

      .post('/api/projects/:id/extend', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can extend deadline' }
        }
        const body = (await request.json()) as { newEndAt?: string; reason?: string }
        if (!body.newEndAt) {
          set.status = 400
          return { error: 'newEndAt wajib diisi' }
        }
        const newEnd = new Date(body.newEndAt)
        if (Number.isNaN(newEnd.getTime())) {
          set.status = 400
          return { error: 'newEndAt tidak valid' }
        }
        const existing = await prisma.project.findUnique({
          where: { id: params.id },
          select: { endsAt: true, originalEndAt: true, startsAt: true },
        })
        if (!existing) {
          set.status = 404
          return { error: 'Project not found' }
        }
        if (existing.startsAt && newEnd < existing.startsAt) {
          set.status = 400
          return { error: 'newEndAt must be after startsAt' }
        }
        if (existing.endsAt && newEnd.getTime() === existing.endsAt.getTime()) {
          set.status = 400
          return { error: 'newEndAt sama dengan deadline saat ini' }
        }
        const [extension, project] = await prisma.$transaction([
          prisma.projectExtension.create({
            data: {
              projectId: params.id,
              extendedById: auth.userId,
              previousEndAt: existing.endsAt,
              newEndAt: newEnd,
              reason: body.reason?.trim() || null,
            },
            include: { extendedBy: { select: { id: true, name: true, email: true } } },
          }),
          prisma.project.update({
            where: { id: params.id },
            data: {
              endsAt: newEnd,
              originalEndAt: existing.originalEndAt ?? existing.endsAt ?? newEnd,
            },
          }),
        ])
        audit(
          auth.userId,
          'PROJECT_EXTENDED',
          `${params.id} ${existing.endsAt?.toISOString() ?? 'null'} → ${newEnd.toISOString()}${body.reason ? ` (${body.reason})` : ''}`,
          getIp(request),
        )
        return { extension, project }
      })

      .get('/api/projects/:id/extensions', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const extensions = await prisma.projectExtension.findMany({
          where: { projectId: params.id },
          include: { extendedBy: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        })
        return { extensions }
      })

      .get('/api/milestones', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const memberships = await prisma.projectMember.findMany({
          where: { userId: auth.userId },
          select: { projectId: true },
        })
        const projectIds = memberships.map((m) => m.projectId)
        if (projectIds.length === 0) return { milestones: [] }
        const milestones = await prisma.projectMilestone.findMany({
          where: { projectId: { in: projectIds } },
          orderBy: [{ order: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
        })
        return { milestones }
      })

      .get('/api/projects/:id/milestones', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const milestones = await prisma.projectMilestone.findMany({
          where: { projectId: params.id },
          orderBy: [{ order: 'asc' }, { dueAt: 'asc' }, { createdAt: 'asc' }],
        })
        return { milestones }
      })

      .post('/api/projects/:id/milestones', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can create milestones' }
        }
        const body = (await request.json()) as {
          title?: string
          description?: string | null
          dueAt?: string | null
        }
        if (!body.title?.trim()) {
          set.status = 400
          return { error: 'title wajib diisi' }
        }
        const last = await prisma.projectMilestone.findFirst({
          where: { projectId: params.id },
          orderBy: { order: 'desc' },
          select: { order: true },
        })
        const milestone = await prisma.projectMilestone.create({
          data: {
            projectId: params.id,
            title: body.title.trim(),
            description: body.description?.trim() || null,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            order: (last?.order ?? -1) + 1,
          },
        })
        audit(auth.userId, 'MILESTONE_CREATED', `${params.id} ${milestone.title}`, getIp(request))
        return { milestone }
      })

      .patch('/api/milestones/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const existing = await prisma.projectMilestone.findUnique({
          where: { id: params.id },
          select: { projectId: true, completedAt: true },
        })
        if (!existing) {
          set.status = 404
          return { error: 'Milestone not found' }
        }
        const membership = await requireProjectMember(existing.projectId, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can modify milestones' }
        }
        const body = (await request.json()) as {
          title?: string
          description?: string | null
          dueAt?: string | null
          completed?: boolean
          order?: number
        }
        const data: Record<string, unknown> = {}
        if (body.title !== undefined) data.title = body.title.trim()
        if (body.description !== undefined) data.description = body.description?.trim() || null
        if (body.dueAt !== undefined) data.dueAt = body.dueAt ? new Date(body.dueAt) : null
        if (body.completed !== undefined) data.completedAt = body.completed ? new Date() : null
        if (body.order !== undefined) data.order = body.order
        const milestone = await prisma.projectMilestone.update({ where: { id: params.id }, data })
        audit(
          auth.userId,
          'MILESTONE_UPDATED',
          `${existing.projectId}/${params.id} ${Object.keys(data).join(',')}`,
          getIp(request),
        )
        return { milestone }
      })

      .delete('/api/milestones/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const existing = await prisma.projectMilestone.findUnique({
          where: { id: params.id },
          select: { projectId: true, title: true },
        })
        if (!existing) {
          set.status = 404
          return { error: 'Milestone not found' }
        }
        const membership = await requireProjectMember(existing.projectId, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can delete milestones' }
        }
        await prisma.projectMilestone.delete({ where: { id: params.id } })
        audit(auth.userId, 'MILESTONE_DELETED', `${existing.projectId}/${params.id} ${existing.title}`, getIp(request))
        return { ok: true }
      })

      .patch('/api/projects/:id/members/:userId', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can change member role' }
        }
        const body = (await request.json()) as { role?: string }
        const role = body.role as 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER' | undefined
        if (!role || !['OWNER', 'PM', 'MEMBER', 'VIEWER'].includes(role)) {
          set.status = 400
          return { error: 'role wajib diisi (OWNER|PM|MEMBER|VIEWER)' }
        }
        if (role === 'OWNER' && !canGrantProjectOwner(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER or SUPER_ADMIN can grant OWNER role' }
        }
        const project = await prisma.project.findUnique({ where: { id: params.id }, select: { ownerId: true } })
        if (project?.ownerId === params.userId && role !== 'OWNER') {
          set.status = 400
          return { error: 'Cannot demote the project owner' }
        }
        const updated = await prisma.projectMember.update({
          where: { projectId_userId: { projectId: params.id, userId: params.userId } },
          data: { role },
          include: { user: { select: { id: true, name: true, email: true, role: true } } },
        })
        audit(auth.userId, 'PROJECT_MEMBER_ROLE_CHANGED', `${params.id} ${params.userId} → ${role}`, getIp(request))
        return { member: updated }
      })

      .delete('/api/projects/:id/members/:userId', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!canManageProject(auth, membership)) {
          set.status = 403
          return { error: 'Only OWNER, PM, or system admin can remove members' }
        }
        const project = await prisma.project.findUnique({ where: { id: params.id }, select: { ownerId: true } })
        if (project?.ownerId === params.userId) {
          set.status = 400
          return { error: 'Cannot remove the project owner' }
        }
        await prisma.projectMember.delete({
          where: { projectId_userId: { projectId: params.id, userId: params.userId } },
        })
        audit(auth.userId, 'PROJECT_MEMBER_REMOVED', `${params.id} ← ${params.userId}`, getIp(request))
        return { ok: true }
      })

      // ─── Tasks API ────────────────────────────────────
      .get('/api/tasks', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = isSystemAdmin(auth.role)
        const myProjectIds = (
          await prisma.projectMember.findMany({ where: { userId: auth.userId }, select: { projectId: true } })
        ).map((m) => m.projectId)
        const where: Record<string, unknown> = isAdmin ? {} : { projectId: { in: myProjectIds } }
        if (query.projectId) {
          if (!isAdmin && !myProjectIds.includes(String(query.projectId))) {
            set.status = 403
            return { error: 'Not a member of that project' }
          }
          where.projectId = String(query.projectId)
        }
        const TASK_STATUS_VALUES = ['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED'] as const
        const TASK_KIND_VALUES = ['TASK', 'BUG', 'QC'] as const
        if (query.status) {
          const s = String(query.status)
          if (!(TASK_STATUS_VALUES as readonly string[]).includes(s)) {
            set.status = 400
            return { error: `status must be one of: ${TASK_STATUS_VALUES.join(', ')}` }
          }
          where.status = s
        }
        if (query.kind) {
          const k = String(query.kind)
          if (!(TASK_KIND_VALUES as readonly string[]).includes(k)) {
            set.status = 400
            return { error: `kind must be one of: ${TASK_KIND_VALUES.join(', ')}` }
          }
          where.kind = k
        }
        if (query.assigneeId) where.assigneeId = String(query.assigneeId)
        if (query.mine === '1') where.assigneeId = auth.userId

        if (query.tagId) {
          where.tags = { some: { tagId: String(query.tagId) } }
        }
        const tasks = await prisma.task.findMany({
          where,
          include: {
            project: { select: { id: true, name: true } },
            reporter: { select: { id: true, name: true, email: true, role: true } },
            assignee: { select: { id: true, name: true, email: true, role: true } },
            tags: { include: { tag: true } },
            checklist: { select: { done: true } },
            blockedBy: { select: { blockedById: true } },
            _count: { select: { comments: true, evidence: true, blockedBy: true, blocks: true } },
          },
          orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
          take: Math.min(Number(query.limit) || 100, 500),
        })
        const enriched = tasks.map((t) => ({
          ...t,
          actualHours: computeActualHours(t),
          progressPercent: computeProgressPercent(t),
        }))
        return { tasks: enriched }
      })

      .post('/api/tasks', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const body = (await request.json()) as {
          projectId?: string
          kind?: string
          title?: string
          description?: string
          priority?: string
          route?: string
          assigneeId?: string
          startsAt?: string
          dueAt?: string
          estimateHours?: number
          tagIds?: string[]
        }
        if (!body.projectId || !body.title || !body.description) {
          set.status = 400
          return { error: 'projectId, title, description wajib diisi' }
        }
        if (body.title.length > 500) {
          set.status = 400
          return { error: 'Title must be 500 characters or fewer' }
        }
        const membership = await requireProjectMember(body.projectId, auth.userId)
        if (!isSystemAdmin(auth.role) && (!membership || membership.role === 'VIEWER')) {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        if (!membership) {
          const exists = await prisma.project.findUnique({ where: { id: body.projectId }, select: { id: true } })
          if (!exists) {
            set.status = 404
            return { error: 'Project not found' }
          }
        }
        if (body.tagIds?.length) {
          const validTags = await prisma.tag.findMany({
            where: { id: { in: body.tagIds }, projectId: body.projectId },
            select: { id: true },
          })
          if (validTags.length !== body.tagIds.length) {
            set.status = 400
            return { error: 'One or more tagIds do not exist in this project' }
          }
        }
        const task = await prisma.task.create({
          data: {
            projectId: body.projectId,
            kind: (body.kind as 'TASK' | 'BUG' | 'QC') ?? 'TASK',
            title: body.title,
            description: body.description,
            priority: (body.priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL') ?? 'MEDIUM',
            route: body.route ?? null,
            reporterId: auth.userId,
            assigneeId: body.assigneeId ?? null,
            startsAt: body.startsAt ? new Date(body.startsAt) : null,
            dueAt: body.dueAt ? new Date(body.dueAt) : null,
            estimateHours: typeof body.estimateHours === 'number' ? body.estimateHours : null,
            tags: body.tagIds?.length ? { create: body.tagIds.map((tagId) => ({ tagId })) } : undefined,
          },
        })
        audit(auth.userId, 'TASK_CREATED', `#${task.id} ${task.title}`, getIp(request))
        appLog('info', `Task created: ${task.title} by ${auth.email}`)
        if (task.assigneeId && task.assigneeId !== auth.userId) {
          const actor = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } })
          notifyTaskAssigned({
            taskId: task.id,
            projectId: task.projectId,
            taskTitle: task.title,
            assigneeId: task.assigneeId,
            actorId: auth.userId,
            actorName: actor?.name ?? 'Someone',
          }).catch(() => {})
        }
        return { task }
      })

      .get('/api/tasks/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({
          where: { id: params.id },
          include: {
            project: { select: { id: true, name: true } },
            reporter: { select: { id: true, name: true, email: true, role: true } },
            assignee: { select: { id: true, name: true, email: true, role: true } },
            comments: {
              include: { author: { select: { id: true, name: true, email: true, role: true } } },
              orderBy: { createdAt: 'asc' },
            },
            evidence: { orderBy: { createdAt: 'asc' } },
            tags: { include: { tag: true } },
            blockedBy: {
              include: {
                blockedBy: {
                  select: { id: true, title: true, status: true, kind: true },
                },
              },
            },
            blocks: {
              include: {
                task: {
                  select: { id: true, title: true, status: true, kind: true },
                },
              },
            },
            checklist: { orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] },
            statusChanges: {
              include: { author: { select: { id: true, name: true, email: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const actualHours = computeActualHours(task)
        const progressPercent = computeProgressPercent(task)
        const awFocus = await computeTaskAwFocus(task)
        return { task: { ...task, actualHours, progressPercent, awFocus } }
      })

      .patch('/api/tasks/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const current = await prisma.task.findUnique({ where: { id: params.id } })
        if (!current) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(current.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as {
          title?: string
          description?: string
          priority?: string
          kind?: string
          route?: string | null
          status?: string
          assigneeId?: string | null
          startsAt?: string | null
          dueAt?: string | null
          estimateHours?: number | null
          progressPercent?: number | null
          tagIds?: string[]
        }
        if (body.title !== undefined && body.title.length > 500) {
          set.status = 400
          return { error: 'Title must be 500 characters or fewer' }
        }
        const data: Record<string, unknown> = {}
        if (body.title !== undefined) data.title = body.title
        if (body.description !== undefined) data.description = body.description
        if (body.priority !== undefined) data.priority = body.priority
        if (body.kind !== undefined) data.kind = body.kind
        if (body.route !== undefined) data.route = body.route
        if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId
        if (body.startsAt !== undefined) data.startsAt = body.startsAt ? new Date(body.startsAt) : null
        if (body.dueAt !== undefined) data.dueAt = body.dueAt ? new Date(body.dueAt) : null
        if (body.estimateHours !== undefined)
          data.estimateHours = body.estimateHours === null ? null : Number(body.estimateHours)
        if (body.progressPercent !== undefined) {
          const p = body.progressPercent
          data.progressPercent = p === null ? null : Math.max(0, Math.min(100, Math.round(p)))
        }
        let statusTransition: { from: string; to: string } | null = null
        if (body.status !== undefined) {
          const allowed = getAllowedTaskTransitions(current.status, current.kind)
          if (!allowed.includes(body.status)) {
            set.status = 400
            return { error: `Invalid transition: ${current.status} → ${body.status} for ${current.kind}` }
          }
          if (body.status !== current.status) {
            statusTransition = { from: current.status, to: body.status }
          }
          data.status = body.status
          if (body.status === 'CLOSED') data.closedAt = new Date()
          if (body.status === 'REOPENED') data.closedAt = null
        }
        const task = await prisma.task.update({ where: { id: params.id }, data })
        if (statusTransition) {
          await prisma.taskStatusChange.create({
            data: {
              taskId: task.id,
              authorId: auth.userId,
              fromStatus: statusTransition.from as 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED',
              toStatus: statusTransition.to as 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED',
            },
          })
        }
        if (body.tagIds !== undefined) {
          await prisma.taskTag.deleteMany({ where: { taskId: task.id } })
          if (body.tagIds.length) {
            await prisma.taskTag.createMany({
              data: body.tagIds.map((tagId) => ({ taskId: task.id, tagId })),
              skipDuplicates: true,
            })
          }
        }
        audit(auth.userId, 'TASK_UPDATED', `#${task.id} ${Object.keys(data).join(',')}`, getIp(request))
        const actor = await prisma.user.findUnique({ where: { id: auth.userId }, select: { name: true } })
        const actorName = actor?.name ?? 'Someone'
        if (
          body.assigneeId !== undefined &&
          body.assigneeId &&
          body.assigneeId !== current.assigneeId &&
          body.assigneeId !== auth.userId
        ) {
          notifyTaskAssigned({
            taskId: task.id,
            projectId: task.projectId,
            taskTitle: task.title,
            assigneeId: body.assigneeId,
            actorId: auth.userId,
            actorName,
          }).catch(() => {})
        }
        if (statusTransition) {
          notifyTaskStatusChanged({
            taskId: task.id,
            projectId: task.projectId,
            taskTitle: task.title,
            reporterId: current.reporterId,
            assigneeId: task.assigneeId,
            actorId: auth.userId,
            actorName,
            fromStatus: statusTransition.from,
            toStatus: statusTransition.to,
          }).catch(() => {})
        }
        return { task }
      })

      .delete('/api/tasks/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const current = await prisma.task.findUnique({ where: { id: params.id } })
        if (!current) {
          set.status = 404
          return { error: 'Task not found' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          const membership = await requireProjectMember(current.projectId, auth.userId)
          if (!membership || (membership.role !== 'OWNER' && membership.role !== 'PM')) {
            set.status = 403
            return { error: 'Only project OWNER/PM can delete tasks' }
          }
        }
        await prisma.task.delete({ where: { id: params.id } })
        audit(auth.userId, 'TASK_DELETED', `#${current.id} "${current.title}"`, getIp(request))
        appLog('info', `Task deleted: #${current.id} by ${auth.userId}`)
        return { ok: true }
      })

      .post('/api/tasks/:id/comments', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({
          where: { id: params.id },
          select: { projectId: true, title: true, reporterId: true, assigneeId: true },
        })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const { body: text } = (await request.json()) as { body?: string }
        if (!text?.trim()) {
          set.status = 400
          return { error: 'body wajib diisi' }
        }
        const comment = await prisma.taskComment.create({
          data: {
            taskId: params.id,
            authorId: auth.userId,
            authorTag: membership.role,
            body: text,
          },
          include: { author: { select: { id: true, name: true, email: true, role: true } } },
        })
        const snippet = text.trim().length > 120 ? `${text.trim().slice(0, 120)}…` : text.trim()
        notifyTaskCommented({
          taskId: params.id,
          projectId: task.projectId,
          taskTitle: task.title,
          reporterId: task.reporterId,
          assigneeId: task.assigneeId,
          actorId: auth.userId,
          actorName: comment.author?.name ?? 'Someone',
          commentSnippet: snippet,
        }).catch(() => {})
        return { comment }
      })

      .post('/api/tasks/:id/evidence', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as { kind?: string; url?: string; note?: string }
        if (!body.kind || !body.url) {
          set.status = 400
          return { error: 'kind dan url wajib diisi' }
        }
        const evidence = await prisma.taskEvidence.create({
          data: { taskId: params.id, kind: body.kind, url: body.url, note: body.note ?? null },
        })
        return { evidence }
      })

      .post('/api/tasks/:id/evidence/upload', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const form = await request.formData()
        const file = form.get('file')
        const note = form.get('note')
        if (!(file instanceof File)) {
          set.status = 400
          return { error: 'file wajib diupload (field name: file)' }
        }
        if (file.size === 0) {
          set.status = 400
          return { error: 'File kosong' }
        }
        if (file.size > env.UPLOAD_MAX_BYTES) {
          set.status = 413
          return { error: `File terlalu besar (max ${env.UPLOAD_MAX_BYTES} bytes)` }
        }
        const fs = await import('node:fs/promises')
        const path = await import('node:path')
        const safeDir = path.resolve(env.UPLOADS_DIR, 'evidence', params.id)
        await fs.mkdir(safeDir, { recursive: true })
        const ext = path
          .extname(file.name)
          .slice(0, 12)
          .replace(/[^a-zA-Z0-9.]/g, '')
        const storedName = `${crypto.randomUUID()}${ext}`
        const fullPath = path.join(safeDir, storedName)
        await Bun.write(fullPath, file)
        const mimeKind = file.type.startsWith('image/')
          ? 'SCREENSHOT'
          : file.type.startsWith('text/') || file.type === 'application/json'
            ? 'LOG'
            : 'FILE'
        const displayNote = [
          file.name,
          `${(file.size / 1024).toFixed(1)} KB`,
          file.type || 'unknown',
          note && typeof note === 'string' ? note : null,
        ]
          .filter(Boolean)
          .join(' · ')
        const evidence = await prisma.taskEvidence.create({
          data: {
            taskId: params.id,
            kind: mimeKind,
            url: `/api/evidence/${storedName}?task=${params.id}`,
            note: displayNote,
          },
        })
        audit(auth.userId, 'EVIDENCE_UPLOADED', `task=${params.id} file=${file.name} size=${file.size}`, getIp(request))
        return { evidence }
      })

      .get('/api/evidence/:file', async ({ request, params, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const taskId = typeof query?.task === 'string' ? query.task : null
        if (!taskId) {
          set.status = 400
          return { error: 'task param wajib' }
        }
        const task = await prisma.task.findUnique({ where: { id: taskId }, select: { projectId: true } })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const path = await import('node:path')
        const safeName = params.file.replace(/[^a-zA-Z0-9._-]/g, '')
        const fullPath = path.resolve(env.UPLOADS_DIR, 'evidence', taskId, safeName)
        const rootDir = path.resolve(env.UPLOADS_DIR, 'evidence', taskId)
        if (!fullPath.startsWith(rootDir)) {
          set.status = 400
          return { error: 'Invalid path' }
        }
        const file = Bun.file(fullPath)
        if (!(await file.exists())) {
          set.status = 404
          return { error: 'File not found' }
        }
        return new Response(file)
      })

      // ─── Tags API ─────────────────────────────────────
      .get('/api/projects/:id/tags', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership && auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Not a project member' }
        }
        const tags = await prisma.tag.findMany({
          where: { projectId: params.id },
          orderBy: { name: 'asc' },
        })
        return { tags }
      })

      .post('/api/projects/:id/tags', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const membership = await requireProjectMember(params.id, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as { name?: string; color?: string }
        if (!body.name?.trim()) {
          set.status = 400
          return { error: 'name wajib diisi' }
        }
        const tag = await prisma.tag
          .create({
            data: {
              projectId: params.id,
              name: body.name.trim(),
              color: body.color ?? 'blue',
            },
          })
          .catch((e: unknown) => {
            if ((e as { code?: string }).code === 'P2002') return null
            throw e
          })
        if (!tag) {
          set.status = 409
          return { error: 'Tag with that name already exists' }
        }
        audit(auth.userId, 'TAG_CREATED', `${params.id} ← ${tag.name}`, getIp(request))
        return { tag }
      })

      .patch('/api/tags/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const tag = await prisma.tag.findUnique({ where: { id: params.id } })
        if (!tag) {
          set.status = 404
          return { error: 'Tag not found' }
        }
        const membership = await requireProjectMember(tag.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as { name?: string; color?: string }
        const data: Record<string, unknown> = {}
        if (body.name !== undefined) data.name = body.name.trim()
        if (body.color !== undefined) data.color = body.color
        const updated = await prisma.tag.update({ where: { id: params.id }, data })
        return { tag: updated }
      })

      .delete('/api/tags/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const tag = await prisma.tag.findUnique({ where: { id: params.id } })
        if (!tag) {
          set.status = 404
          return { error: 'Tag not found' }
        }
        const membership = await requireProjectMember(tag.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        await prisma.tag.delete({ where: { id: params.id } })
        audit(auth.userId, 'TAG_DELETED', `${tag.projectId} ← ${tag.name}`, getIp(request))
        return { ok: true }
      })

      // ─── Task dependencies ────────────────────────────
      .post('/api/tasks/:id/dependencies', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as { blockedById?: string }
        if (!body.blockedById) {
          set.status = 400
          return { error: 'blockedById wajib diisi' }
        }
        if (body.blockedById === params.id) {
          set.status = 400
          return { error: 'Task cannot block itself' }
        }
        const blocker = await prisma.task.findUnique({ where: { id: body.blockedById }, select: { projectId: true } })
        if (!blocker || blocker.projectId !== task.projectId) {
          set.status = 400
          return { error: 'Blocker task must be in the same project' }
        }
        // Cycle check: if params.id is transitively blocked by body.blockedById already
        // (i.e. there exists a dep path body.blockedById → ... → params.id), adding the
        // reverse edge would create a cycle. Walk via blockedById and bail if we hit params.id.
        const visited = new Set<string>()
        const queue: string[] = [body.blockedById]
        while (queue.length) {
          const cur = queue.shift() as string
          if (visited.has(cur)) continue
          visited.add(cur)
          if (cur === params.id) {
            set.status = 400
            return { error: 'Dependency would create a cycle' }
          }
          const parents = await prisma.taskDependency.findMany({
            where: { taskId: cur },
            select: { blockedById: true },
          })
          for (const p of parents) queue.push(p.blockedById)
        }
        const dep = await prisma.taskDependency
          .create({ data: { taskId: params.id, blockedById: body.blockedById } })
          .catch((e: unknown) => {
            if ((e as { code?: string }).code === 'P2002') return null
            throw e
          })
        if (!dep) {
          set.status = 409
          return { error: 'Dependency already exists' }
        }
        return { dependency: dep }
      })

      .delete('/api/tasks/:id/dependencies/:blockedById', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        await prisma.taskDependency.delete({
          where: { taskId_blockedById: { taskId: params.id, blockedById: params.blockedById } },
        })
        return { ok: true }
      })

      // ─── Task checklist ───────────────────────────────
      .post('/api/tasks/:id/checklist', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const task = await prisma.task.findUnique({ where: { id: params.id }, select: { projectId: true } })
        if (!task) {
          set.status = 404
          return { error: 'Task not found' }
        }
        const membership = await requireProjectMember(task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as { title?: string }
        if (!body.title?.trim()) {
          set.status = 400
          return { error: 'title wajib diisi' }
        }
        const last = await prisma.taskChecklistItem.findFirst({
          where: { taskId: params.id },
          orderBy: { order: 'desc' },
          select: { order: true },
        })
        const item = await prisma.taskChecklistItem.create({
          data: {
            taskId: params.id,
            title: body.title.trim(),
            order: (last?.order ?? -1) + 1,
          },
        })
        return { item }
      })

      .patch('/api/checklist/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const existing = await prisma.taskChecklistItem.findUnique({
          where: { id: params.id },
          include: { task: { select: { projectId: true } } },
        })
        if (!existing) {
          set.status = 404
          return { error: 'Checklist item not found' }
        }
        const membership = await requireProjectMember(existing.task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        const body = (await request.json()) as { title?: string; done?: boolean; order?: number }
        const data: Record<string, unknown> = {}
        if (body.title !== undefined) data.title = body.title.trim()
        if (body.done !== undefined) data.done = body.done
        if (body.order !== undefined) data.order = body.order
        const item = await prisma.taskChecklistItem.update({ where: { id: params.id }, data })
        return { item }
      })

      .delete('/api/checklist/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const existing = await prisma.taskChecklistItem.findUnique({
          where: { id: params.id },
          include: { task: { select: { projectId: true } } },
        })
        if (!existing) {
          set.status = 404
          return { error: 'Checklist item not found' }
        }
        const membership = await requireProjectMember(existing.task.projectId, auth.userId)
        if (!membership || membership.role === 'VIEWER') {
          set.status = 403
          return { error: 'Not a writable project member' }
        }
        await prisma.taskChecklistItem.delete({ where: { id: params.id } })
        return { ok: true }
      })

      // ─── Activity (pm-watch user-facing) ──────────────
      .get('/api/activity/agents', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN'
        const scopeUserId = isAdmin && query.userId ? String(query.userId) : auth.userId
        const agents = await prisma.agent.findMany({
          where: { claimedById: scopeUserId, status: 'APPROVED' },
          select: {
            id: true,
            agentId: true,
            hostname: true,
            osUser: true,
            lastSeenAt: true,
            claimedBy: { select: { id: true, name: true, email: true } },
            _count: { select: { events: true } },
          },
          orderBy: { lastSeenAt: 'desc' },
        })
        let availableUsers:
          | Array<{ id: string; name: string; email: string; agentCount: number; eventCount: number }>
          | undefined
        if (isAdmin) {
          const grouped = await prisma.agent.groupBy({
            by: ['claimedById'],
            where: { status: 'APPROVED', claimedById: { not: null } },
            _count: { _all: true },
          })
          const userIds = grouped.map((g) => g.claimedById).filter((v): v is string => !!v)
          const users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
          const eventCounts = await prisma.activityEvent.groupBy({
            by: ['agentId'],
            _count: { _all: true },
          })
          const agentUserMap = await prisma.agent.findMany({
            where: { claimedById: { in: userIds } },
            select: { id: true, claimedById: true },
          })
          const eventByUser = new Map<string, number>()
          for (const ec of eventCounts) {
            const au = agentUserMap.find((a) => a.id === ec.agentId)
            if (au?.claimedById) {
              eventByUser.set(au.claimedById, (eventByUser.get(au.claimedById) ?? 0) + ec._count._all)
            }
          }
          availableUsers = users.map((u) => ({
            ...u,
            agentCount: grouped.find((g) => g.claimedById === u.id)?._count._all ?? 0,
            eventCount: eventByUser.get(u.id) ?? 0,
          }))
        }
        return { agents, scopeUserId, availableUsers }
      })

      .get('/api/activity', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN'
        const scopeUserId = isAdmin && query.userId ? String(query.userId) : auth.userId
        const myAgents = await prisma.agent.findMany({
          where: { claimedById: scopeUserId, status: 'APPROVED' },
          select: { id: true },
        })
        const agentIds = myAgents.map((a) => a.id)
        if (agentIds.length === 0) return { events: [], count: 0 }

        const where: Record<string, unknown> = { agentId: { in: agentIds } }
        if (query.agentId && agentIds.includes(String(query.agentId))) where.agentId = String(query.agentId)
        if (query.bucketId) where.bucketId = String(query.bucketId)
        const ts: Record<string, Date> = {}
        if (query.from) ts.gte = new Date(String(query.from))
        if (query.to) ts.lte = new Date(String(query.to))
        if (Object.keys(ts).length > 0) where.timestamp = ts

        const limit = Math.min(Number(query.limit ?? 200), 1000)
        const events = await prisma.activityEvent.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          take: limit,
          include: { agent: { select: { hostname: true, osUser: true } } },
        })
        return { events, count: events.length, limit }
      })

      .get('/api/activity/calendar', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN'
        const scopeUserId = isAdmin && query.userId ? String(query.userId) : auth.userId
        const monthStr = typeof query.month === 'string' ? query.month : ''
        const match = monthStr.match(/^(\d{4})-(\d{2})$/)
        const now = new Date()
        const year = match ? Number(match[1]) : now.getFullYear()
        const month = match ? Number(match[2]) - 1 : now.getMonth()
        const start = new Date(year, month, 1)
        const end = new Date(year, month + 1, 1)

        const myAgents = await prisma.agent.findMany({
          where: { claimedById: scopeUserId, status: 'APPROVED' },
          select: { id: true },
        })
        const agentIds = myAgents.map((a) => a.id)
        if (agentIds.length === 0) {
          return { month: `${year}-${String(month + 1).padStart(2, '0')}`, days: {} }
        }

        const rows = await prisma.$queryRaw<Array<{ day: Date; count: bigint; duration: number }>>`
          SELECT DATE_TRUNC('day', timestamp) AS day,
                 COUNT(*)::bigint AS count,
                 COALESCE(SUM(duration), 0)::float8 AS duration
          FROM activity_event
          WHERE "agentId" = ANY (${agentIds})
            AND timestamp >= ${start}
            AND timestamp < ${end}
          GROUP BY day
          ORDER BY day ASC
        `
        const days: Record<string, { count: number; durationSec: number }> = {}
        for (const r of rows) {
          const d = new Date(r.day)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          days[key] = { count: Number(r.count), durationSec: r.duration }
        }
        return { month: `${year}-${String(month + 1).padStart(2, '0')}`, days }
      })

      .get('/api/activity/heatmap', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN'
        const scopeUserId = isAdmin && query.userId ? String(query.userId) : auth.userId
        const yearStr = typeof query.year === 'string' ? query.year : ''
        const match = yearStr.match(/^\d{4}$/)
        const now = new Date()
        const year = match ? Number(yearStr) : now.getFullYear()
        const start = new Date(year, 0, 1)
        const end = new Date(year + 1, 0, 1)

        const myAgents = await prisma.agent.findMany({
          where: { claimedById: scopeUserId, status: 'APPROVED' },
          select: { id: true },
        })
        const agentIds = myAgents.map((a) => a.id)
        if (agentIds.length === 0) {
          return { year, days: {} }
        }

        const rows = await prisma.$queryRaw<Array<{ day: Date; count: bigint; duration: number }>>`
          SELECT DATE_TRUNC('day', timestamp) AS day,
                 COUNT(*)::bigint AS count,
                 COALESCE(SUM(duration), 0)::float8 AS duration
          FROM activity_event
          WHERE "agentId" = ANY (${agentIds})
            AND timestamp >= ${start}
            AND timestamp < ${end}
          GROUP BY day
          ORDER BY day ASC
        `
        const days: Record<string, { count: number; durationSec: number }> = {}
        for (const r of rows) {
          const d = new Date(r.day)
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          days[key] = { count: Number(r.count), durationSec: r.duration }
        }
        return { year, days }
      })

      .get('/api/activity/summary', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const isAdmin = auth.role === 'ADMIN' || auth.role === 'SUPER_ADMIN'
        const scopeUserId = isAdmin && query.userId ? String(query.userId) : auth.userId
        const myAgents = await prisma.agent.findMany({
          where: { claimedById: scopeUserId, status: 'APPROVED' },
          select: { id: true },
        })
        const agentIds = myAgents.map((a) => a.id)
        if (agentIds.length === 0) {
          return {
            today: { count: 0, durationSec: 0 },
            week: { count: 0, durationSec: 0 },
            topApps: [],
            topTitles: [],
            byBucket: [],
          }
        }

        const now = new Date()
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const windowStart = query.from ? new Date(String(query.from)) : weekAgo
        const windowEnd = query.to ? new Date(String(query.to)) : now

        const [todayAgg, weekAgg, bucketAgg, windowEvents] = await Promise.all([
          prisma.activityEvent.aggregate({
            where: { agentId: { in: agentIds }, timestamp: { gte: startOfDay } },
            _sum: { duration: true },
            _count: { _all: true },
          }),
          prisma.activityEvent.aggregate({
            where: { agentId: { in: agentIds }, timestamp: { gte: weekAgo } },
            _sum: { duration: true },
            _count: { _all: true },
          }),
          prisma.activityEvent.groupBy({
            by: ['bucketId'],
            where: { agentId: { in: agentIds }, timestamp: { gte: windowStart, lte: windowEnd } },
            _sum: { duration: true },
            _count: { _all: true },
          }),
          prisma.activityEvent.findMany({
            where: { agentId: { in: agentIds }, timestamp: { gte: windowStart, lte: windowEnd } },
            select: { duration: true, data: true, bucketId: true },
            take: 5000,
          }),
        ])

        const appTotals = new Map<string, { durationSec: number; count: number }>()
        const titleTotals = new Map<string, { durationSec: number; count: number; app: string }>()
        for (const e of windowEvents) {
          const d = (e.data ?? {}) as Record<string, unknown>
          const app = typeof d.app === 'string' ? d.app : null
          const title = typeof d.title === 'string' ? d.title : null
          if (app) {
            const cur = appTotals.get(app) ?? { durationSec: 0, count: 0 }
            cur.durationSec += e.duration
            cur.count += 1
            appTotals.set(app, cur)
          }
          if (app && title) {
            const key = `${app} :: ${title}`
            const cur = titleTotals.get(key) ?? { durationSec: 0, count: 0, app }
            cur.durationSec += e.duration
            cur.count += 1
            titleTotals.set(key, cur)
          }
        }
        const topApps = [...appTotals.entries()]
          .map(([app, v]) => ({ app, durationSec: v.durationSec, count: v.count }))
          .sort((a, b) => b.durationSec - a.durationSec)
          .slice(0, 10)
        const topTitles = [...titleTotals.entries()]
          .map(([key, v]) => ({
            key,
            app: v.app,
            title: key.slice(v.app.length + 4),
            durationSec: v.durationSec,
            count: v.count,
          }))
          .sort((a, b) => b.durationSec - a.durationSec)
          .slice(0, 10)
        const byBucket = bucketAgg
          .map((b) => ({ bucketId: b.bucketId, durationSec: b._sum.duration ?? 0, count: b._count._all }))
          .sort((a, b) => b.durationSec - a.durationSec)

        return {
          today: { count: todayAgg._count._all, durationSec: todayAgg._sum.duration ?? 0 },
          week: { count: weekAgg._count._all, durationSec: weekAgg._sum.duration ?? 0 },
          window: { from: windowStart.toISOString(), to: windowEnd.toISOString() },
          topApps,
          topTitles,
          byBucket,
        }
      })

      // ─── pm-watch Webhook ─────────────────────────────
      .post('/webhooks/aw', async ({ request, set }) => {
        const ip = getIp(request)
        const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
        const logRequest = (
          statusCode: number,
          reason: string | null,
          tokenId: string | null,
          agentDbId: string | null,
          eventsIn: number,
        ) => {
          prisma.webhookRequestLog
            .create({ data: { statusCode, reason, tokenId, agentId: agentDbId, ip, eventsIn } })
            .catch(() => null)
        }

        if (!env.PMW_WEBHOOK_TOKEN) {
          const anyToken = await prisma.webhookToken.count()
          if (anyToken === 0) {
            logRequest(503, 'unconfigured', null, null, 0)
            set.status = 503
            return { error: 'No webhook token configured' }
          }
        }
        const auth = await verifyWebhookToken(bearer, env.PMW_WEBHOOK_TOKEN)
        if (!auth.ok) {
          appLog('warn', `pm-watch webhook ${auth.reason} from ${ip}`)
          const statusCode = auth.reason === 'unauthorized' ? 401 : 403
          logRequest(statusCode, auth.reason, auth.tokenId, null, 0)
          set.status = statusCode
          return { error: auth.reason === 'unauthorized' ? 'Unauthorized' : `Token ${auth.reason}` }
        }

        let body: {
          agent_id?: string
          hostname?: string
          os_user?: string
          events?: Array<{
            bucket_id?: string
            event_id?: number
            timestamp?: string
            duration?: number
            data?: unknown
          }>
        }
        try {
          body = (await request.json()) as typeof body
        } catch {
          logRequest(400, 'invalid_json', auth.tokenId, null, 0)
          set.status = 400
          return { error: 'Invalid JSON' }
        }

        const { agent_id, hostname, os_user } = body
        if (!agent_id || !hostname || !os_user) {
          logRequest(400, 'missing_fields', auth.tokenId, null, 0)
          set.status = 400
          return { error: 'agent_id, hostname, os_user wajib diisi' }
        }
        if (!Array.isArray(body.events)) {
          logRequest(400, 'events_not_array', auth.tokenId, null, 0)
          set.status = 400
          return { error: 'events harus array' }
        }
        if (body.events.length > env.PMW_EVENT_BATCH_MAX) {
          logRequest(413, 'batch_too_large', auth.tokenId, null, body.events.length)
          set.status = 413
          return { error: `Batch terlalu besar (max ${env.PMW_EVENT_BATCH_MAX})` }
        }

        const now = new Date()
        const agent = await prisma.agent.upsert({
          where: { agentId: agent_id },
          update: { hostname, osUser: os_user, lastSeenAt: now },
          create: { agentId: agent_id, hostname, osUser: os_user, lastSeenAt: now },
        })

        if (agent.status === 'REVOKED') {
          appLog('warn', `pm-watch events from REVOKED agent ${agent_id} rejected`)
          logRequest(403, 'agent_revoked', auth.tokenId, agent.id, body.events.length)
          set.status = 403
          return { error: 'Agent revoked' }
        }

        if (agent.status === 'PENDING') {
          appLog(
            'info',
            `pm-watch events from PENDING agent ${agent_id} dropped (awaiting approval): received=${body.events.length}`,
          )
          logRequest(202, 'agent_pending', auth.tokenId, agent.id, body.events.length)
          set.status = 202
          return {
            ok: true,
            agent: { id: agent.id, status: agent.status, claimed: false },
            received: body.events.length,
            inserted: 0,
            skipped: body.events.length,
            reason: 'agent_pending',
          }
        }

        const rows = body.events.flatMap((e) => {
          if (!e.bucket_id || typeof e.event_id !== 'number' || !e.timestamp || typeof e.duration !== 'number')
            return []
          const ts = new Date(e.timestamp)
          if (Number.isNaN(ts.getTime())) return []
          return [
            {
              agentId: agent.id,
              bucketId: e.bucket_id,
              eventId: e.event_id,
              timestamp: ts,
              duration: e.duration,
              data: (e.data ?? {}) as object,
            },
          ]
        })

        let inserted = 0
        if (rows.length > 0) {
          const { count } = await prisma.activityEvent.createMany({ data: rows, skipDuplicates: true })
          inserted = count
        }

        appLog(
          'info',
          `pm-watch /webhooks/aw ${agent_id} host=${hostname} received=${body.events.length} inserted=${inserted} status=${agent.status}`,
        )
        logRequest(200, null, auth.tokenId, agent.id, body.events.length)

        return {
          ok: true,
          agent: { id: agent.id, status: agent.status, claimed: !!agent.claimedById },
          received: body.events.length,
          inserted,
          skipped: body.events.length - inserted,
        }
      })

      // ─── GitHub Webhook ───────────────────────────────
      .post('/webhooks/github', async ({ request, set }) => {
        const ip = getIp(request)
        const deliveryId = request.headers.get('x-github-delivery')
        const event = request.headers.get('x-github-event') ?? 'unknown'
        const signature = request.headers.get('x-hub-signature-256')

        const logRequest = (statusCode: number, reason: string | null, projectId: string | null, eventsIn: number) => {
          prisma.githubWebhookLog
            .create({ data: { statusCode, reason, projectId, deliveryId, event, ip, eventsIn } })
            .catch(() => null)
        }

        if (!env.GITHUB_WEBHOOK_SECRET) {
          logRequest(503, 'unconfigured', null, 0)
          set.status = 503
          return { error: 'GitHub webhook not configured' }
        }

        const rawBody = await request.text()
        if (!verifyGithubSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET)) {
          logRequest(401, 'bad_signature', null, 0)
          set.status = 401
          return { error: 'Invalid signature' }
        }

        if (event === 'ping') {
          logRequest(200, 'ping', null, 0)
          return { ok: true, pong: true }
        }

        let payload: Record<string, unknown>
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          logRequest(400, 'invalid_json', null, 0)
          set.status = 400
          return { error: 'Invalid JSON' }
        }

        const repo = payload.repository as { full_name?: string; html_url?: string } | undefined
        const repoFullName = repo?.full_name ? normalizeGithubRepo(repo.full_name) : null
        if (!repoFullName) {
          logRequest(400, 'missing_repo', null, 0)
          set.status = 400
          return { error: 'Missing repository.full_name' }
        }

        const project = await prisma.project.findUnique({ where: { githubRepo: repoFullName } })
        if (!project) {
          logRequest(404, 'project_not_linked', null, 0)
          set.status = 404
          return { error: `No project linked to ${repoFullName}` }
        }

        type EventRow = {
          projectId: string
          kind: 'PUSH_COMMIT' | 'PR_OPENED' | 'PR_CLOSED' | 'PR_MERGED' | 'PR_REVIEWED'
          actorLogin: string
          actorEmail: string | null
          matchedUserId: string | null
          title: string
          url: string
          sha: string | null
          prNumber: number | null
          metadata: object | null
          createdAt: Date
        }
        const rows: EventRow[] = []

        if (event === 'push') {
          const commits = (payload.commits as Array<Record<string, unknown>>) ?? []
          const pusher = payload.pusher as { name?: string; email?: string } | undefined
          for (const c of commits) {
            const id = typeof c.id === 'string' ? c.id : null
            if (!id) continue
            const author = c.author as { name?: string; email?: string; username?: string } | undefined
            const message = typeof c.message === 'string' ? c.message : ''
            const timestamp = typeof c.timestamp === 'string' ? new Date(c.timestamp) : new Date()
            const url = typeof c.url === 'string' ? c.url : `https://github.com/${repoFullName}/commit/${id}`
            rows.push({
              projectId: project.id,
              kind: 'PUSH_COMMIT',
              actorLogin: author?.username ?? author?.name ?? pusher?.name ?? 'unknown',
              actorEmail: author?.email ?? pusher?.email ?? null,
              matchedUserId: null,
              title: message.split('\n')[0].slice(0, 500),
              url,
              sha: id,
              prNumber: null,
              metadata: {
                ref: payload.ref ?? null,
                added: c.added ?? [],
                removed: c.removed ?? [],
                modified: c.modified ?? [],
              },
              createdAt: Number.isNaN(timestamp.getTime()) ? new Date() : timestamp,
            })
          }
        } else if (event === 'pull_request') {
          const action = typeof payload.action === 'string' ? payload.action : ''
          const pr = payload.pull_request as
            | {
                number?: number
                title?: string
                html_url?: string
                merged?: boolean
                user?: { login?: string }
                merged_at?: string | null
                closed_at?: string | null
                created_at?: string
              }
            | undefined
          const kind: EventRow['kind'] | null =
            action === 'opened' || action === 'reopened'
              ? 'PR_OPENED'
              : action === 'closed'
                ? pr?.merged
                  ? 'PR_MERGED'
                  : 'PR_CLOSED'
                : null
          if (kind && pr?.number != null) {
            const ts =
              kind === 'PR_MERGED' && pr.merged_at
                ? new Date(pr.merged_at)
                : kind === 'PR_CLOSED' && pr.closed_at
                  ? new Date(pr.closed_at)
                  : pr.created_at
                    ? new Date(pr.created_at)
                    : new Date()
            rows.push({
              projectId: project.id,
              kind,
              actorLogin: pr.user?.login ?? 'unknown',
              actorEmail: null,
              matchedUserId: null,
              title: (pr.title ?? '').slice(0, 500),
              url: pr.html_url ?? `https://github.com/${repoFullName}/pull/${pr.number}`,
              sha: null,
              prNumber: pr.number,
              metadata: { action, merged: pr.merged ?? false },
              createdAt: Number.isNaN(ts.getTime()) ? new Date() : ts,
            })
          }
        } else if (event === 'pull_request_review') {
          const pr = payload.pull_request as { number?: number; html_url?: string; title?: string } | undefined
          const review = payload.review as
            | { state?: string; user?: { login?: string }; submitted_at?: string }
            | undefined
          if (pr?.number != null && review) {
            const ts = review.submitted_at ? new Date(review.submitted_at) : new Date()
            rows.push({
              projectId: project.id,
              kind: 'PR_REVIEWED',
              actorLogin: review.user?.login ?? 'unknown',
              actorEmail: null,
              matchedUserId: null,
              title: `${review.state ?? 'reviewed'}: ${(pr.title ?? '').slice(0, 480)}`,
              url: pr.html_url ?? `https://github.com/${repoFullName}/pull/${pr.number}`,
              sha: null,
              prNumber: pr.number,
              metadata: { state: review.state ?? null },
              createdAt: Number.isNaN(ts.getTime()) ? new Date() : ts,
            })
          }
        }

        let inserted = 0
        if (rows.length > 0) {
          const emails = [...new Set(rows.map((r) => r.actorEmail).filter((e): e is string => !!e))]
          const users = emails.length
            ? await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } })
            : []
          const emailToUser = new Map(users.map((u) => [u.email.toLowerCase(), u.id]))
          for (const r of rows) {
            if (r.actorEmail) r.matchedUserId = emailToUser.get(r.actorEmail.toLowerCase()) ?? null
          }

          // Postgres treats NULL prNumber as distinct on the unique index, so `skipDuplicates`
          // misses PUSH_COMMIT replays. Pre-filter against existing (projectId, sha) pairs.
          const pushShas = rows.filter((r) => r.kind === 'PUSH_COMMIT' && r.sha).map((r) => r.sha as string)
          const existingShas = pushShas.length
            ? new Set(
                (
                  await prisma.projectGithubEvent.findMany({
                    where: { projectId: project.id, kind: 'PUSH_COMMIT', sha: { in: pushShas } },
                    select: { sha: true },
                  })
                )
                  .map((r) => r.sha)
                  .filter((s): s is string => !!s),
              )
            : new Set<string>()
          const dedupedRows = rows.filter((r) => {
            if (r.kind !== 'PUSH_COMMIT' || !r.sha) return true
            return !existingShas.has(r.sha)
          })

          if (dedupedRows.length > 0) {
            const { count } = await prisma.projectGithubEvent.createMany({
              data: dedupedRows.map((r) => ({
                projectId: r.projectId,
                kind: r.kind,
                actorLogin: r.actorLogin,
                actorEmail: r.actorEmail,
                matchedUserId: r.matchedUserId,
                title: r.title,
                url: r.url,
                sha: r.sha,
                prNumber: r.prNumber,
                metadata: r.metadata ?? undefined,
                createdAt: r.createdAt,
              })),
              skipDuplicates: true,
            })
            inserted = count
          }
        }

        appLog(
          'info',
          `github webhook event=${event} repo=${repoFullName} project=${project.id} received=${rows.length} inserted=${inserted}`,
        )
        logRequest(200, rows.length === 0 ? 'ignored_event' : null, project.id, rows.length)

        return { ok: true, event, received: rows.length, inserted }
      })

      // ─── My Agents API (any authenticated user) ────────
      .get('/api/me/agents', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const agents = await prisma.agent.findMany({
          where: { claimedById: auth.userId, status: 'APPROVED' },
          select: {
            id: true,
            agentId: true,
            hostname: true,
            osUser: true,
            status: true,
            lastSeenAt: true,
            createdAt: true,
            _count: { select: { events: true } },
          },
          orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        })
        return { agents }
      })

      // ─── Notifications API (authenticated user) ────────
      .get('/api/me/notifications', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const limitRaw = Number(query?.limit ?? 50)
        const limit = Math.min(200, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50))
        const onlyUnread = query?.unread === '1' || query?.unread === 'true'
        const notifications = await prisma.notification.findMany({
          where: { recipientId: auth.userId, ...(onlyUnread ? { readAt: null } : {}) },
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        const unreadCount = await prisma.notification.count({
          where: { recipientId: auth.userId, readAt: null },
        })
        return { notifications, unreadCount }
      })

      .get('/api/me/notifications/unread-count', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const unreadCount = await prisma.notification.count({
          where: { recipientId: auth.userId, readAt: null },
        })
        return { unreadCount }
      })

      .post('/api/me/notifications/:id/read', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const n = await prisma.notification.findUnique({ where: { id: params.id } })
        if (!n || n.recipientId !== auth.userId) {
          set.status = 404
          return { error: 'Notification not found' }
        }
        if (n.readAt) return { notification: n }
        const notification = await prisma.notification.update({
          where: { id: params.id },
          data: { readAt: new Date() },
        })
        return { notification }
      })

      .post('/api/me/notifications/read-all', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const result = await prisma.notification.updateMany({
          where: { recipientId: auth.userId, readAt: null },
          data: { readAt: new Date() },
        })
        return { updated: result.count }
      })

      .delete('/api/me/notifications/:id', async ({ request, params, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        const n = await prisma.notification.findUnique({ where: { id: params.id } })
        if (!n || n.recipientId !== auth.userId) {
          set.status = 404
          return { error: 'Notification not found' }
        }
        await prisma.notification.delete({ where: { id: params.id } })
        return { ok: true }
      })

      // ─── Admin Agents API (SUPER_ADMIN only) ───────────
      .get('/api/admin/agents', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (!isSystemAdmin(auth.role)) {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const agents = await prisma.agent.findMany({
          include: {
            claimedBy: { select: { id: true, name: true, email: true, role: true } },
            _count: { select: { events: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
        return { agents }
      })

      .post('/api/admin/agents/:id/approve', async ({ request, params, set }) => {
        const ip = getIp(request)
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const { userId } = (await request.json()) as { userId?: string }
        if (!userId) {
          set.status = 400
          return { error: 'userId wajib diisi' }
        }
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } })
        if (!user) {
          set.status = 404
          return { error: 'User tidak ditemukan' }
        }
        const existing = await prisma.agent.findUnique({ where: { id: params.id }, select: { id: true } })
        if (!existing) {
          set.status = 404
          return { error: 'Agent tidak ditemukan' }
        }
        const agent = await prisma.agent.update({
          where: { id: params.id },
          data: { status: 'APPROVED', claimedById: user.id },
          include: {
            claimedBy: { select: { id: true, name: true, email: true, role: true } },
            _count: { select: { events: true } },
          },
        })
        audit(auth.userId, 'AGENT_APPROVED', `agent=${agent.agentId} → ${user.email}`, ip)
        appLog('info', `Agent approved: ${agent.agentId} → ${user.email}`)
        return { agent }
      })

      .post('/api/admin/agents/:id/revoke', async ({ request, params, set }) => {
        const ip = getIp(request)
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const existing = await prisma.agent.findUnique({ where: { id: params.id }, select: { id: true } })
        if (!existing) {
          set.status = 404
          return { error: 'Agent tidak ditemukan' }
        }
        const agent = await prisma.agent.update({
          where: { id: params.id },
          data: { status: 'REVOKED', claimedById: null },
          include: {
            claimedBy: { select: { id: true, name: true, email: true, role: true } },
            _count: { select: { events: true } },
          },
        })
        audit(auth.userId, 'AGENT_REVOKED', `agent=${agent.agentId}`, ip)
        appLog('info', `Agent revoked: ${agent.agentId}`)
        return { agent }
      })

      // ─── Admin Webhook Tokens API (SUPER_ADMIN only) ──
      .get('/api/admin/webhook-tokens', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const tokens = await prisma.webhookToken.findMany({
          include: { createdBy: { select: { id: true, name: true, email: true } } },
          orderBy: { createdAt: 'desc' },
        })
        return {
          tokens: tokens.map((t) => ({
            id: t.id,
            name: t.name,
            tokenPrefix: t.tokenPrefix,
            status: t.status,
            expiresAt: t.expiresAt,
            lastUsedAt: t.lastUsedAt,
            createdBy: t.createdBy,
            createdAt: t.createdAt,
          })),
          envFallback: !!env.PMW_WEBHOOK_TOKEN,
        }
      })
      .post('/api/admin/webhook-tokens', async ({ request, set }) => {
        const ip = getIp(request)
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        let body: { name?: string; expiresAt?: string | null }
        try {
          body = (await request.json()) as typeof body
        } catch {
          set.status = 400
          return { error: 'Invalid JSON' }
        }
        const name = (body.name ?? '').trim()
        if (!name) {
          set.status = 400
          return { error: 'name wajib diisi' }
        }
        let expiresAt: Date | null = null
        if (body.expiresAt) {
          const d = new Date(body.expiresAt)
          if (Number.isNaN(d.getTime())) {
            set.status = 400
            return { error: 'expiresAt invalid' }
          }
          expiresAt = d
        }
        const { raw, hash, prefix } = generateWebhookToken()
        const token = await prisma.webhookToken.create({
          data: {
            name,
            tokenHash: hash,
            tokenPrefix: prefix,
            expiresAt,
            createdById: auth.userId,
          },
        })
        audit(auth.userId, 'WEBHOOK_TOKEN_CREATED', `token=${name} prefix=${prefix}`, ip)
        appLog('info', `Webhook token created: ${name} (${prefix})`)
        return {
          token: {
            id: token.id,
            name: token.name,
            tokenPrefix: token.tokenPrefix,
            status: token.status,
            expiresAt: token.expiresAt,
            createdAt: token.createdAt,
          },
          raw,
        }
      })
      .patch('/api/admin/webhook-tokens/:id', async ({ request, params, set }) => {
        const ip = getIp(request)
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        let body: { status?: 'ACTIVE' | 'DISABLED' | 'REVOKED'; name?: string }
        try {
          body = (await request.json()) as typeof body
        } catch {
          set.status = 400
          return { error: 'Invalid JSON' }
        }
        const data: { status?: 'ACTIVE' | 'DISABLED' | 'REVOKED'; name?: string } = {}
        if (body.status !== undefined) {
          if (!['ACTIVE', 'DISABLED', 'REVOKED'].includes(body.status)) {
            set.status = 400
            return { error: 'status must be ACTIVE | DISABLED | REVOKED' }
          }
          data.status = body.status
        }
        if (body.name !== undefined) {
          const trimmed = body.name.trim()
          if (!trimmed) {
            set.status = 400
            return { error: 'name tidak boleh kosong' }
          }
          data.name = trimmed
        }
        if (Object.keys(data).length === 0) {
          set.status = 400
          return { error: 'Provide status and/or name' }
        }
        const existing = await prisma.webhookToken.findUnique({ where: { id: params.id } })
        if (!existing) {
          set.status = 404
          return { error: 'Token not found' }
        }
        if (data.status && existing.status === 'REVOKED') {
          set.status = 400
          return { error: 'Revoked tokens cannot be reactivated' }
        }
        const updated = await prisma.webhookToken.update({
          where: { id: params.id },
          data,
          include: { createdBy: { select: { id: true, name: true, email: true } } },
        })
        const auditAction = data.status ? `WEBHOOK_TOKEN_${data.status}` : 'WEBHOOK_TOKEN_RENAMED'
        audit(auth.userId, auditAction, `token=${updated.name} prefix=${updated.tokenPrefix}`, ip)
        appLog('info', `Webhook token ${auditAction}: ${updated.name} (${updated.tokenPrefix})`)
        return {
          token: {
            id: updated.id,
            name: updated.name,
            tokenPrefix: updated.tokenPrefix,
            status: updated.status,
            expiresAt: updated.expiresAt,
            lastUsedAt: updated.lastUsedAt,
            createdBy: updated.createdBy,
            createdAt: updated.createdAt,
          },
        }
      })
      .delete('/api/admin/webhook-tokens/:id', async ({ request, params, set }) => {
        const ip = getIp(request)
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const existing = await prisma.webhookToken.findUnique({ where: { id: params.id } })
        if (!existing) {
          set.status = 404
          return { error: 'Token not found' }
        }
        const token = await prisma.webhookToken.delete({ where: { id: params.id } })
        audit(auth.userId, 'WEBHOOK_TOKEN_DELETED', `token=${token.name} prefix=${token.tokenPrefix}`, ip)
        appLog('info', `Webhook token deleted: ${token.name} (${token.tokenPrefix})`)
        return { ok: true }
      })

      // ─── Webhook Monitor API (SUPER_ADMIN only) ────────
      .get('/api/admin/webhooks/stats', async ({ request, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const now = Date.now()
        const last24h = new Date(now - 24 * 60 * 60 * 1000)
        const last7d = new Date(now - 7 * 24 * 60 * 60 * 1000)

        const [total24h, total7d, okCount24h, failCount24h, authFail24h, rows24h, byToken, byAgent] = await Promise.all(
          [
            prisma.webhookRequestLog.count({ where: { createdAt: { gte: last24h } } }),
            prisma.webhookRequestLog.count({ where: { createdAt: { gte: last7d } } }),
            prisma.webhookRequestLog.count({ where: { createdAt: { gte: last24h }, statusCode: 200 } }),
            prisma.webhookRequestLog.count({ where: { createdAt: { gte: last24h }, statusCode: { gte: 400 } } }),
            prisma.webhookRequestLog.count({
              where: { createdAt: { gte: last24h }, statusCode: { in: [401, 403] } },
            }),
            prisma.webhookRequestLog.aggregate({
              where: { createdAt: { gte: last24h }, statusCode: 200 },
              _sum: { eventsIn: true },
            }),
            prisma.webhookRequestLog.groupBy({
              by: ['tokenId'],
              where: { createdAt: { gte: last7d } },
              _count: { _all: true },
            }),
            prisma.webhookRequestLog.groupBy({
              by: ['agentId'],
              where: { createdAt: { gte: last7d }, agentId: { not: null } },
              _count: { _all: true },
            }),
          ],
        )

        const tokenIds = byToken.map((b) => b.tokenId).filter((x): x is string => !!x)
        const agentIds = byAgent.map((b) => b.agentId).filter((x): x is string => !!x)
        const [tokens, agents, seriesRows] = await Promise.all([
          tokenIds.length
            ? prisma.webhookToken.findMany({
                where: { id: { in: tokenIds } },
                select: { id: true, name: true, tokenPrefix: true, status: true, lastUsedAt: true },
              })
            : [],
          agentIds.length
            ? prisma.agent.findMany({
                where: { id: { in: agentIds } },
                select: { id: true, agentId: true, hostname: true, status: true, lastSeenAt: true },
              })
            : [],
          prisma.webhookRequestLog.findMany({
            where: { createdAt: { gte: last24h } },
            select: { createdAt: true, statusCode: true, eventsIn: true },
            orderBy: { createdAt: 'asc' },
          }),
        ])
        const tokenMap = new Map(tokens.map((t) => [t.id, t]))
        const agentMap = new Map(agents.map((a) => [a.id, a]))

        const buckets: { t: string; total: number; ok: number; fail: number; authFail: number; events: number }[] = []
        const bucketIdx = new Map<number, number>()
        const hourMs = 60 * 60 * 1000
        const firstHour = Math.floor((now - 23 * hourMs) / hourMs) * hourMs
        for (let i = 0; i < 24; i++) {
          const t = firstHour + i * hourMs
          bucketIdx.set(t, buckets.length)
          buckets.push({ t: new Date(t).toISOString(), total: 0, ok: 0, fail: 0, authFail: 0, events: 0 })
        }
        for (const r of seriesRows) {
          const slot = Math.floor(r.createdAt.getTime() / hourMs) * hourMs
          const idx = bucketIdx.get(slot)
          if (idx === undefined) continue
          const b = buckets[idx]
          b.total += 1
          if (r.statusCode === 200) {
            b.ok += 1
            b.events += r.eventsIn
          } else if (r.statusCode === 401 || r.statusCode === 403) {
            b.authFail += 1
            b.fail += 1
          } else if (r.statusCode >= 400) {
            b.fail += 1
          }
        }

        return {
          series: buckets,
          summary: {
            total24h,
            total7d,
            ok24h: okCount24h,
            fail24h: failCount24h,
            authFail24h,
            eventsIn24h: rows24h._sum.eventsIn ?? 0,
            successRate24h: total24h ? okCount24h / total24h : null,
          },
          perToken: byToken
            .map((b) => ({
              tokenId: b.tokenId,
              token: b.tokenId ? (tokenMap.get(b.tokenId) ?? null) : null,
              hits: b._count._all,
            }))
            .sort((a, b) => b.hits - a.hits),
          perAgent: byAgent
            .map((b) => ({
              agentDbId: b.agentId,
              agent: b.agentId ? (agentMap.get(b.agentId) ?? null) : null,
              hits: b._count._all,
            }))
            .sort((a, b) => b.hits - a.hits),
        }
      })
      .get('/api/admin/webhooks/logs', async ({ request, query, set }) => {
        const auth = await requireAuth(request)
        if (!auth) {
          set.status = 401
          return { error: 'Unauthorized' }
        }
        if (auth.role !== 'SUPER_ADMIN') {
          set.status = 403
          return { error: 'Forbidden' }
        }
        const status = typeof query.status === 'string' ? query.status : 'all'
        const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500)
        const where: Record<string, unknown> = {}
        if (status === 'ok') where.statusCode = 200
        else if (status === 'fail') where.statusCode = { gte: 400 }
        else if (status === 'auth') where.statusCode = { in: [401, 403] }
        const logs = await prisma.webhookRequestLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: limit,
          include: {
            token: { select: { id: true, name: true, tokenPrefix: true } },
            agent: { select: { id: true, agentId: true, hostname: true } },
          },
        })
        return { logs }
      })

      // ─── MCP over HTTP ────────────────────────────────
      .all('/mcp', async ({ request }) => {
        if (!env.MCP_SECRET && !env.MCP_SECRET_ADMIN) {
          return new Response(JSON.stringify({ error: 'MCP not configured: set MCP_SECRET and/or MCP_SECRET_ADMIN' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        }
        const header = request.headers.get('authorization') ?? ''
        const bearer = header.replace(/^Bearer\s+/i, '').trim()
        const provided = bearer || request.headers.get('x-mcp-secret') || ''
        let scope: McpScope | null = null
        if (env.MCP_SECRET_ADMIN && provided === env.MCP_SECRET_ADMIN) scope = 'admin'
        else if (env.MCP_SECRET && provided === env.MCP_SECRET) scope = 'readonly'
        if (!scope) {
          appLog('warn', `MCP unauthorized from ${getIp(request)}`)
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' },
          })
        }
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        })
        const mcp = createMcpServer(scope)
        await mcp.connect(transport)
        const response = await transport.handleRequest(request)
        response.headers.set('x-mcp-server', 'pm-dashboard')
        response.headers.set('x-mcp-scope', scope)
        return response
      })

      // ─── Example API ───────────────────────────────────
      .get('/api/hello', () => ({
        message: 'Hello, world!',
        method: 'GET',
      }))
      .put('/api/hello', () => ({
        message: 'Hello, world!',
        method: 'PUT',
      }))
      .get('/api/hello/:name', ({ params }) => ({
        message: `Hello, ${params.name}!`,
      }))
  )
}
