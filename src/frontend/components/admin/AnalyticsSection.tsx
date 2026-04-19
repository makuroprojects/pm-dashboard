import { Badge, Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core'
import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { TbCalendarEvent, TbChartDonut, TbChartLine, TbTimeline } from 'react-icons/tb'
import { EChart } from '../charts/EChart'

type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface AnalyticsData {
  timestamp: string
  projectsByStatus: Partial<Record<ProjectStatus, number>>
  tasksByStatus: Partial<Record<TaskStatus, number>>
  timeline: Array<{
    id: string
    name: string
    status: ProjectStatus
    priority: Priority
    owner: string
    startsAt: string | null
    endsAt: string | null
    originalEndAt: string | null
    slipped: boolean
  }>
  deadlineGroups: {
    endingSoon: DeadlineFuture[]
    endingMonth: DeadlineFuture[]
    pastDue: DeadlinePast[]
  }
  taskTrend: Array<{ date: string; created: number; closed: number }>
}

interface DeadlineFuture {
  id: string
  name: string
  status: ProjectStatus
  priority: Priority
  owner: string
  endsAt: string | null
  daysUntil: number | null
}

interface DeadlinePast {
  id: string
  name: string
  status: ProjectStatus
  priority: Priority
  owner: string
  endsAt: string | null
  daysOverdue: number | null
}

const PRIORITY_COLOR: Record<Priority, string> = {
  LOW: '#868e96',
  MEDIUM: '#228be6',
  HIGH: '#fd7e14',
  CRITICAL: '#fa5252',
}

const PRIORITY_BADGE: Record<Priority, string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

const PROJECT_STATUS_COLOR: Record<ProjectStatus, string> = {
  DRAFT: '#868e96',
  ACTIVE: '#12b886',
  ON_HOLD: '#fd7e14',
  COMPLETED: '#228be6',
  CANCELLED: '#495057',
}

const TASK_STATUS_COLOR: Record<TaskStatus, string> = {
  OPEN: '#228be6',
  IN_PROGRESS: '#fd7e14',
  READY_FOR_QC: '#9775fa',
  REOPENED: '#fa5252',
  CLOSED: '#12b886',
}

export function AnalyticsSection({ data }: { data: AnalyticsData }) {
  return (
    <Stack gap="md">
      <TimelineBlock timeline={data.timeline} />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <StatusDonuts projectsByStatus={data.projectsByStatus} tasksByStatus={data.tasksByStatus} />
        <TaskTrendBlock trend={data.taskTrend} />
      </SimpleGrid>
      <DeadlineGroupsBlock groups={data.deadlineGroups} />
    </Stack>
  )
}

function TimelineBlock({ timeline }: { timeline: AnalyticsData['timeline'] }) {
  const option = useMemo<EChartsOption | null>(() => {
    if (timeline.length === 0) return null
    const now = Date.now()
    const rows = timeline.slice().reverse()
    const names = rows.map((p) => p.name)
    const min = rows
      .map((p) => (p.startsAt ? new Date(p.startsAt).getTime() : null))
      .filter((n): n is number => n !== null)
    const max = rows.map((p) => (p.endsAt ? new Date(p.endsAt).getTime() : null)).filter((n): n is number => n !== null)
    const xMin = min.length > 0 ? Math.min(...min, now) : now - 30 * 86_400_000
    const xMax = max.length > 0 ? Math.max(...max, now) : now + 30 * 86_400_000

    const bars = rows.map((p, idx) => {
      const start = p.startsAt ? new Date(p.startsAt).getTime() : now
      const end = p.endsAt ? new Date(p.endsAt).getTime() : now + 7 * 86_400_000
      return {
        name: p.name,
        value: [idx, start, end, p.status, p.priority, p.owner, p.slipped],
        itemStyle: { color: PRIORITY_COLOR[p.priority], opacity: p.status === 'ON_HOLD' ? 0.45 : 0.9 },
      }
    })

    return {
      grid: { left: 150, right: 20, top: 10, bottom: 30, containLabel: false },
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { value: [number, number, number, string, string, string, boolean]; name: string }
          const [, s, e, status, priority, owner, slipped] = p.value
          const fmt = (t: number) => new Date(t).toLocaleDateString()
          return `<b>${p.name}</b><br/>${fmt(s)} → ${fmt(e)}<br/>status: ${status} · priority: ${priority}<br/>owner: ${owner}${slipped ? '<br/><span style="color:#fa5252">⚠ slipped (extended)</span>' : ''}`
        },
      },
      xAxis: {
        type: 'time',
        min: xMin,
        max: xMax,
        splitLine: { show: true },
      },
      yAxis: {
        type: 'category',
        data: names,
        axisLabel: { fontSize: 11, width: 140, overflow: 'truncate' },
      },
      series: [
        {
          type: 'custom',
          renderItem: ((_params: unknown, api: unknown) => {
            const a = api as {
              value: (idx: number) => number
              coord: (pt: [number, number]) => [number, number]
              size: (vals: [number, number]) => [number, number]
            }
            const categoryIdx = a.value(0)
            const startTs = a.value(1)
            const endTs = a.value(2)
            const startPt = a.coord([startTs, categoryIdx])
            const endPt = a.coord([endTs, categoryIdx])
            const height = a.size([0, 1])[1] * 0.55
            return {
              type: 'rect' as const,
              shape: { x: startPt[0], y: startPt[1] - height / 2, width: Math.max(2, endPt[0] - startPt[0]), height },
              style: { fill: (bars[categoryIdx]?.itemStyle as { color: string } | undefined)?.color ?? '#228be6' },
            }
          }) as never,
          encode: { x: [1, 2], y: 0 },
          data: bars,
        },
        {
          type: 'line',
          markLine: {
            symbol: 'none',
            lineStyle: { color: '#fa5252', width: 2, type: 'dashed' },
            label: { formatter: 'today', position: 'insideEndTop', color: '#fa5252', fontSize: 10 },
            data: [{ xAxis: now }],
          },
          data: [],
        },
      ],
    } satisfies EChartsOption
  }, [timeline])

  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="indigo" size="md" radius="md">
          <TbTimeline size={16} />
        </ThemeIcon>
        <Title order={5}>Project timeline</Title>
        <Text size="xs" c="dimmed">
          active projects · today marker
        </Text>
      </Group>
      {timeline.length === 0 || !option ? (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          Belum ada project aktif dengan jadwal.
        </Text>
      ) : (
        <EChart option={option} height={Math.max(160, timeline.length * 28 + 60)} />
      )}
    </Card>
  )
}

