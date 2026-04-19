import { z } from 'zod'
import {
  computeAdminOverview,
  computeProjectHealth,
  computeRiskReport,
  computeTeamLoad,
} from '../../../src/lib/admin-overview'
import { computePhantomWork, computeTaskEffort, detectGhostTasks, effortReport } from '../../../src/lib/effort'
import { computeRetro, renderRetroMarkdown } from '../../../src/lib/retro'
import { jsonText, type ToolModule } from './shared'

export const overviewReadonly: ToolModule = {
  name: 'overview-readonly',
  scope: 'readonly',
  register(server) {
    server.registerTool(
      'admin_overview',
      {
        title: 'Admin overview KPIs',
        description:
          'Aggregated KPIs across users, projects, tasks, agents, webhooks, recent audit. Mirrors /admin Overview panel.',
        inputSchema: {
          recentAuditLimit: z.number().int().min(0).max(50).default(8),
        },
      },
      async ({ recentAuditLimit }) => jsonText(await computeAdminOverview({ recentAuditLimit })),
    )

    server.registerTool(
      'project_health',
      {
        title: 'Project health report',
        description:
          'Per-project health: overdue, blocked, velocity (closed/7d), extensions, days-until-due, score A-F. Filter by status or id.',
        inputSchema: {
          projectId: z.string().optional().describe('Single project id; omit for all active'),
          includeArchived: z.boolean().default(false),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ projectId, includeArchived, limit }) =>
        jsonText(await computeProjectHealth({ projectId, includeArchived, limit })),
    )

    server.registerTool(
      'team_load',
      {
        title: 'Team load report',
        description:
          'Per-user workload: open tasks, estimated hours, overdue, closed/7d. Sorted by open-task count desc. Flags overloaded users.',
        inputSchema: {
          projectId: z.string().optional().describe('Filter to one project; omit for all'),
          includeUnassigned: z.boolean().default(true),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ projectId, includeUnassigned, limit }) =>
        jsonText(await computeTeamLoad({ projectId, includeUnassigned, limit })),
    )

    server.registerTool(
      'risk_report',
      {
        title: 'Consolidated risk report',
        description:
          'Scans for risk signals: overdue tasks, stale IN_PROGRESS (>3d no update), projects past endsAt, pending agents, agents offline >1h, missing required env.',
        inputSchema: {
          staleDays: z.number().int().min(1).max(30).default(3),
          offlineHours: z.number().int().min(1).max(720).default(1),
        },
      },
      async ({ staleDays, offlineHours }) =>
        jsonText(await computeRiskReport({ staleDays, offlineHours })),
    )

    server.registerTool(
      'effort_report',
      {
        title: 'Estimate vs actual effort',
        description:
          'Per-task estimate vs actual hours (actual = sum of pm-watch window-bucket events from assignee agents in task window). Verdict: under|on|over|missing-estimate|no-assignee|no-activity.',
        inputSchema: {
          projectId: z.string().optional(),
          onlyClosed: z.boolean().default(false),
          limit: z.number().int().min(1).max(500).default(100),
        },
      },
      async ({ projectId, onlyClosed, limit }) => {
        const rows = await effortReport({ projectId, onlyClosed, limit })
        const summary = {
          total: rows.length,
          withActivity: rows.filter((r) => r.actualHours > 0).length,
          over: rows.filter((r) => r.verdict === 'over').length,
          under: rows.filter((r) => r.verdict === 'under').length,
          onTrack: rows.filter((r) => r.verdict === 'on').length,
          missingEstimate: rows.filter((r) => r.verdict === 'missing-estimate').length,
          noActivity: rows.filter((r) => r.verdict === 'no-activity').length,
        }
        return jsonText({ summary, rows })
      },
    )

    server.registerTool(
      'task_effort',
      {
        title: 'Task effort detail',
        description: 'Compute actual vs estimate for a single task using pm-watch activity events.',
        inputSchema: { taskId: z.string() },
      },
      async ({ taskId }) => {
        const effort = await computeTaskEffort(taskId)
        if (!effort) return jsonText({ error: 'Task not found' })
        return jsonText(effort)
      },
    )

    server.registerTool(
      'ghost_tasks',
      {
        title: 'Ghost/stalled tasks',
        description:
          'IN_PROGRESS tasks with no updates for N days. Flags assigneeOnlineLast24h (is the user still working?) and actualHoursLast7d.',
        inputSchema: {
          staleDays: z.number().int().min(1).max(30).default(3),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ staleDays, limit }) => {
        const rows = await detectGhostTasks({ staleDays, limit })
        return jsonText({ count: rows.length, staleDays, rows })
      },
    )

    server.registerTool(
      'phantom_work',
      {
        title: 'Untracked activity per user',
        description:
          'Per-user breakdown of totalHours / trackedHours (covered by at least one IN_PROGRESS or recently-closed task) / phantomHours (uncovered). Higher phantomPercent means more work outside the task system.',
        inputSchema: {
          days: z.number().int().min(1).max(90).default(7),
          limit: z.number().int().min(1).max(200).default(50),
        },
      },
      async ({ days, limit }) => {
        const rows = await computePhantomWork({ days, limit })
        return jsonText({ count: rows.length, days, rows })
      },
    )

    server.registerTool(
      'project_retro',
      {
        title: 'Automated retrospective',
        description:
          'Generate a retrospective for a project over a time window. Joins closed/slipped/blocked tasks + extensions + GitHub activity + top contributors. Returns markdown by default (paste-ready for docs/standup).',
        inputSchema: {
          projectId: z.string(),
          days: z.number().int().min(1).max(180).default(14).describe('Window length in days ending now'),
          since: z.string().optional().describe('ISO timestamp; overrides days if provided'),
          until: z.string().optional().describe('ISO timestamp; defaults to now'),
          format: z.enum(['markdown', 'json']).default('markdown'),
        },
      },
      async ({ projectId, days, since, until, format }) => {
        const now = new Date()
        const untilDate = until ? new Date(until) : now
        const sinceDate = since
          ? new Date(since)
          : new Date(untilDate.getTime() - days * 24 * 60 * 60 * 1000)
        if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime()) || untilDate <= sinceDate) {
          return jsonText({ error: 'Invalid since/until' })
        }
        const retro = await computeRetro({ projectId, since: sinceDate, until: untilDate })
        if (!retro) return jsonText({ error: 'Project not found' })
        if (format === 'markdown') return jsonText(renderRetroMarkdown(retro))
        return jsonText(retro)
      },
    )
  },
}
