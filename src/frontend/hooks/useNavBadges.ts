import { useQuery } from '@tanstack/react-query'

interface RiskSummary {
  overdueTasks: number
  staleTasks: number
  pastDueProjects: number
  pendingAgents: number
  offlineAgents: number
  missingEnv: number
}

interface RiskReport {
  severity: 'none' | 'low' | 'medium' | 'high'
  summary: RiskSummary
}

interface WebhookStats {
  h24: { total: number; success: number; fail: number; authFail: number }
}

export interface NavBadges {
  pendingAgents: number
  overdueTasks: number
  pastDueProjects: number
  offlineAgents: number
  missingEnv: number
  webhookFail24h: number
  loaded: boolean
}

export function useNavBadges(enabled = true): NavBadges {
  const risksQ = useQuery({
    queryKey: ['admin', 'overview', 'risks'],
    queryFn: () =>
      fetch('/api/admin/overview/risks', { credentials: 'include' }).then((r) => r.json()) as Promise<RiskReport>,
    refetchInterval: 30_000,
    enabled,
  })

  const whQ = useQuery({
    queryKey: ['admin', 'webhooks', 'stats'],
    queryFn: () =>
      fetch('/api/admin/webhooks/stats', { credentials: 'include' }).then((r) => r.json()) as Promise<WebhookStats>,
    refetchInterval: 30_000,
    enabled,
  })

  const s = risksQ.data?.summary
  return {
    pendingAgents: s?.pendingAgents ?? 0,
    overdueTasks: s?.overdueTasks ?? 0,
    pastDueProjects: s?.pastDueProjects ?? 0,
    offlineAgents: s?.offlineAgents ?? 0,
    missingEnv: s?.missingEnv ?? 0,
    webhookFail24h: (whQ.data?.h24?.fail ?? 0) + (whQ.data?.h24?.authFail ?? 0),
    loaded: !risksQ.isLoading,
  }
}
