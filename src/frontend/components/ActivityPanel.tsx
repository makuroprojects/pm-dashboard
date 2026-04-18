import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  Center,
  Code,
  Divider,
  Group,
  Indicator,
  Modal,
  Pagination,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { DatePicker } from '@mantine/dates'
import { useQuery } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { TbActivity, TbCalendar, TbClock, TbDeviceDesktop, TbRefresh, TbUserCog } from 'react-icons/tb'
import { EChart } from '@/frontend/components/charts/EChart'
import { useSession } from '@/frontend/hooks/useAuth'

interface ActivityAgent {
  id: string
  agentId: string
  hostname: string
  osUser: string
  lastSeenAt: string | null
  claimedBy: { id: string; name: string; email: string } | null
  _count: { events: number }
}

interface AvailableUser {
  id: string
  name: string
  email: string
  agentCount: number
  eventCount: number
}

interface AgentsResponse {
  agents: ActivityAgent[]
  scopeUserId: string
  availableUsers?: AvailableUser[]
}

interface ActivityEvent {
  id: string
  agentId: string
  bucketId: string
  eventId: number
  timestamp: string
  duration: number
  data: Record<string, unknown>
  createdAt: string
  agent: { hostname: string; osUser: string }
}

interface ActivitySummary {
  today: { count: number; durationSec: number }
  week: { count: number; durationSec: number }
  window?: { from: string; to: string }
  topApps: Array<{ app: string; durationSec: number; count: number }>
  topTitles: Array<{ key: string; app: string; title: string; durationSec: number; count: number }>
  byBucket: Array<{ bucketId: string; durationSec: number; count: number }>
}

async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: 'include' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return `${h}h ${m}m`
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString()
}