function StatusDonuts({
  projectsByStatus,
  tasksByStatus,
}: {
  projectsByStatus: AnalyticsData['projectsByStatus']
  tasksByStatus: AnalyticsData['tasksByStatus']
}) {
  const projectData = Object.entries(projectsByStatus).map(([status, count]) => ({
    name: status,
    value: count as number,
    itemStyle: { color: PROJECT_STATUS_COLOR[status as ProjectStatus] ?? '#868e96' },
  }))
  const taskData = Object.entries(tasksByStatus).map(([status, count]) => ({
    name: status,
    value: count as number,
    itemStyle: { color: TASK_STATUS_COLOR[status as TaskStatus] ?? '#868e96' },
  }))

  const buildOption = (data: typeof projectData, title: string): EChartsOption => ({
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: { bottom: 0, left: 'center', icon: 'circle', textStyle: { fontSize: 11 } },
    title: { text: title, left: 'center', top: 6, textStyle: { fontSize: 12, fontWeight: 'normal' } },
    series: [
      {
        type: 'pie',
        radius: ['45%', '68%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        label: { show: false },
        labelLine: { show: false },
        data,
      },
    ],
  })

  const hasProject = projectData.some((d) => d.value > 0)
  const hasTask = taskData.some((d) => d.value > 0)

  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="grape" size="md" radius="md">
          <TbChartDonut size={16} />
        </ThemeIcon>
        <Title order={5}>Status breakdown</Title>
      </Group>
      <SimpleGrid cols={2} spacing="xs">
        {hasProject ? (
          <EChart option={buildOption(projectData, 'Projects')} height={200} />
        ) : (
          <EmptyMini label="Projects" />
        )}
        {hasTask ? <EChart option={buildOption(taskData, 'Tasks')} height={200} /> : <EmptyMini label="Tasks" />}
      </SimpleGrid>
    </Card>
  )
}

function EmptyMini({ label }: { label: string }) {
  return (
    <Stack align="center" justify="center" h={200} gap={4}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="xs" c="dimmed">
        no data
      </Text>
    </Stack>
  )
}

