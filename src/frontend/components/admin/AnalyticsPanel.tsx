import { ActionIcon, Card, Container, Group, SimpleGrid, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { useMemo } from 'react'
import { TbCheck, TbClock, TbListCheck, TbRefresh, TbTarget } from 'react-icons/tb'
import { EChart } from '../charts/EChart'

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'

interface AnalyticsTask {
  id: string
  status: TaskStatus
  createdAt: string
  closedAt: string | null
  startsAt: string | null
  assignee: { id: string; name: string } | null
  project: { id: string; name: string }
}

interface AnalyticsProject {
  id: string
  status: ProjectStatus
  name: string
}

const WINDOW_DAYS = 30

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function buildDayBuckets(days: number): string[] {
  const keys: string[] = []
  const today = startOfDay(new Date())
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    keys.push(dayKey(d))
  }
  return keys
}

export function AnalyticsPanel() {
  const {
    data: tasksData,
    isFetching: tasksFetching,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: ['admin', 'analytics', 'tasks'],
    queryFn: () =>
      fetch('/api/tasks?limit=500', { credentials: 'include' }).then((r) => r.json()) as Promise<{
        tasks: AnalyticsTask[]
      }>,
  })

  const {
    data: projectsData,
    isFetching: projectsFetching,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ['admin', 'analytics', 'projects'],
    queryFn: () =>
      fetch('/api/projects', { credentials: 'include' }).then((r) => r.json()) as Promise<{
        projects: AnalyticsProject[]
      }>,
  })

  const tasks = tasksData?.tasks ?? []
  const projects = projectsData?.projects ?? []

  const windowStartMs = useMemo(() => {
    const d = startOfDay(new Date())
    d.setDate(d.getDate() - (WINDOW_DAYS - 1))
    return d.getTime()
  }, [])

  const stats = useMemo(() => {
    const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length
    const openTasks = tasks.filter((t) => t.status !== 'CLOSED').length
    const closed30 = tasks.filter((t) => t.closedAt && new Date(t.closedAt).getTime() >= windowStartMs)
    const cycleDays = closed30
      .map((t) => {
        const start = new Date(t.startsAt ?? t.createdAt).getTime()
        const end = new Date(t.closedAt as string).getTime()
        return (end - start) / (1000 * 60 * 60 * 24)
      })
      .filter((x) => Number.isFinite(x) && x >= 0)
    const avgCycle = cycleDays.length > 0 ? cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length : 0
    return {
      activeProjects,
      openTasks,
      closed30: closed30.length,
      avgCycleDays: Math.round(avgCycle * 10) / 10,
    }
  }, [projects, tasks, windowStartMs])

  const trendOption = useMemo<EChartsOption>(() => {
    const days = buildDayBuckets(WINDOW_DAYS)
    const opened = new Map<string, number>(days.map((k) => [k, 0]))
    const closed = new Map<string, number>(days.map((k) => [k, 0]))
    for (const t of tasks) {
      const created = dayKey(startOfDay(new Date(t.createdAt)))
      if (opened.has(created)) opened.set(created, (opened.get(created) ?? 0) + 1)
      if (t.closedAt) {
        const c = dayKey(startOfDay(new Date(t.closedAt)))
        if (closed.has(c)) closed.set(c, (closed.get(c) ?? 0) + 1)
      }
    }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Opened', 'Closed'], top: 0 },
      grid: { left: 40, right: 16, top: 32, bottom: 28 },
      xAxis: {
        type: 'category',
        data: days.map((d) => d.slice(5)),
        axisLabel: { fontSize: 10 },
      },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: 'Opened',
          type: 'line',
          smooth: true,
          data: days.map((k) => opened.get(k) ?? 0),
          itemStyle: { color: '#228be6' },
          areaStyle: { opacity: 0.15 },
        },
        {
          name: 'Closed',
          type: 'line',
          smooth: true,
          data: days.map((k) => closed.get(k) ?? 0),
          itemStyle: { color: '#40c057' },
          areaStyle: { opacity: 0.15 },
        },
      ],
    }
  }, [tasks])

  const contributorsOption = useMemo<EChartsOption>(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (!t.closedAt || !t.assignee) continue
      if (new Date(t.closedAt).getTime() < windowStartMs) continue
      counts.set(t.assignee.name, (counts.get(t.assignee.name) ?? 0) + 1)
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reverse()
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 100, right: 24, top: 16, bottom: 28 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: {
        type: 'category',
        data: sorted.map(([name]) => name),
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map(([, n]) => n),
          itemStyle: { color: '#7950f2', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10 },
        },
      ],
    }
  }, [tasks, windowStartMs])

  const statusOption = useMemo<EChartsOption>(() => {
    const buckets: Record<TaskStatus, number> = {
      OPEN: 0,
      IN_PROGRESS: 0,
      READY_FOR_QC: 0,
      REOPENED: 0,
      CLOSED: 0,
    }
    for (const t of tasks) buckets[t.status]++
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '45%'],
          avoidLabelOverlap: true,
          label: { show: false },
          data: [
            { name: 'Open', value: buckets.OPEN, itemStyle: { color: '#228be6' } },
            { name: 'In Progress', value: buckets.IN_PROGRESS, itemStyle: { color: '#7950f2' } },
            { name: 'Ready for QC', value: buckets.READY_FOR_QC, itemStyle: { color: '#fab005' } },
            { name: 'Reopened', value: buckets.REOPENED, itemStyle: { color: '#fd7e14' } },
            { name: 'Closed', value: buckets.CLOSED, itemStyle: { color: '#40c057' } },
          ],
        },
      ],
    }
  }, [tasks])

  const projectWipOption = useMemo<EChartsOption>(() => {
    const counts = new Map<string, number>()
    for (const t of tasks) {
      if (t.status === 'CLOSED') continue
      counts.set(t.project.name, (counts.get(t.project.name) ?? 0) + 1)
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .reverse()
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 140, right: 24, top: 16, bottom: 28 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: {
        type: 'category',
        data: sorted.map(([name]) => name),
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map(([, n]) => n),
          itemStyle: { color: '#228be6', borderRadius: [0, 4, 4, 0] },
          label: { show: true, position: 'right', fontSize: 10 },
        },
      ],
    }
  }, [tasks])

  const refetchAll = () => {
    refetchTasks()
    refetchProjects()
  }

  return (
    <Container size="xl" px={0}>
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={3}>Analytics</Title>
            <Text size="sm" c="dimmed">
              Window {WINDOW_DAYS} hari terakhir. Data di-cap 500 task per fetch.
            </Text>
          </div>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={refetchAll} loading={tasksFetching || projectsFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
          <StatCard label="Active Projects" value={stats.activeProjects.toString()} icon={TbTarget} color="blue" />
          <StatCard label="Open Tasks" value={stats.openTasks.toString()} icon={TbListCheck} color="violet" />
          <StatCard label={`Closed (${WINDOW_DAYS}d)`} value={stats.closed30.toString()} icon={TbCheck} color="green" />
          <StatCard
            label="Avg Cycle"
            value={stats.avgCycleDays > 0 ? `${stats.avgCycleDays}d` : '—'}
            icon={TbClock}
            color="orange"
          />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <ChartCard title="Opened vs Closed" subtitle={`Per day, last ${WINDOW_DAYS} days`}>
            <EChart option={trendOption} height={260} />
          </ChartCard>
          <ChartCard title="Task Status" subtitle="All tasks by status">
            <EChart option={statusOption} height={260} />
          </ChartCard>
          <ChartCard title="Top Contributors" subtitle={`Closed tasks, last ${WINDOW_DAYS} days`}>
            <EChart option={contributorsOption} height={280} />
          </ChartCard>
          <ChartCard title="WIP by Project" subtitle="Open tasks per project (top 10)">
            <EChart option={projectWipOption} height={280} />
          </ChartCard>
        </SimpleGrid>
      </Stack>
    </Container>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: typeof TbTarget
  color: string
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            {label}
          </Text>
          <Text fw={700} size="xl">
            {value}
          </Text>
        </div>
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          <Icon size={20} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="xs">
        <div>
          <Text fw={600} size="sm">
            {title}
          </Text>
          {subtitle && (
            <Text size="xs" c="dimmed">
              {subtitle}
            </Text>
          )}
        </div>
        {children}
      </Stack>
    </Card>
  )
}
