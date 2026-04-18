import { z } from 'zod'
import { appLog } from '../../../src/lib/applog'
import { prisma } from '../../../src/lib/db'
import { generateWebhookToken } from '../../../src/lib/webhook-tokens'
import { jsonText, type ToolModule } from './shared'

async function audit(userId: string | null, action: string, detail: string | null) {
  await prisma.auditLog.create({ data: { userId, action, detail, ip: 'mcp' } }).catch(() => {})
}

export const webhooksReadonly: ToolModule = {
  name: 'webhooks-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'webhook_token_list',
      {
        title: 'List webhook tokens',
        description: 'List pm-watch webhook tokens. Hashes are never returned; plaintext tokens cannot be recovered.',
        inputSchema: {
          status: z.enum(['ACTIVE', 'DISABLED', 'REVOKED', 'ALL']).default('ALL'),
        },
      },
      async ({ status }) => {
        const where = status === 'ALL' ? {} : { status }
        const tokens = await prisma.webhookToken.findMany({
          where,
          include: {
            createdBy: { select: { id: true, email: true } },
            _count: { select: { requestLogs: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
        return jsonText({
          count: tokens.length,
          tokens: tokens.map(t => ({
            id: t.id,
            name: t.name,
            prefix: t.tokenPrefix,
            status: t.status,
            expiresAt: t.expiresAt,
            lastUsedAt: t.lastUsedAt,
            requestLogs: t._count.requestLogs,
            createdBy: t.createdBy?.email ?? null,
            createdAt: t.createdAt,
          })),
        })
      },
    )

    server.registerTool(
      'webhook_stats',
      {
        title: 'Webhook stats',
        description: 'Aggregate stats for /webhooks/aw over a time window. Returns totals + per-token + per-agent breakdown.',
        inputSchema: {
          windowHours: z.number().int().min(1).max(24 * 30).default(24),
        },
      },
      async ({ windowHours }) => {
        const since = new Date(Date.now() - windowHours * 60 * 60 * 1000)
        const [total, success, failures, authFails, eventsAgg, perToken, perAgent] = await Promise.all([
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since } } }),
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since }, statusCode: 200 } }),
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since }, statusCode: { gte: 400 } } }),
          prisma.webhookRequestLog.count({ where: { createdAt: { gte: since }, statusCode: 401 } }),
          prisma.webhookRequestLog.aggregate({
            where: { createdAt: { gte: since }, statusCode: 200 },
            _sum: { eventsIn: true },
          }),
          prisma.webhookRequestLog.groupBy({
            by: ['tokenId'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
            _sum: { eventsIn: true },
          }),
          prisma.webhookRequestLog.groupBy({
            by: ['agentId'],
            where: { createdAt: { gte: since } },
            _count: { _all: true },
            _sum: { eventsIn: true },
          }),
        ])
        const tokenIds = perToken.map(g => g.tokenId).filter((v): v is string => v !== null)
        const agentIds = perAgent.map(g => g.agentId).filter((v): v is string => v !== null)
        const [tokenMap, agentMap] = await Promise.all([
          prisma.webhookToken
            .findMany({ where: { id: { in: tokenIds } }, select: { id: true, name: true, tokenPrefix: true } })
            .then(rows => Object.fromEntries(rows.map(r => [r.id, r]))),
          prisma.agent
            .findMany({ where: { id: { in: agentIds } }, select: { id: true, agentId: true, hostname: true } })
            .then(rows => Object.fromEntries(rows.map(r => [r.id, r]))),
        ])
        return jsonText({
          windowHours,
          since,
          total,
          success,
          failures,
          authFails,
          successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : null,
          eventsIngested: eventsAgg._sum.eventsIn ?? 0,
          perToken: perToken.map(g => ({
            tokenId: g.tokenId,
            token: g.tokenId ? tokenMap[g.tokenId] ?? null : null,
            label: g.tokenId ? tokenMap[g.tokenId]?.name ?? '(deleted)' : 'env fallback / unmatched',
            count: g._count._all,
            eventsIn: g._sum.eventsIn ?? 0,
          })),
          perAgent: perAgent.map(g => ({
            agentId: g.agentId,
            agent: g.agentId ? agentMap[g.agentId] ?? null : null,
            label: g.agentId ? agentMap[g.agentId]?.hostname ?? '(deleted)' : 'unknown agent',
            count: g._count._all,
            eventsIn: g._sum.eventsIn ?? 0,
          })),
        })
      },
    )

    server.registerTool(
      'webhook_logs',
      {
        title: 'Recent webhook request logs',
        description: 'Fetch recent /webhooks/aw request logs. Filter by status class.',
        inputSchema: {
          status: z.enum(['all', 'ok', 'fail', 'auth']).default('all'),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ status, limit }) => {
        const where: Record<string, unknown> = {}
        if (status === 'ok') where.statusCode = 200
        else if (status === 'fail') where.statusCode = { gte: 400 }
        else if (status === 'auth') where.statusCode = 401
        const logs = await prisma.webhookRequestLog.findMany({
          where,
          include: {
            token: { select: { id: true, name: true, tokenPrefix: true, status: true } },
            agent: { select: { id: true, agentId: true, hostname: true, status: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: limit,
        })
        return jsonText({ count: logs.length, logs })
      },
    )
  },
}

export const webhooksTools: ToolModule = {
  name: 'webhooks',
  scope: 'admin',
  register(server) {
    server.registerTool(
      'webhook_token_create',
      {
        title: 'Create webhook token',
        description:
          'Generate a new webhook token. The plaintext value is returned ONCE in the response — store it immediately, it cannot be retrieved later.',
        inputSchema: {
          name: z.string().min(1).describe('Human label, e.g. "ci-bot-prod"'),
          expiresInDays: z.number().int().min(1).max(365 * 5).optional().describe('Omit for never-expires'),
          createdByEmail: z.string().email().optional().describe('Attribute creation to this user'),
        },
      },
      async ({ name, expiresInDays, createdByEmail }) => {
        const { raw, hash, prefix } = generateWebhookToken()
        let createdById: string | null = null
        if (createdByEmail) {
          const user = await prisma.user.findUnique({ where: { email: createdByEmail } })
          if (!user) return jsonText({ error: `User not found: ${createdByEmail}` })
          createdById = user.id
        }
        const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null
        const token = await prisma.webhookToken.create({
          data: { name, tokenHash: hash, tokenPrefix: prefix, expiresAt, createdById },
        })
        await audit(createdById, 'MCP_WEBHOOK_TOKEN_CREATED', `${name} (${prefix})`)
        appLog('info', `MCP: webhook token created "${name}" (${prefix})`)
        return jsonText({
          ok: true,
          token: { id: token.id, name: token.name, prefix: token.tokenPrefix, status: token.status, expiresAt: token.expiresAt },
          plaintext: raw,
          warning: 'Save the plaintext token NOW — it will never be shown again.',
        })
      },
    )

    server.registerTool(
      'webhook_token_toggle',
      {
        title: 'Toggle webhook token enabled state',
        description: 'Flip a token between ACTIVE and DISABLED. Use webhook_token_revoke for permanent disable.',
        inputSchema: {
          tokenId: z.string(),
          status: z.enum(['ACTIVE', 'DISABLED']),
        },
      },
      async ({ tokenId, status }) => {
        const token = await prisma.webhookToken.findUnique({ where: { id: tokenId } })
        if (!token) return jsonText({ error: 'Token not found' })
        if (token.status === 'REVOKED') return jsonText({ error: 'Cannot modify a REVOKED token' })
        const updated = await prisma.webhookToken.update({ where: { id: tokenId }, data: { status } })
        await audit(null, 'MCP_WEBHOOK_TOKEN_TOGGLED', `${token.name} → ${status}`)
        appLog('info', `MCP: webhook token "${token.name}" → ${status}`)
        return jsonText({ ok: true, token: updated })
      },
    )

    server.registerTool(
      'webhook_token_revoke',
      {
        title: 'Revoke webhook token',
        description: 'Permanently revoke a webhook token. Cannot be reversed — create a new token to replace.',
        inputSchema: {
          tokenId: z.string(),
          reason: z.string().optional(),
        },
      },
      async ({ tokenId, reason }) => {
        const token = await prisma.webhookToken.findUnique({ where: { id: tokenId } })
        if (!token) return jsonText({ error: 'Token not found' })
        const updated = await prisma.webhookToken.update({
          where: { id: tokenId },
          data: { status: 'REVOKED' },
        })
        await audit(null, 'MCP_WEBHOOK_TOKEN_REVOKED', `${token.name}${reason ? ` — ${reason}` : ''}`)
        appLog('warn', `MCP: webhook token "${token.name}" revoked`, reason)
        return jsonText({ ok: true, token: updated })
      },
    )
  },
}