function toDate(v: unknown): Date | null {
  if (v == null) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function describeEvent(e: ActivityEvent): { primary: string; secondary: string | null } {
  const d = e.data ?? {}
  const app = typeof d.app === 'string' ? d.app : null
  const title = typeof d.title === 'string' ? d.title : null
  const url = typeof d.url === 'string' ? d.url : null
  const status = typeof d.status === 'string' ? d.status : null
  if (app && title) return { primary: app, secondary: title }
  if (app) return { primary: app, secondary: null }
  if (url) return { primary: url, secondary: title }
  if (status) return { primary: `AFK: ${status}`, secondary: null }
  return { primary: e.bucketId, secondary: null }
}

export function ActivityPanel() {
  const { data: session } = useSession()
  const user = session?.user
  const isAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  const [agentId, setAgentId] = useState<string | null>(null)
  const [viewUserId, setViewUserId] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date())
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date())
  const [heatmapYear, setHeatmapYear] = useState<number>(() => new Date().getFullYear())
  const [detailEvent, setDetailEvent] = useState<ActivityEvent | null>(null)
  const [pageSize, setPageSize] = useState<number>(25)
  const [page, setPage] = useState<number>(1)

  const { from, to } = useMemo(() => {
    const start = new Date(selectedDate)
    start.setHours(0, 0, 0, 0)
    const end = new Date(selectedDate)
    end.setHours(23, 59, 59, 999)
    return { from: start.toISOString(), to: end.toISOString() }
  }, [selectedDate])
  const calendarMonthKey = useMemo(
    () => `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}`,
    [calendarMonth],
  )
  const isToday = useMemo(() => {
    const now = new Date()
    return (
      now.getFullYear() === selectedDate.getFullYear() &&
      now.getMonth() === selectedDate.getMonth() &&
      now.getDate() === selectedDate.getDate()
    )
  }, [selectedDate])
  const scopeUserParam = isAdmin && viewUserId ? `&userId=${viewUserId}` : ''

  const agentsQ = useQuery({
    queryKey: ['activity', 'agents', viewUserId],
    queryFn: () => api<AgentsResponse>(`/api/activity/agents${isAdmin && viewUserId ? `?userId=${viewUserId}` : ''}`),
  })
  const agents = agentsQ.data?.agents ?? []
  const availableUsers = agentsQ.data?.availableUsers ?? []
  const hasAgents = agents.length > 0

  const eventsQueryKey = ['activity', 'events', from, to, agentId, viewUserId] as const
  const eventsQ = useQuery({
    queryKey: eventsQueryKey,
    queryFn: () => {
      const p = new URLSearchParams({ from, to, limit: '1000' })
      if (agentId) p.set('agentId', agentId)
      return api<{ events: ActivityEvent[]; count: number }>(`/api/activity?${p}${scopeUserParam}`)
    },
    refetchInterval: isToday ? 30_000 : false,
    enabled: hasAgents,
  })
  const events = eventsQ.data?.events ?? []
  const totalPages = Math.max(1, Math.ceil(events.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pagedEvents = useMemo(
    () => events.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [events, currentPage, pageSize],
  )
  const resetPage = () => setPage(1)

  const summaryQueryKey = ['activity', 'summary', from, to, viewUserId] as const
  const summaryQ = useQuery({
    queryKey: summaryQueryKey,
    queryFn: () => api<ActivitySummary>(`/api/activity/summary?from=${from}&to=${to}${scopeUserParam}`),
    refetchInterval: isToday ? 30_000 : false,
    enabled: hasAgents,
  })
  const summary = summaryQ.data

  const calendarQ = useQuery({
    queryKey: ['activity', 'calendar', calendarMonthKey, viewUserId],
    queryFn: () =>
      api<{ month: string; days: Record<string, { count: number; durationSec: number }> }>(
        `/api/activity/calendar?month=${calendarMonthKey}${scopeUserParam}`,
      ),
    enabled: hasAgents,
  })
  const calendarDays = calendarQ.data?.days ?? {}

  const heatmapQ = useQuery({
    queryKey: ['activity', 'heatmap', heatmapYear, viewUserId],
    queryFn: () =>
      api<{ year: number; days: Record<string, { count: number; durationSec: number }> }>(
        `/api/activity/heatmap?year=${heatmapYear}${scopeUserParam}`,
      ),
    enabled: hasAgents,
  })
  const heatmapDays = heatmapQ.data?.days ?? {}

  const eventsTotalDuration = useMemo(() => events.reduce((sum, e) => sum + e.duration, 0), [events])

  const hourlyOption = useMemo<EChartsOption>(() => {
    const appTotals = new Map<string, number>()
    for (const e of events) {
      const app = typeof e.data?.app === 'string' ? e.data.app : null
      if (!app) continue
      appTotals.set(app, (appTotals.get(app) ?? 0) + e.duration)
    }
    const topApps = [...appTotals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([a]) => a)
    const otherKey = 'Other'

    const matrix: Record<string, number[]> = {}
    for (const app of topApps) matrix[app] = Array(24).fill(0)
    matrix[otherKey] = Array(24).fill(0)
    let hasOther = false

    for (const e of events) {
      const app = typeof e.data?.app === 'string' ? e.data.app : null
      const h = new Date(e.timestamp).getHours()
      if (app && topApps.includes(app)) {
        matrix[app][h] += e.duration
      } else {
        matrix[otherKey][h] += e.duration
        if (!app || !topApps.includes(app)) hasOther = true
      }
    }

    const keys = [...topApps]
    if (hasOther) keys.push(otherKey)

    const palette = ['#228be6', '#40c057', '#fab005', '#e64980', '#7950f2', '#868e96']
    const series = keys.map((app, i) => ({
      name: app,
      type: 'line' as const,
      stack: 'total',
      smooth: true,
      showSymbol: false,
      areaStyle: { opacity: 0.8 },
      emphasis: { focus: 'series' as const },
      lineStyle: { width: 1 },
      itemStyle: { color: palette[i % palette.length] },
      data: matrix[app].map((v) => Math.round(v)),
    }))

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        valueFormatter: (v) => formatDuration(typeof v === 'number' ? v : 0),
      },
      legend: {
        data: keys,
        top: 0,
        type: 'scroll',
        textStyle: { fontSize: 10 },
      },
      grid: { left: 48, right: 16, top: 36, bottom: 28 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')),
        axisLabel: { fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (v: number) => (v >= 3600 ? `${(v / 3600).toFixed(1)}h` : `${Math.round(v / 60)}m`),
          fontSize: 10,
        },
        splitLine: { lineStyle: { opacity: 0.3 } },
      },
      series,
    }
  }, [events])

  const trendOption = useMemo<EChartsOption>(() => {
    const keys = Object.keys(calendarDays).sort()
    const data = keys.map((k) => ({
      name: k,
      value: [k, Math.round((calendarDays[k]?.durationSec ?? 0) / 60)],
    }))
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const p = Array.isArray(params) ? params[0] : params
          const key = (p as { name: string }).name
          const stats = calendarDays[key]
          return `<strong>${key}</strong><br/>${formatDuration(stats?.durationSec ?? 0)}<br/>${stats?.count ?? 0} events`
        },
      },
      grid: { left: 48, right: 16, top: 16, bottom: 28 },
      xAxis: {
        type: 'category',
        data: keys.map((k) => k.slice(8)),
        boundaryGap: false,
        axisLabel: { interval: 'auto', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => `${(v / 60).toFixed(1)}h`, fontSize: 10 },
        splitLine: { lineStyle: { opacity: 0.3 } },
      },
      series: [
        {
          type: 'line',
          data: data.map((d) => d.value[1]),
          smooth: true,
          showSymbol: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: '#228be6' },
          itemStyle: { color: '#228be6' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(34,139,230,0.4)' },
                { offset: 1, color: 'rgba(34,139,230,0)' },
              ],
            },
          },
        },
      ],
    }
  }, [calendarDays])

  const hasHourlyData = useMemo(() => events.length > 0, [events])
  const hasTrendData = Object.keys(calendarDays).length > 0
  const hasHeatmapData = Object.keys(heatmapDays).length > 0

  const sankeyOption = useMemo<EChartsOption>(() => {
    const byAppTotal = new Map<string, number>()
    const byAppTitle = new Map<string, Map<string, number>>()
    for (const e of events) {
      const app = typeof e.data?.app === 'string' ? e.data.app : null
      if (!app) continue
      const title = typeof e.data?.title === 'string' && e.data.title.trim() ? e.data.title.trim() : '(untitled)'
      byAppTotal.set(app, (byAppTotal.get(app) ?? 0) + e.duration)
      let titles = byAppTitle.get(app)
      if (!titles) {
        titles = new Map()
        byAppTitle.set(app, titles)
      }
      titles.set(title, (titles.get(title) ?? 0) + e.duration)
    }
    const topApps = [...byAppTotal.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    type Node = { name: string; itemStyle?: { color: string } }
    type Link = { source: string; target: string; value: number }
    const palette = ['#228be6', '#40c057', '#fab005', '#e64980', '#7950f2', '#12b886']
    const nodes: Node[] = []
    const seen = new Set<string>()
    const links: Link[] = []
    topApps.forEach(([app], i) => {
      const appNode = `app:${app}`
      if (!seen.has(appNode)) {
        nodes.push({ name: appNode, itemStyle: { color: palette[i % palette.length] } })
        seen.add(appNode)
      }
      const titles = byAppTitle.get(app)!
      const topTitles = [...titles.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
      for (const [title, value] of topTitles) {
        const titleNode = `${app}::${title}`
        if (!seen.has(titleNode)) {
          nodes.push({ name: titleNode })
          seen.add(titleNode)
        }
        links.push({ source: appNode, target: titleNode, value: Math.round(value) })
      }
    })
    return {
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          const p = params as {
            dataType?: string
            name?: string
            value?: number
            data?: { source?: string; target?: string }
          }
          if (p.dataType === 'edge') {
            const src = String(p.data?.source ?? '').replace(/^app:/, '')
            const tgt = String(p.data?.target ?? '').split('::')[1] ?? ''
            return `<strong>${src}</strong> → ${tgt}<br/>${formatDuration(p.value ?? 0)}`
          }
          const name = String(p.name ?? '')
          const label = name.startsWith('app:') ? name.slice(4) : (name.split('::')[1] ?? name)
          return `${label}<br/>${formatDuration(p.value ?? 0)}`
        },
      },
      series: [
        {
          type: 'sankey',
          data: nodes,
          links,
          nodeAlign: 'left',
          nodeGap: 8,
          nodeWidth: 14,
          left: 16,
          right: 180,
          top: 8,
          bottom: 8,
          lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.5 },
          label: {
            formatter: (params) => {
              const name = String((params as { name: string }).name)
              if (name.startsWith('app:')) return name.slice(4)
              const parts = name.split('::')
              const title = parts[1] ?? name
              return title.length > 34 ? `${title.slice(0, 32)}…` : title
            },
            fontSize: 11,
          },
          emphasis: { focus: 'adjacency' },
        },
      ],
    }
  }, [events])

  const hasSankeyData = events.some((e) => typeof e.data?.app === 'string')

  const heatmapOption = useMemo<EChartsOption>(() => {
    const entries: Array<[string, number]> = Object.entries(heatmapDays).map(([date, stats]) => [
      date,
      Math.round(stats.durationSec),
    ])
    const max = entries.reduce((m, e) => (e[1] > m ? e[1] : m), 0)
    const cap = Math.max(max, 3600)
    return {
      tooltip: {
        formatter: (params) => {
          const p = params as { value?: [string, number] }
          if (!p.value) return ''
          const [date, v] = p.value
          const stats = heatmapDays[date]
          return `<strong>${date}</strong><br/>${formatDuration(v)}<br/>${stats?.count ?? 0} events`
        },
      },
      visualMap: {
        min: 0,
        max: cap,
        type: 'continuous',
        orient: 'horizontal',
        left: 'center',
        bottom: 4,
        itemWidth: 12,
        itemHeight: 160,
        calculable: false,
        inRange: { color: ['#e7f5ff', '#4dabf7', '#1971c2', '#0b4884'] },
        textStyle: { fontSize: 10 },
        formatter: (v) => formatDuration(Number(v)),
      },
      calendar: {
        orient: 'horizontal',
        range: String(heatmapYear),
        top: 30,
        left: 40,
        right: 10,
        cellSize: ['auto', 14],
        splitLine: { show: false },
        itemStyle: { borderWidth: 2 },
        dayLabel: { firstDay: 1, fontSize: 10 },
        monthLabel: { fontSize: 10 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: entries,
        },
      ],
    }
  }, [heatmapDays, heatmapYear])

  const refreshAll = () => {
    agentsQ.refetch()
    if (hasAgents) {
      eventsQ.refetch()
      summaryQ.refetch()
      calendarQ.refetch()
      heatmapQ.refetch()
    }
  }

  const handleHeatmapClick = (params: unknown) => {
    const p = params as { value?: [string, number]; componentType?: string }
    if (p.componentType !== 'series') return
    const date = p.value?.[0]
    if (!date) return
    const d = new Date(`${date}T00:00:00`)
    if (Number.isNaN(d.getTime())) return
    setSelectedDate(d)
    setCalendarMonth(d)
    resetPage()
  }
  const initialLoading = agentsQ.isLoading || (hasAgents && (eventsQ.isLoading || summaryQ.isLoading))

  const jumpToToday = () => {
    const today = new Date()
    setSelectedDate(today)
    setCalendarMonth(today)
    resetPage()
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={3}>Activity</Title>
          <Text c="dimmed" size="sm">
            ActivityWatch events synced from your approved pm-watch agents.
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label="Refresh">
            <ActionIcon variant="light" onClick={refreshAll} loading={initialLoading}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {isAdmin && availableUsers.length > 0 && (
        <Card withBorder padding="sm" radius="md">
          <Group gap="sm" wrap="wrap">
            <TbUserCog size={14} />
            <Text size="xs" c="dimmed">
              Admin view — switch user:
            </Text>
            <Select
              placeholder={`My activity (${user?.email ?? ''})`}
              data={availableUsers.map((u) => ({
                value: u.id,
                label: `${u.name} · ${u.agentCount} agent${u.agentCount === 1 ? '' : 's'} · ${u.eventCount} events`,
              }))}
              value={viewUserId}
              onChange={(v) => {
                setViewUserId(v)
                setAgentId(null)
                resetPage()
              }}
              clearable
              size="xs"
              w={360}
            />
          </Group>
        </Card>
      )}

      {!hasAgents ? (
        <Card withBorder p="xl" radius="md">
          <Stack align="center" gap="sm">
            <TbActivity size={40} />
            <Text fw={500}>{viewUserId ? 'This user has no approved agents' : 'No approved agents yet'}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {viewUserId
                ? 'Select a different user above, or clear the filter to view your own activity.'
                : isAdmin && availableUsers.length > 0
                  ? 'You have no agents assigned to yourself, but other users do — pick one above to view their data.'
                  : 'Install pm-watch on your device and ask an admin to approve your agent. Once approved, events will show up here automatically.'}
            </Text>
          </Stack>
        </Card>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
            <StatCard
              label={isToday ? 'Today duration' : 'Selected date'}
              value={formatDuration(eventsTotalDuration)}
              sub={`${events.length} event${events.length === 1 ? '' : 's'}`}
              icon={<TbClock size={20} />}
              color="blue"
            />
            <StatCard
              label="Total (week)"
              value={summary ? formatDuration(summary.week.durationSec) : '—'}
              sub={summary ? `${summary.week.count} events last 7d` : null}
              icon={<TbActivity size={20} />}
              color="violet"
            />
            <StatCard
              label="Agents"
              value={String(agents.length)}
              sub={`${agents.reduce((a, b) => a + b._count.events, 0)} total events`}
              icon={<TbDeviceDesktop size={20} />}
              color="teal"
            />
            <StatCard
              label="Buckets"
              value={summary ? String(summary.byBucket.length) : '—'}
              sub={summary ? summary.byBucket[0]?.bucketId.replace(/_.+$/, '') : null}
              icon={<TbActivity size={20} />}
              color="orange"
            />
          </SimpleGrid>

          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" mb="xs">
              <Group gap="xs">
                <TbCalendar size={14} />
                <Title order={5}>Activity heatmap — {heatmapYear}</Title>
              </Group>
              <Group gap={4}>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => setHeatmapYear((y) => y - 1)}
                  aria-label="Previous year"
                >
                  ←
                </Button>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => setHeatmapYear(new Date().getFullYear())}
                  disabled={heatmapYear === new Date().getFullYear()}
                >
                  This year
                </Button>
                <Button
                  size="compact-xs"
                  variant="light"
                  onClick={() => setHeatmapYear((y) => y + 1)}
                  disabled={heatmapYear >= new Date().getFullYear()}
                  aria-label="Next year"
                >
                  →
                </Button>
              </Group>
            </Group>
            {hasHeatmapData ? (
              <>
                <ScrollArea type="auto" scrollbarSize={6}>
                  <div style={{ minWidth: 760 }}>
                    <EChart option={heatmapOption} height={180} onEvents={{ click: handleHeatmapClick }} />
                  </div>
                </ScrollArea>
                <Text size="xs" c="dimmed" mt={4} ta="center">
                  Click any day to drill into it below.
                </Text>
              </>
            ) : (
              <Center h={180}>
                <Text size="sm" c="dimmed">
                  {heatmapQ.isLoading ? 'Loading…' : `No activity recorded in ${heatmapYear}.`}
                </Text>
              </Center>
            )}
          </Card>

          <Card withBorder padding="md" radius="md">
            <Group align="flex-start" gap="lg" wrap="wrap">
              <Stack gap="xs">
                <Group gap="xs" justify="space-between">
                  <Group gap={6}>
                    <TbCalendar size={14} />
                    <Text size="sm" fw={500}>
                      Pick a date
                    </Text>
                  </Group>
                  <Button
                    size="compact-xs"
                    variant={isToday ? 'filled' : 'light'}
                    onClick={jumpToToday}
                    disabled={isToday}
                  >
                    Today
                  </Button>
                </Group>
                <DatePicker
                  value={selectedDate}
                  onChange={(d) => {
                    if (!d) return
                    const nd = toDate(d)
                    if (!nd) return
                    setSelectedDate(nd)
                    resetPage()
                  }}
                  date={calendarMonth}
                  onDateChange={(d) => {
                    const nd = toDate(d)
                    if (nd) setCalendarMonth(nd)
                  }}
                  renderDay={(dateInput) => {
                    const d = toDate(dateInput) ?? new Date()
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
                    const stats = calendarDays[key]
                    const day = d.getDate()
                    if (!stats || stats.durationSec === 0) {
                      return <div>{day}</div>
                    }
                    const hours = stats.durationSec / 3600
                    const color = hours >= 4 ? 'teal' : hours >= 1 ? 'blue' : 'gray'
                    return (
                      <Indicator size={6} color={color} offset={-2}>
                        <div>{day}</div>
                      </Indicator>
                    )
                  }}
                  size="sm"
                />
              </Stack>
              <Stack gap="xs" style={{ flex: 1, minWidth: 220 }}>
                <Group gap={6}>
                  <TbDeviceDesktop size={14} />
                  <Text size="sm" fw={500}>
                    Filter by agent
                  </Text>
                </Group>
                <Select
                  placeholder="All agents"
                  data={agents.map((a) => ({ value: a.id, label: `${a.hostname} (${a.osUser})` }))}
                  value={agentId}
                  onChange={(v) => {
                    setAgentId(v)
                    resetPage()
                  }}
                  clearable
                  size="xs"
                />
                <Divider my={4} />
                <Text size="xs" c="dimmed" fw={500}>
                  Viewing
                </Text>
                <Text size="sm" fw={600}>
                  {selectedDate.toLocaleDateString(undefined, {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
                <Group gap={6} wrap="wrap">
                  <Badge size="xs" variant="light" color="teal">
                    ≥4h
                  </Badge>
                  <Badge size="xs" variant="light" color="blue">
                    1–4h
                  </Badge>
                  <Badge size="xs" variant="light" color="gray">
                    &lt;1h
                  </Badge>
                  <Text size="xs" c="dimmed">
                    Calendar dots show activity per day.
                  </Text>
                </Group>
              </Stack>
            </Group>
          </Card>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card withBorder padding="md" radius="md">
              <Group justify="space-between" mb="sm">
                <Title order={5}>Hourly breakdown</Title>
                <Text size="xs" c="dimmed">
                  Top 5 apps, stacked
                </Text>
              </Group>
              {hasHourlyData ? (
                <EChart option={hourlyOption} height={220} />
              ) : (
                <Center h={220}>
                  <Text size="sm" c="dimmed">
                    No events recorded for this day.
                  </Text>
                </Center>
              )}
            </Card>
            <Card withBorder padding="md" radius="md">
              <Group justify="space-between" mb="sm">
                <Title order={5}>Daily trend</Title>
                <Text size="xs" c="dimmed">
                  {calendarMonthKey}
                </Text>
              </Group>
              {hasTrendData ? (
                <EChart option={trendOption} height={220} />
              ) : (
                <Center h={220}>
                  <Text size="sm" c="dimmed">
                    No activity this month.
                  </Text>
                </Center>
              )}
            </Card>
          </SimpleGrid>

          <Card withBorder padding="md" radius="md">
            <Group justify="space-between" mb="sm">
              <Title order={5}>App → window flow</Title>
              <Text size="xs" c="dimmed">
                Sankey of time spent per app / window title
              </Text>
            </Group>
            {hasSankeyData ? (
              <EChart option={sankeyOption} height={320} />
            ) : (
              <Center h={200}>
                <Text size="sm" c="dimmed">
                  Need app-tagged events to render the flow.
                </Text>
              </Center>
            )}
          </Card>

          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
            <Card withBorder padding="md" radius="md">
              <Title order={5} mb="sm">
                Top apps
              </Title>
              <TopList
                items={
                  summary?.topApps.map((a) => ({ label: a.app, durationSec: a.durationSec, count: a.count })) ?? []
                }
                emptyText="No app data in this window."
              />
            </Card>
            <Card withBorder padding="md" radius="md">
              <Title order={5} mb="sm">
                Top windows
              </Title>
              <TopList
                items={
                  summary?.topTitles.map((t) => ({
                    label: t.title || t.app,
                    sub: t.app,
                    durationSec: t.durationSec,
                    count: t.count,
                  })) ?? []
                }
                emptyText="No window titles recorded."
              />
            </Card>
          </SimpleGrid>

          <Card withBorder padding={0} radius="md">
            <Group justify="space-between" p="sm">
              <Title order={5}>Recent events</Title>
              <Group gap="xs">
                <Text size="xs" c="dimmed">
                  {events.length === 0
                    ? '0 events'
                    : `${(currentPage - 1) * pageSize + 1}–${Math.min(currentPage * pageSize, events.length)} of ${events.length}${events.length >= 1000 ? '+ (narrow range for older)' : ''}`}
                </Text>
                <Select
                  data={['10', '25', '50', '100'].map((v) => ({ value: v, label: `${v} / page` }))}
                  value={String(pageSize)}
                  onChange={(v) => {
                    if (!v) return
                    setPageSize(Number(v))
                    resetPage()
                  }}
                  size="xs"
                  w={110}
                />
              </Group>
            </Group>
            {events.length === 0 ? (
              <Text size="sm" c="dimmed" p="md">
                No events in this window.
              </Text>
            ) : (
              <>
                <Table verticalSpacing="xs" horizontalSpacing="md" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>When</Table.Th>
                      <Table.Th>Activity</Table.Th>
                      <Table.Th>Duration</Table.Th>
                      <Table.Th>Bucket</Table.Th>
                      <Table.Th>Device</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {pagedEvents.map((e) => {
                      const d = describeEvent(e)
                      return (
                        <Table.Tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => setDetailEvent(e)}>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {formatTime(e.timestamp)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" fw={500} lineClamp={1}>
                              {d.primary}
                            </Text>
                            {d.secondary ? (
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {d.secondary}
                              </Text>
                            ) : null}
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{formatDuration(e.duration)}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Badge size="xs" variant="light" color="gray">
                              {e.bucketId.replace(/_.+$/, '')}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {e.agent.hostname}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      )
                    })}
                  </Table.Tbody>
                </Table>
                {totalPages > 1 && (
                  <Center p="sm">
                    <Pagination
                      total={totalPages}
                      value={currentPage}
                      onChange={setPage}
                      size="sm"
                      withEdges
                      siblings={1}
                    />
                  </Center>
                )}
              </>
            )}
          </Card>
        </>
      )}

      <EventDetailModal event={detailEvent} onClose={() => setDetailEvent(null)} />
    </Stack>
  )
}

