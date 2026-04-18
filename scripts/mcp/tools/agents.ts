import { z } from 'zod'
import { appLog } from '../../../src/lib/applog'
import { prisma } from '../../../src/lib/db'
import { jsonText, type ToolModule } from './shared'

async function audit(userId: string | null, action: string, detail: string | null) {
  await prisma.auditLog.create({ data: { userId, action, detail, ip: 'mcp' } }).catch(() => {})
}

function liveness(lastSeenAt: Date | null): 'live' | 'recent' | 'stale' | 'never' {
  if (!lastSeenAt) return 'never'
  const diff = Date.now() - lastSeenAt.getTime()
  if (diff < 5 * 60 * 1000) return 'live'
  if (diff < 60 * 60 * 1000) return 'recent'
  return 'stale'
}

export const agentsReadonly: ToolModule = {
  name: 'agents-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'agent_list',
      {
        title: 'List pm-watch agents',
        description: 'List ActivityWatch ingestion agents with status, assignee, event counts, and liveness.',
        inputSchema: {
          status: z.enum(['PENDING', 'APPROVED', 'REVOKED', 'ALL']).default('ALL'),
          limit: z.number().int().min(1).max(500).default(100),
        },
      },
      async ({ status, limit }) => {
        const where = status === 'ALL' ? {} : { status }
        const agents = await prisma.agent.findMany({
          where,
          include: {
            claimedBy: { select: { id: true, name: true, email: true, role: true } },
            _count: { select: { events: true, requestLogs: true } },
          },
          orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
          take: limit,
        })
        return jsonText({
          count: agents.length,
          agents: agents.map(a => ({
            id: a.id,
            agentId: a.agentId,
            hostname: a.hostname,
            osUser: a.osUser,
            status: a.status,
            assignedTo: a.claimedBy ? `${a.claimedBy.name} <${a.claimedBy.email}>` : null,
            lastSeenAt: a.lastSeenAt,
            liveness: liveness(a.lastSeenAt),
            events: a._count.events,
            requestLogs: a._count.requestLogs,
            createdAt: a.createdAt,
          })),
        })
      },
    )

    server.registerTool(
      'agent_get',
      {
        title: 'Get agent detail',
        description: 'Fetch full agent info including recent events and request logs',
        inputSchema: {
          agentId: z.string().describe('Agent public ID (agentId field) or UUID'),
          recentEvents: z.number().int().min(0).max(50).default(5),
          recentLogs: z.number().int().min(0).max(50).default(10),
        },
      },
      async ({ agentId, recentEvents, recentLogs }) => {
        const agent = await prisma.agent.findFirst({
          where: { OR: [{ id: agentId }, { agentId }] },
          include: {
            claimedBy: { select: { id: true, name: true, email: true, role: true } },
            events: {
              orderBy: { timestamp: 'desc' },
              take: recentEvents,
              select: { id: true, bucketId: true, eventId: true, timestamp: true, duration: true, data: true },
            },
            requestLogs: {
              orderBy: { createdAt: 'desc' },
              take: recentLogs,
              select: { id: true, statusCode: true, reason: true, eventsIn: true, createdAt: true, tokenId: true },
            },
            _count: { select: { events: true, requestLogs: true } },
          },
        })
        if (!agent) return jsonText({ error: 'Agent not found' })
        return jsonText({
          agent: { ...agent, liveness: liveness(agent.lastSeenAt) },
        })
      },
    )
  },
}

export const agentsTools: ToolModule = {
  name: 'agents',
  scope: 'admin',
  register(server) {
    server.registerTool(
      'agent_approve',
      {
        title: 'Approve pm-watch agent',
        description: 'Approve a PENDING agent and assign it to a user. Events from the agent will be attributed to this user.',
        inputSchema: {
          agentId: z.string().describe('Agent public ID (agentId field) or UUID'),
          userEmail: z.string().email().describe('Email of user to assign events to'),
        },
      },
      async ({ agentId, userEmail }) => {
        const agent = await prisma.agent.findFirst({ where: { OR: [{ id: agentId }, { agentId }] } })
        if (!agent) return jsonText({ error: 'Agent not found' })
        const user = await prisma.user.findUnique({ where: { email: userEmail } })
        if (!user) return jsonText({ error: `User not found: ${userEmail}` })
        const updated = await prisma.agent.update({
          where: { id: agent.id },
          data: { status: 'APPROVED', claimedById: user.id },
        })
        await audit(user.id, 'MCP_AGENT_APPROVED', `agent ${agent.agentId} → ${userEmail}`)
        appLog('info', `MCP: approved agent ${agent.agentId} → ${userEmail}`)
        return jsonText({ ok: true, agent: updated })
      },
    )

    server.registerTool(
      'agent_revoke',
      {
        title: 'Revoke pm-watch agent',
        description: 'Revoke an APPROVED agent. Future events rejected (403). Existing events preserved. Reversible via agent_approve.',
        inputSchema: {
          agentId: z.string().describe('Agent public ID or UUID'),
          reason: z.string().optional(),
        },
      },
      async ({ agentId, reason }) => {
        const agent = await prisma.agent.findFirst({ where: { OR: [{ id: agentId }, { agentId }] } })
        if (!agent) return jsonText({ error: 'Agent not found' })
        const updated = await prisma.agent.update({
          where: { id: agent.id },
          data: { status: 'REVOKED' },
        })
        await audit(agent.claimedById, 'MCP_AGENT_REVOKED', `${agent.agentId}${reason ? ` — ${reason}` : ''}`)
        appLog('warn', `MCP: revoked agent ${agent.agentId}`, reason)
        return jsonText({ ok: true, agent: updated })
      },
    )

    server.registerTool(
      'agent_reassign',
      {
        title: 'Reassign pm-watch agent',
        description: 'Change the user an APPROVED agent attributes events to.',
        inputSchema: {
          agentId: z.string(),
          userEmail: z.string().email(),
        },
      },
      async ({ agentId, userEmail }) => {
        const agent = await prisma.agent.findFirst({ where: { OR: [{ id: agentId }, { agentId }] } })
        if (!agent) return jsonText({ error: 'Agent not found' })
        if (agent.status !== 'APPROVED') return jsonText({ error: `Agent is ${agent.status}, must be APPROVED to reassign` })
        const user = await prisma.user.findUnique({ where: { email: userEmail } })
        if (!user) return jsonText({ error: `User not found: ${userEmail}` })
        const updated = await prisma.agent.update({
          where: { id: agent.id },
          data: { claimedById: user.id },
        })
        await audit(user.id, 'MCP_AGENT_REASSIGNED', `${agent.agentId} → ${userEmail}`)
        appLog('info', `MCP: reassigned agent ${agent.agentId} → ${userEmail}`)
        return jsonText({ ok: true, agent: updated })
      },
    )
  },
}
