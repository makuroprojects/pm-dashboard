/// <reference types="bun-types" />

import fs from 'node:fs'
import path from 'node:path'
import { env } from './lib/env'

const isProduction = env.NODE_ENV === 'production'

// ─── Route Classification ──────────────────────────────
const API_PREFIXES = ['/api/', '/webhook/', '/webhooks/', '/ws/', '/health', '/mcp']

function isApiRoute(pathname: string): boolean {
  return API_PREFIXES.some((p) => pathname.startsWith(p)) || pathname === '/health'
}

// ─── Vite Dev Server (dev only) ────────────────────────
let vite: Awaited<ReturnType<typeof import('./vite').createVite>> | null = null
if (!isProduction) {
  const { createVite } = await import('./vite')
  vite = await createVite()
}

// ─── Frontend Serving ──────────────────────────────────
async function serveFrontend(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname

  if (!isProduction && vite) {
    // === DEVELOPMENT: Vite Middleware Mode ===

    // SPA route → serve index.html via Vite transform
    if (
      pathname === '/' ||
      (!pathname.includes('.') && !pathname.startsWith('/@') && !pathname.startsWith('/__open-stack-frame-in-editor'))
    ) {
      const htmlPath = path.resolve('index.html')
      let htmlContent = fs.readFileSync(htmlPath, 'utf-8')
      htmlContent = await vite.transformIndexHtml(pathname, htmlContent)

      // Dedupe: Vite 8 middlewareMode injects react-refresh preamble twice
      const preamble =
        '<script type="module">import { injectIntoGlobalHook } from "/@react-refresh";\ninjectIntoGlobalHook(window);\nwindow.$RefreshReg$ = () => {};\nwindow.$RefreshSig$ = () => (type) => type;</script>'
      const firstIdx = htmlContent.indexOf(preamble)
      if (firstIdx !== -1) {
        const secondIdx = htmlContent.indexOf(preamble, firstIdx + preamble.length)
        if (secondIdx !== -1) {
          htmlContent = htmlContent.slice(0, secondIdx) + htmlContent.slice(secondIdx + preamble.length)
        }
      }

      return new Response(htmlContent, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    // Asset/module requests → proxy ke Vite middleware
    // Bridge: Bun Request → Node.js IncomingMessage/ServerResponse
    return new Promise<Response>((resolve) => {
      const req = new Proxy(request, {
        get(target, prop) {
          if (prop === 'url') return pathname + url.search
          if (prop === 'method') return request.method
          if (prop === 'headers') return Object.fromEntries(request.headers as any)
          return (target as any)[prop]
        },
      }) as any

      const chunks: (Buffer | Uint8Array)[] = []
      const res = {
        statusCode: 200,
        headers: {} as Record<string, string>,
        setHeader(name: string, value: string) {
          this.headers[name.toLowerCase()] = value
          return this
        },
        getHeader(name: string) {
          return this.headers[name.toLowerCase()]
        },
        removeHeader(name: string) {
          delete this.headers[name.toLowerCase()]
        },
        writeHead(
          code: number,
          reasonOrHeaders?: string | Record<string, string>,
          maybeHeaders?: Record<string, string>,
        ) {
          this.statusCode = code
          const hdrs = typeof reasonOrHeaders === 'object' ? reasonOrHeaders : maybeHeaders
          if (hdrs) for (const [k, v] of Object.entries(hdrs)) this.headers[k.toLowerCase()] = String(v)
          return this
        },
        write(chunk: any) {
          if (chunk) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          return true
        },
        end(data?: any) {
          if (data) {
            if (typeof data === 'string') chunks.push(Buffer.from(data))
            else if (data instanceof Uint8Array || Buffer.isBuffer(data)) chunks.push(data)
          }
          resolve(
            new Response(chunks.length > 0 ? Buffer.concat(chunks) : null, {
              status: this.statusCode,
              headers: this.headers,
            }),
          )
        },
        once() {
          return this
        },
        on() {
          return this
        },
        emit() {
          return this
        },
        removeListener() {
          return this
        },
      } as any

      vite.middlewares(req, res, (err: any) => {
        if (err) {
          resolve(new Response(err.stack || err.toString(), { status: 500 }))
          return
        }
        resolve(new Response('Not Found', { status: 404 }))
      })
    })
  }

  // === PRODUCTION: Static Files + SPA Fallback ===
  const filePath = path.join('dist', pathname === '/' ? 'index.html' : pathname)

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath)
    const contentType: Record<string, string> = {
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.html': 'text/html; charset=utf-8',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.ico': 'image/x-icon',
    }
    const isHashed = pathname.startsWith('/assets/')
    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': contentType[ext] ?? 'application/octet-stream',
        'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      },
    })
  }

  // SPA fallback — semua route yang tidak match file → index.html
  const indexHtml = path.join('dist', 'index.html')
  if (fs.existsSync(indexHtml)) {
    return new Response(Bun.file(indexHtml), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    })
  }

  return new Response('Not Found', { status: 404 })
}