function EventDetailModal({ event, onClose }: { event: ActivityEvent | null; onClose: () => void }) {
  if (!event) {
    return <Modal opened={false} onClose={onClose} title="Event detail" />
  }
  const d = event.data ?? {}
  const app = typeof d.app === 'string' ? d.app : null
  const title = typeof d.title === 'string' ? d.title : null
  const url = typeof d.url === 'string' ? d.url : null
  const status = typeof d.status === 'string' ? d.status : null
  const endsAt = new Date(new Date(event.timestamp).getTime() + event.duration * 1000)
  const fields: Array<{ label: string; value: React.ReactNode }> = [
    { label: 'Event ID', value: <Code>{event.eventId}</Code> },
    { label: 'Bucket', value: <Code>{event.bucketId}</Code> },
    { label: 'Started', value: new Date(event.timestamp).toLocaleString() },
    { label: 'Ended', value: endsAt.toLocaleString() },
    { label: 'Duration', value: `${formatDuration(event.duration)} (${event.duration.toFixed(3)}s)` },
    { label: 'Device', value: `${event.agent.hostname} · ${event.agent.osUser}` },
  ]
  if (app) fields.push({ label: 'App', value: app })
  if (title) fields.push({ label: 'Title', value: title })
  if (url)
    fields.push({
      label: 'URL',
      value: (
        <Anchor href={url} target="_blank" rel="noreferrer" size="sm">
          {url}
        </Anchor>
      ),
    })
  if (status) fields.push({ label: 'AFK status', value: <Badge variant="light">{status}</Badge> })

  return (
    <Modal opened onClose={onClose} size="lg" title="Event detail">
      <Stack gap="sm">
        <Table withRowBorders={false} verticalSpacing={6}>
          <Table.Tbody>
            {fields.map((f) => (
              <Table.Tr key={f.label}>
                <Table.Td style={{ width: 120, verticalAlign: 'top' }}>
                  <Text size="xs" c="dimmed" fw={600} tt="uppercase">
                    {f.label}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text component="div" size="sm" style={{ wordBreak: 'break-word' }}>
                    {f.value}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Divider label="Raw data" labelPosition="left" />
        <ScrollArea.Autosize mah={300}>
          <Code block>{JSON.stringify(event.data, null, 2)}</Code>
        </ScrollArea.Autosize>
      </Stack>
    </Modal>
  )
}

function StatCard({
  label,
  value,
  sub,
  icon,
  color,
}: {
  label: string
  value: string
  sub: string | null | undefined
  icon: React.ReactNode
  color: string
}) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
            {label}
          </Text>
          <Text size="xl" fw={700} mt={4}>
            {value}
          </Text>
          {sub ? (
            <Text size="xs" c="dimmed" mt={2}>
              {sub}
            </Text>
          ) : null}
        </div>
        <Badge color={color} variant="light" size="lg" circle p={8}>
          {icon}
        </Badge>
      </Group>
    </Card>
  )
}

function TopList({
  items,
  emptyText,
}: {
  items: Array<{ label: string; sub?: string; durationSec: number; count: number }>
  emptyText: string
}) {
  if (items.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        {emptyText}
      </Text>
    )
  }
  const max = items[0]?.durationSec || 1
  return (
    <Stack gap="xs">
      {items.map((it) => (
        <div key={`${it.label}-${it.sub ?? ''}`}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" fw={500} lineClamp={1} style={{ flex: 1 }}>
              {it.label}
            </Text>
            <Text size="xs" c="dimmed">
              {formatDuration(it.durationSec)}
            </Text>
          </Group>
          {it.sub ? (
            <Text size="xs" c="dimmed" lineClamp={1}>
              {it.sub}
            </Text>
          ) : null}
          <Progress value={(it.durationSec / max) * 100} size="xs" mt={4} />
        </div>
      ))}
    </Stack>
  )
}
