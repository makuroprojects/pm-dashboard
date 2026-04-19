import {
  ActionIcon,
  Badge,
  Card,
  Code,
  Group,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { TbActivity, TbAlertTriangle, TbChartBar, TbCheck, TbRefresh, TbShieldOff } from 'react-icons/tb'
import { EChart } from './charts/EChart'

type Status = 'all' | 'ok' | 'fail' | 'auth'

const PAGE_SIZE = 25

interface TokenRef {
  id: string
  name: string
  tokenPrefix: string
  status?: string
  lastUsedAt?: string | null
}
interface AgentRef {
  id: string
  agentId: string
  hostname: string
  status?: string
  lastSeenAt?: string | null
}

interface SeriesBucket {
  t: string
  total: number
  ok: number
  fail: number
  authFail: number
  events: number
}

interface StatsResponse {
  summary: {
    total24h: number
    total7d: number
    ok24h: number
    fail24h: number
    authFail24h: number
    eventsIn24h: number
    successRate24h: number | null
  }
  series: SeriesBucket[]
  perToken: { tokenId: string | null; token: TokenRef | null; hits: number }[]
  perAgent: { agentDbId: string | null; agent: AgentRef | null; hits: number }[]
}

interface LogRow {
  id: string
  statusCode: number
  reason: string | null
  ip: string | null
  eventsIn: number
  createdAt: string
  token: { id: string; name: string; tokenPrefix: string } | null
  agent: { id: string; agentId: string; hostname: string } | null
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function statusColor(code: number): string {
  if (code === 200) return 'green'
  if (code === 401 || code === 403) return 'red'
  if (code === 400 || code === 413) return 'orange'
  if (code >= 500) return 'grape'
  return 'gray'
}

export function WebhookMonitorPanel() {
  const [filter, setFilter] = useState<Status>('all')
  const [page, setPage] = useState(1)

  const statsQuery = useQuery<StatsResponse>({
    queryKey: ['webhook-stats'],
    queryFn: async () => {
      const res = await fetch('/api/admin/webhooks/stats', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load stats')
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const logsQuery = useQuery<{ logs: LogRow[] }>({
    queryKey: ['webhook-logs', filter],
    queryFn: async () => {
      const res = await fetch(`/api/admin/webhooks/logs?status=${filter}&limit=100`, { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to load logs')
      return res.json()
    },
    refetchInterval: 10_000,
  })

  const s = statsQuery.data?.summary
  const successPct = s?.successRate24h == null ? '—' : `${Math.round(s.successRate24h * 100)}%`

  const logs = logsQuery.data?.logs ?? []
  const totalPages = Math.max(1, Math.ceil(logs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedLogs = logs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const seriesOpt = useMemo<EChartsOption | null>(() => {
    const series = statsQuery.data?.series
    if (!series || series.length === 0) return null
    const labels = series.map((b) => new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Success', 'Failures', 'Auth fails', 'Events'], top: 0, right: 8 },
      grid: { left: 40, right: 48, top: 36, bottom: 28 },
      xAxis: { type: 'category', data: labels, boundaryGap: false },
      yAxis: [
        { type: 'value', name: 'Requests', minInterval: 1, position: 'left' },
        { type: 'value', name: 'Events', minInterval: 1, position: 'right', splitLine: { show: false } },
      ],
      series: [
        {
          name: 'Success',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: '#40c057' },
          data: series.map((b) => b.ok),
        },
        {
          name: 'Failures',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#fa5252' },
          data: series.map((b) => b.fail),
        },
        {
          name: 'Auth fails',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          itemStyle: { color: '#f76707' },
          data: series.map((b) => b.authFail),
        },
        {
          name: 'Events',
          type: 'bar',
          yAxisIndex: 1,
          itemStyle: { color: '#228be6', opacity: 0.35, borderRadius: [3, 3, 0, 0] },
          barMaxWidth: 10,
          data: series.map((b) => b.events),
        },
      ],
    }
  }, [statsQuery.data?.series])

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="sm">
          <TbChartBar size={22} />
          <Title order={3}>Webhook Monitor</Title>
          <Text c="dimmed" size="sm">
            Last 24h / 7d aggregates + recent requests
          </Text>
        </Group>
        <Tooltip label="Refresh now">
          <ActionIcon
            variant="light"
            onClick={() => {
              statsQuery.refetch()
              logsQuery.refetch()
            }}
          >
            <TbRefresh />
          </ActionIcon>
        </Tooltip>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbActivity />
            <Text size="xs" c="dimmed">
              Requests 24h
            </Text>
          </Group>
          <Text fw={700} size="xl">
            {s?.total24h ?? '—'}
          </Text>
          <Text size="xs" c="dimmed">
            {s?.total7d ?? 0} over 7d
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbCheck />
            <Text size="xs" c="dimmed">
              Success 24h
            </Text>
          </Group>
          <Text fw={700} size="xl" c="green">
            {s?.ok24h ?? '—'}
          </Text>
          <Text size="xs" c="dimmed">
            {successPct} rate
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbAlertTriangle />
            <Text size="xs" c="dimmed">
              Failures 24h
            </Text>
          </Group>
          <Text fw={700} size="xl" c="orange">
            {s?.fail24h ?? '—'}
          </Text>
          <Text size="xs" c="dimmed">
            4xx/5xx total
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbShieldOff />
            <Text size="xs" c="dimmed">
              Auth fails 24h
            </Text>
          </Group>
          <Text fw={700} size="xl" c="red">
            {s?.authFail24h ?? '—'}
          </Text>
          <Text size="xs" c="dimmed">
            401 + 403
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbActivity />
            <Text size="xs" c="dimmed">
              Events ingested 24h
            </Text>
          </Group>
          <Text fw={700} size="xl">
            {s?.eventsIn24h ?? '—'}
          </Text>
          <Text size="xs" c="dimmed">
            from successful hits
          </Text>
        </Card>
      </SimpleGrid>

      {seriesOpt ? (
        <Card withBorder padding="sm">
          <Group justify="space-between" mb={4}>
            <Title order={5}>Request rate (last 24h, hourly)</Title>
            <Text size="xs" c="dimmed">
              {s?.total24h ?? 0} requests / {s?.eventsIn24h ?? 0} events
            </Text>
          </Group>
          <EChart option={seriesOpt} height={220} />
        </Card>
      ) : null}

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder>
          <Title order={5} mb="xs">
            Top tokens (7d)
          </Title>
          <Table striped withRowBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Token</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Hits</Table.Th>
                <Table.Th>Last used</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {statsQuery.data?.perToken.length ? (
                statsQuery.data.perToken.map((r) => (
                  <Table.Tr key={r.tokenId ?? 'env-fallback'}>
                    <Table.Td>
                      {r.token ? (
                        <Group gap={4}>
                          <Text size="sm">{r.token.name}</Text>
                          <Code>{r.token.tokenPrefix}…</Code>
                        </Group>
                      ) : (
                        <Text size="sm" c="dimmed">
                          env fallback / unmatched
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {r.token?.status ? (
                        <Badge
                          color={r.token.status === 'ACTIVE' ? 'green' : r.token.status === 'DISABLED' ? 'gray' : 'red'}
                          size="sm"
                        >
                          {r.token.status}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </Table.Td>
                    <Table.Td>{r.hits}</Table.Td>
                    <Table.Td>{formatRelative(r.token?.lastUsedAt)}</Table.Td>
                  </Table.Tr>
                ))
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text size="sm" c="dimmed">
                      No requests yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder>
          <Title order={5} mb="xs">
            Top agents (7d)
          </Title>
          <Table striped withRowBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Agent</Table.Th>
                <Table.Th>Hostname</Table.Th>
                <Table.Th>Hits</Table.Th>
                <Table.Th>Last seen</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {statsQuery.data?.perAgent.length ? (
                statsQuery.data.perAgent.map((r) => (
                  <Table.Tr key={r.agentDbId ?? 'none'}>
                    <Table.Td>
                      <Code>{r.agent?.agentId ?? '—'}</Code>
                    </Table.Td>
                    <Table.Td>{r.agent?.hostname ?? '—'}</Table.Td>
                    <Table.Td>{r.hits}</Table.Td>
                    <Table.Td>{formatRelative(r.agent?.lastSeenAt)}</Table.Td>
                  </Table.Tr>
                ))
              ) : (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text size="sm" c="dimmed">
                      No agent traffic yet.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Card>
      </SimpleGrid>

      <Card withBorder>
        <Group justify="space-between" mb="sm">
          <Title order={5}>Recent requests</Title>
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => {
              setFilter(v as Status)
              setPage(1)
            }}
            data={[
              { label: 'All', value: 'all' },
              { label: 'Success', value: 'ok' },
              { label: 'Failures', value: 'fail' },
              { label: 'Auth fails', value: 'auth' },
            ]}
          />
        </Group>
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>When</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Reason</Table.Th>
              <Table.Th>Token</Table.Th>
              <Table.Th>Agent</Table.Th>
              <Table.Th>IP</Table.Th>
              <Table.Th>Events</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pagedLogs.length ? (
              pagedLogs.map((row) => (
                <Table.Tr key={row.id}>
                  <Table.Td>{formatRelative(row.createdAt)}</Table.Td>
                  <Table.Td>
                    <Badge color={statusColor(row.statusCode)} size="sm">
                      {row.statusCode}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{row.reason ?? '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    {row.token ? (
                      <Group gap={4}>
                        <Text size="sm">{row.token.name}</Text>
                        <Code>{row.token.tokenPrefix}…</Code>
                      </Group>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {row.agent ? (
                      <Text size="sm">
                        {row.agent.hostname}{' '}
                        <Text span size="xs" c="dimmed">
                          ({row.agent.agentId.slice(0, 12)}…)
                        </Text>
                      </Text>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Code>{row.ip ?? '—'}</Code>
                  </Table.Td>
                  <Table.Td>{row.eventsIn || '—'}</Table.Td>
                </Table.Tr>
              ))
            ) : (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text size="sm" c="dimmed">
                    No matching requests.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
        {logs.length > PAGE_SIZE && (
          <Group justify="space-between" mt="sm">
            <Text size="xs" c="dimmed">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, logs.length)} of {logs.length}
            </Text>
            <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
          </Group>
        )}
      </Card>
    </Stack>
  )
}
