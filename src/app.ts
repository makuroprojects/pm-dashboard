import { cors } from '@elysiajs/cors'
import { html } from '@elysiajs/html'
import { Elysia } from 'elysia'
import { appLog, clearAppLogs, getAppLogs } from './lib/applog'
import { prisma } from './lib/db'
import { env } from './lib/env'
import { addConnection, getOnlineUserIds, removeConnection } from './lib/presence'

function getIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown'
}

function audit(userId: string | null, action: string, detail: string | null, ip: string) {
  prisma.auditLog.create({ data: { userId, action, detail, ip } }).catch(() => {})
}

export function createApp() {
  appLog('info', 'Server starting')

  return new Elysia()
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
      appLog('error', `${request.method} ${url.pathname} — ${error.message}`)
      console.error('[Server Error]', error)
      return new Response(JSON.stringify({ error: 'Internal Server Error', status: 500 }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    // ─── Request logging ────────────────────────────
    .onAfterResponse(({ request, set }) => {
      const url = new URL(request.url)
      if (url.pathname.startsWith('/api/')) {
        const status = typeof set.status === 'number' ? set.status : 200
        const level = status >= 500 ? 'error' as const : status >= 400 ? 'warn' as const : 'info' as const
        appLog(level, `${request.method} ${url.pathname} ${status}`)
      }
    })

    // API routes
    .get('/health', () => ({ status: 'ok' }))

    // ─── Auth API ──────────────────────────────────────
    .post('/api/auth/login', async ({ request, set }) => {
      const ip = getIp(request)
      const { email, password } = (await request.json()) as { email: string; password: string }
      let user = await prisma.user.findUnique({ where: { email } })
      if (!user || !(await Bun.password.verify(password, user.password))) {
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
      const token = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
      await prisma.session.create({ data: { token, userId: user.id, expiresAt } })
      set.headers['set-cookie'] = `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
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
      set.headers['set-cookie'] = 'session=; Path=/; HttpOnly; Max-Age=0'
      return { ok: true }
    })

    .get('/api/auth/session', async ({ request, set }) => {
      const cookie = request.headers.get('cookie') ?? ''
      const token = cookie.match(/session=([^;]+)/)?.[1]
      if (!token) { set.status = 401; return { user: null } }
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
      set.status = 302; set.headers['location'] =`https://accounts.google.com/o/oauth2/v2/auth?${params}`
    })

    .get('/api/auth/callback/google', async ({ request, set }) => {
      const ip = getIp(request)
      const url = new URL(request.url)
      const code = url.searchParams.get('code')
      const origin = url.origin

      if (!code) {
        set.status = 302; set.headers['location'] ='/login?error=google_failed'
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
        set.status = 302; set.headers['location'] ='/login?error=google_failed'
        return
      }

      const tokens = (await tokenRes.json()) as { access_token: string }

      // Get user info
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      })

      if (!userInfoRes.ok) {
        appLog('warn', 'Google OAuth userinfo fetch failed', ip)
        set.status = 302; set.headers['location'] ='/login?error=google_failed'
        return
      }

      const googleUser = (await userInfoRes.json()) as { email: string; name: string }

      // Upsert user (no password for Google users)
      const isSuperAdmin = env.SUPER_ADMIN_EMAILS.includes(googleUser.email)
      const user = await prisma.user.upsert({
        where: { email: googleUser.email },
        update: { name: googleUser.name, ...(isSuperAdmin ? { role: 'SUPER_ADMIN' } : {}) },
        create: { email: googleUser.email, name: googleUser.name, password: '', role: isSuperAdmin ? 'SUPER_ADMIN' : 'USER' },
      })

      // Create session
      const token = crypto.randomUUID()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      await prisma.session.create({ data: { token, userId: user.id, expiresAt } })

      set.headers['set-cookie'] = `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`
      audit(user.id, 'LOGIN', 'via Google OAuth', ip)
      appLog('info', `Login (Google): ${googleUser.email} (${user.role})`, ip)
      const defaultRoute = user.role === 'SUPER_ADMIN' ? '/dev' : user.role === 'ADMIN' ? '/dashboard' : '/profile'
      set.status = 302; set.headers['location'] = defaultRoute
    })

    // ─── Admin API (SUPER_ADMIN only) ───────────────────
    .get('/api/admin/users', async ({ request, set }) => {
      const cookie = request.headers.get('cookie') ?? ''
      const token = cookie.match(/session=([^;]+)/)?.[1]
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
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
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { id: true, role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
      }
      if (session.user.id === params.id) {
        set.status = 400; return { error: 'Tidak bisa mengubah role sendiri' }
      }
      const { role } = (await request.json()) as { role: string }
      if (!['USER', 'ADMIN'].includes(role)) {
        set.status = 400; return { error: 'Role tidak valid (USER atau ADMIN)' }
      }
      const target = await prisma.user.findUnique({ where: { id: params.id }, select: { email: true, role: true } })
      const user = await prisma.user.update({
        where: { id: params.id },
        data: { role: role as 'USER' | 'ADMIN' },
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
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { id: true, role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
      }
      if (session.user.id === params.id) {
        set.status = 400; return { error: 'Tidak bisa memblokir diri sendiri' }
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
        if (!token) { ws.close(4001, 'Unauthorized'); return }
        const session = await prisma.session.findUnique({
          where: { token },
          include: { user: { select: { id: true, role: true } } },
        })
        if (!session || session.expiresAt < new Date()) { ws.close(4001, 'Unauthorized'); return }

        const isAdmin = session.user.role === 'SUPER_ADMIN' || session.user.role === 'ADMIN'
        ws.data.userId = session.user.id
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
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
      }
      return { online: getOnlineUserIds() }
    })

    // ─── Log API (SUPER_ADMIN only) ────────────────────
    .get('/api/admin/logs/app', async ({ request, set }) => {
      const cookie = request.headers.get('cookie') ?? ''
      const token = cookie.match(/session=([^;]+)/)?.[1]
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
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
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
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
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
      }
      await clearAppLogs()
      appLog('info', 'App logs cleared manually')
      return { ok: true }
    })

    .delete('/api/admin/logs/audit', async ({ request, set }) => {
      const cookie = request.headers.get('cookie') ?? ''
      const token = cookie.match(/session=([^;]+)/)?.[1]
      if (!token) { set.status = 401; return { error: 'Unauthorized' } }
      const session = await prisma.session.findUnique({
        where: { token },
        include: { user: { select: { id: true, role: true } } },
      })
      if (!session || session.expiresAt < new Date() || session.user.role !== 'SUPER_ADMIN') {
        set.status = 403; return { error: 'Forbidden' }
      }
      const { count } = await prisma.auditLog.deleteMany()
      appLog('info', `Audit logs cleared manually (${count} entries)`)
      return { ok: true, deleted: count }
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
}