// ─── Audit Log Rotation ───────────────────────────────
import { prisma } from './lib/db'
import { runDueSoonSweep } from './lib/notifications'

async function cleanupAuditLogs() {
  const cutoff = new Date(Date.now() - env.AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
  if (count > 0) console.log(`[Audit] Cleaned up ${count} logs older than ${env.AUDIT_LOG_RETENTION_DAYS} days`)
}

async function cleanupWebhookLogs() {
  const cutoff = new Date(Date.now() - env.WEBHOOK_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  const { count } = await prisma.webhookRequestLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
  if (count > 0)
    console.log(`[Webhook] Cleaned up ${count} request logs older than ${env.WEBHOOK_LOG_RETENTION_DAYS} days`)
}

async function sweepDueTasks() {
  const { dueSoon, overdue } = await runDueSoonSweep()
  if (dueSoon || overdue) console.log(`[Notifications] dueSoon=${dueSoon} overdue=${overdue}`)
}

// Run on startup, then periodically
cleanupAuditLogs().catch(console.error)
cleanupWebhookLogs().catch(console.error)
sweepDueTasks().catch(console.error)
setInterval(() => cleanupAuditLogs().catch(console.error), 24 * 60 * 60 * 1000)
setInterval(() => cleanupWebhookLogs().catch(console.error), 24 * 60 * 60 * 1000)
setInterval(() => sweepDueTasks().catch(console.error), 60 * 60 * 1000)

// ─── Elysia App ────────────────────────────────────────
import { createApp } from './app'

const app = createApp()

  // Frontend intercept — onRequest jalan SEBELUM route matching
  .onRequest(async ({ request }) => {
    const pathname = new URL(request.url).pathname

    // Dev inspector: open file di editor
    if (!isProduction && pathname === '/__open-in-editor' && request.method === 'POST') {
      const { relativePath, lineNumber, columnNumber } = (await request.json()) as {
        relativePath: string
        lineNumber: string
        columnNumber: string
      }
      const file = `${process.cwd()}/${relativePath}`
      const editor = env.REACT_EDITOR
      const loc = `${file}:${lineNumber}:${columnNumber}`
      // zed & subl: editor file:line:col — code & cursor: editor --goto file:line:col
      const noGotoEditors = ['subl', 'zed']
      const args = noGotoEditors.includes(editor) ? [loc] : ['--goto', loc]
      const editorPath = Bun.which(editor)
      if (editorPath) Bun.spawn([editor, ...args], { stdio: ['ignore', 'ignore', 'ignore'] })
      return new Response('ok')
    }

    // Non-API route → serve frontend
    if (!isApiRoute(pathname)) {
      return serveFrontend(request)
    }
    // undefined → lanjut ke Elysia route matching
  })

  .listen(env.PORT)

console.log(`Server running at http://localhost:${app.server!.port}`)