function TaskTrendBlock({ trend }: { trend: AnalyticsData['taskTrend'] }) {
  const option = useMemo<EChartsOption>(() => {
    const dates = trend.map((t) => t.date.slice(5))
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, left: 'center', icon: 'circle', textStyle: { fontSize: 11 } },
      grid: { left: 36, right: 16, top: 24, bottom: 40 },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { fontSize: 10, interval: Math.max(0, Math.ceil(dates.length / 10) - 1) },
      },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 10 } },
      series: [
        {
          name: 'Created',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: '#228be6' },
          itemStyle: { color: '#228be6' },
          areaStyle: { color: 'rgba(34,139,230,0.12)' },
          data: trend.map((t) => t.created),
        },
        {
          name: 'Closed',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2, color: '#12b886' },
          itemStyle: { color: '#12b886' },
          areaStyle: { color: 'rgba(18,184,134,0.12)' },
          data: trend.map((t) => t.closed),
        },
      ],
    }
  }, [trend])

  const totalCreated = trend.reduce((n, t) => n + t.created, 0)
  const totalClosed = trend.reduce((n, t) => n + t.closed, 0)
  const hasData = totalCreated + totalClosed > 0

  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" justify="space-between" mb="sm">
        <Group gap="xs">
          <ThemeIcon variant="light" color="blue" size="md" radius="md">
            <TbChartLine size={16} />
          </ThemeIcon>
          <Title order={5}>Task trend</Title>
          <Text size="xs" c="dimmed">
            last {trend.length} days
          </Text>
        </Group>
        <Group gap="xs">
          <Badge size="xs" variant="light" color="blue">
            {totalCreated} created
          </Badge>
          <Badge size="xs" variant="light" color="teal">
            {totalClosed} closed
          </Badge>
        </Group>
      </Group>
      {hasData ? (
        <EChart option={option} height={200} />
      ) : (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          Belum ada aktivitas task di window ini.
        </Text>
      )}
    </Card>
  )
}

function DeadlineGroupsBlock({ groups }: { groups: AnalyticsData['deadlineGroups'] }) {
  const total = groups.endingSoon.length + groups.endingMonth.length + groups.pastDue.length
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="orange" size="md" radius="md">
          <TbCalendarEvent size={16} />
        </ThemeIcon>
        <Title order={5}>Deadline groups</Title>
        <Text size="xs" c="dimmed">
          grouped by endsAt
        </Text>
      </Group>
      {total === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="lg">
          Tidak ada project dengan deadline aktif.
        </Text>
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
          <DeadlineColumn title="Past-due" color="red" rows={groups.pastDue} variant="past" />
          <DeadlineColumn title="Ending < 7d" color="orange" rows={groups.endingSoon} variant="future" />
          <DeadlineColumn title="Ending 7–30d" color="blue" rows={groups.endingMonth} variant="future" />
        </SimpleGrid>
      )}
    </Card>
  )
}

function DeadlineColumn({
  title,
  color,
  rows,
  variant,
}: {
  title: string
  color: string
  rows: Array<DeadlineFuture | DeadlinePast>
  variant: 'future' | 'past'
}) {
  return (
    <Stack gap={6}>
      <Group gap="xs" justify="space-between">
        <Text size="xs" fw={500} tt="uppercase" c={color}>
          {title}
        </Text>
        <Badge size="xs" variant="light" color={color}>
          {rows.length}
        </Badge>
      </Group>
      {rows.length === 0 ? (
        <Text size="xs" c="dimmed">
          —
        </Text>
      ) : (
        rows.slice(0, 6).map((p) => {
          const days =
            variant === 'past'
              ? `${(p as DeadlinePast).daysOverdue ?? 0}d past`
              : `${(p as DeadlineFuture).daysUntil ?? 0}d left`
          return (
            <Group key={p.id} gap={4} wrap="nowrap" align="flex-start">
              <Badge size="xs" color={PRIORITY_BADGE[p.priority] ?? 'gray'} variant="outline">
                {p.priority}
              </Badge>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="xs" fw={500} truncate>
                  {p.name}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {p.owner}
                </Text>
              </div>
              <Text size="xs" c={variant === 'past' ? 'red' : 'dimmed'} style={{ whiteSpace: 'nowrap' }}>
                {days}
              </Text>
            </Group>
          )
        })
      )}
    </Stack>
  )
}
