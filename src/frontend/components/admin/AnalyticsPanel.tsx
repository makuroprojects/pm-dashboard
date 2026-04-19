import {
  ActionIcon,
  Card,
  Group,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import { TbCheck, TbClock, TbListCheck, TbRefresh, TbTarget } from 'react-icons/tb'
import { EChart } from '../charts/EChart'
import { InfoTip } from '../shared/InfoTip'

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'

interface AnalyticsTask {
  id: string
  title: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  closedAt: string | null
  startsAt: string | null
  dueAt: string | null
  assignee: { id: string; name: string } | null
  project: { id: string; name: string }
}

interface AnalyticsProject {
  id: string
  status: ProjectStatus
  name: string
}

interface OverviewAnalytics {
  projectsByStatus: Record<string, number>
  tasksByStatus: Record<string, number>
  taskTrend: Array<{ date: string; created: number; closed: number }>
  timeline: Array<{
    id: string
    name: string
    status: ProjectStatus
    startsAt: string | null
    endsAt: string | null
    originalEndAt: string | null
    slipped: boolean
  }>
  deadlineGroups: {
    endingSoon: Array<{ id: string; name: string; daysUntil: number | null }>
    endingMonth: Array<{ id: string; name: string; daysUntil: number | null }>
    pastDue: Array<{ id: string; name: string; daysOverdue: number | null }>
  }
}

const WINDOW_OPTIONS = [
  { label: '7 hari', value: '7' },
  { label: '30 hari', value: '30' },
  { label: '90 hari', value: '90' },
]

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function AnalyticsPanel() {
  const [windowDays, setWindowDays] = useState<'7' | '30' | '90'>('30')
  const days = Number(windowDays)

  const {
    data: overviewData,
    isFetching: overviewFetching,
    refetch: refetchOverview,
  } = useQuery({
    queryKey: ['admin', 'analytics', 'overview', days],
    queryFn: () =>
      fetch(`/api/admin/overview/analytics?trendDays=${days}&timelineLimit=20`, {
        credentials: 'include',
      }).then((r) => r.json()) as Promise<OverviewAnalytics>,
  })

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
    d.setDate(d.getDate() - (days - 1))
    return d.getTime()
  }, [days])

  const stats = useMemo(() => {
    const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length
    const openTasks = tasks.filter((t) => t.status !== 'CLOSED').length
    const closedInWindow = tasks.filter((t) => t.closedAt && new Date(t.closedAt).getTime() >= windowStartMs)
    const cycleDays = closedInWindow
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
      closedInWindow: closedInWindow.length,
      avgCycleDays: Math.round(avgCycle * 10) / 10,
    }
  }, [projects, tasks, windowStartMs])

  const trendOption = useMemo<EChartsOption>(() => {
    const trend = overviewData?.taskTrend ?? []
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Dibuka', 'Ditutup'], top: 0 },
      grid: { left: 40, right: 16, top: 32, bottom: 28 },
      xAxis: {
        type: 'category',
        data: trend.map((t) => t.date.slice(5)),
        axisLabel: { fontSize: 10 },
      },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: 'Dibuka',
          type: 'line',
          smooth: true,
          data: trend.map((t) => t.created),
          itemStyle: { color: '#228be6' },
          areaStyle: { opacity: 0.15 },
        },
        {
          name: 'Ditutup',
          type: 'line',
          smooth: true,
          data: trend.map((t) => t.closed),
          itemStyle: { color: '#40c057' },
          areaStyle: { opacity: 0.15 },
        },
      ],
    }
  }, [overviewData])

  const statusOption = useMemo<EChartsOption>(() => {
    const buckets = overviewData?.tasksByStatus ?? {}
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
            { name: 'Open', value: buckets.OPEN ?? 0, itemStyle: { color: '#228be6' } },
            { name: 'In Progress', value: buckets.IN_PROGRESS ?? 0, itemStyle: { color: '#7950f2' } },
            { name: 'Ready for QC', value: buckets.READY_FOR_QC ?? 0, itemStyle: { color: '#fab005' } },
            { name: 'Reopened', value: buckets.REOPENED ?? 0, itemStyle: { color: '#fd7e14' } },
            { name: 'Closed', value: buckets.CLOSED ?? 0, itemStyle: { color: '#40c057' } },
          ],
        },
      ],
    }
  }, [overviewData])

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

  const cycleBucketsOption = useMemo<EChartsOption>(() => {
    const buckets = { '≤1d': 0, '1–3d': 0, '3–7d': 0, '1–2w': 0, '2w–1m': 0, '>1m': 0 }
    for (const t of tasks) {
      if (!t.closedAt) continue
      if (new Date(t.closedAt).getTime() < windowStartMs) continue
      const start = new Date(t.startsAt ?? t.createdAt).getTime()
      const end = new Date(t.closedAt).getTime()
      const d = (end - start) / (1000 * 60 * 60 * 24)
      if (!Number.isFinite(d) || d < 0) continue
      if (d <= 1) buckets['≤1d']++
      else if (d <= 3) buckets['1–3d']++
      else if (d <= 7) buckets['3–7d']++
      else if (d <= 14) buckets['1–2w']++
      else if (d <= 30) buckets['2w–1m']++
      else buckets['>1m']++
    }
    const labels = Object.keys(buckets)
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 40, right: 16, top: 16, bottom: 28 },
      xAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          type: 'bar',
          data: labels.map((k) => buckets[k as keyof typeof buckets]),
          itemStyle: {
            color: (p: { dataIndex: number }) => {
              const palette = ['#40c057', '#51cf66', '#94d82d', '#fab005', '#fd7e14', '#fa5252']
              return palette[p.dataIndex] ?? '#868e96'
            },
            borderRadius: [4, 4, 0, 0],
          },
          label: { show: true, position: 'top', fontSize: 10 },
        },
      ],
    }
  }, [tasks, windowStartMs])

  const agingWipOption = useMemo<EChartsOption>(() => {
    const now = Date.now()
    const open = tasks
      .filter((t) => t.status !== 'CLOSED')
      .map((t) => {
        const anchor = new Date(t.updatedAt ?? t.createdAt).getTime()
        return {
          title: t.title,
          project: t.project.name,
          status: t.status,
          ageDays: Math.max(0, Math.round((now - anchor) / (1000 * 60 * 60 * 24))),
        }
      })
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 12)
      .reverse()
    const statusColor: Record<TaskStatus, string> = {
      OPEN: '#228be6',
      IN_PROGRESS: '#7950f2',
      READY_FOR_QC: '#fab005',
      REOPENED: '#fd7e14',
      CLOSED: '#40c057',
    }
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = params as Array<{ dataIndex: number; value: number; name: string }>
          const row = open[arr[0].dataIndex]
          if (!row) return ''
          return `<b>${row.title}</b><br/>${row.project}<br/>${row.status} · ${row.ageDays} hari`
        },
      },
      grid: { left: 140, right: 48, top: 16, bottom: 28 },
      xAxis: { type: 'value', name: 'hari', nameTextStyle: { fontSize: 10 } },
      yAxis: {
        type: 'category',
        data: open.map((r) => (r.title.length > 22 ? `${r.title.slice(0, 22)}…` : r.title)),
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          type: 'bar',
          data: open.map((r) => ({ value: r.ageDays, itemStyle: { color: statusColor[r.status] } })),
          label: { show: true, position: 'right', fontSize: 10, formatter: '{c}d' },
          itemStyle: { borderRadius: [0, 4, 4, 0] },
        },
      ],
    }
  }, [tasks])

  const throughputHeatmapOption = useMemo<EChartsOption>(() => {
    const trend = overviewData?.taskTrend ?? []
    if (trend.length === 0) return { series: [] }
    const first = new Date(trend[0].date)
    const firstDow = first.getDay()
    const weeks: Array<Array<{ date: string; closed: number } | null>> = []
    let week: Array<{ date: string; closed: number } | null> = new Array(firstDow).fill(null)
    for (const t of trend) {
      week.push({ date: t.date, closed: t.closed })
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null)
      weeks.push(week)
    }
    const data: Array<[number, number, number]> = []
    let max = 0
    const cellDate = new Map<string, string>()
    for (let wi = 0; wi < weeks.length; wi++) {
      const w = weeks[wi]
      for (let di = 0; di < w.length; di++) {
        const cell = w[di]
        if (!cell) continue
        data.push([wi, 6 - di, cell.closed])
        if (cell.closed > max) max = cell.closed
        cellDate.set(`${wi},${6 - di}`, cell.date)
      }
    }
    const dayLabels = ['Min', 'Sab', 'Jum', 'Kam', 'Rab', 'Sel', 'Sen']
    return {
      tooltip: {
        formatter: (params: unknown) => {
          const p = params as { data: [number, number, number] }
          const date = cellDate.get(`${p.data[0]},${p.data[1]}`) ?? ''
          return `${date}<br/><b>${p.data[2]}</b> task ditutup`
        },
      },
      grid: { left: 40, right: 16, top: 16, bottom: 24 },
      xAxis: {
        type: 'category',
        data: weeks.map((_, i) => `W${i + 1}`),
        splitArea: { show: true },
        axisLabel: { fontSize: 9 },
      },
      yAxis: {
        type: 'category',
        data: dayLabels,
        splitArea: { show: true },
        axisLabel: { fontSize: 10 },
      },
      visualMap: {
        min: 0,
        max: Math.max(1, max),
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        show: false,
        inRange: { color: ['#e9ecef', '#74c0fc', '#228be6', '#1864ab'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          label: { show: false },
          itemStyle: { borderRadius: 2, borderWidth: 1, borderColor: 'var(--mantine-color-body)' },
        },
      ],
    }
  }, [overviewData])

  const timelineOption = useMemo<EChartsOption>(() => {
    const rows = overviewData?.timeline ?? []
    if (rows.length === 0) return { series: [] }
    const parse = (s: string | null) => (s ? new Date(s).getTime() : null)
    const items = rows
      .map((r) => {
        const start = parse(r.startsAt)
        const end = parse(r.endsAt)
        if (!start || !end) return null
        return { name: r.name, start, end, slipped: r.slipped, status: r.status }
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => a.end - b.end)
      .slice(0, 12)
    if (items.length === 0) return { series: [] }
    const minMs = Math.min(...items.map((i) => i.start))
    const maxMs = Math.max(...items.map((i) => i.end), Date.now())
    const statusColor: Record<string, string> = {
      ACTIVE: '#228be6',
      ON_HOLD: '#fab005',
      DRAFT: '#868e96',
    }
    return {
      tooltip: {
        formatter: (params: unknown) => {
          const p = params as { name: string; value: [number, number, number] }
          const item = items[p.value[0]]
          if (!item) return ''
          const s = new Date(item.start).toISOString().slice(0, 10)
          const e = new Date(item.end).toISOString().slice(0, 10)
          return `<b>${item.name}</b><br/>${s} → ${e}${item.slipped ? '<br/><b style="color:#fd7e14">Slipped</b>' : ''}`
        },
      },
      grid: { left: 140, right: 24, top: 16, bottom: 28 },
      xAxis: {
        type: 'time',
        min: minMs,
        max: maxMs,
        axisLabel: { fontSize: 9 },
      },
      yAxis: {
        type: 'category',
        data: items.map((i) => (i.name.length > 18 ? `${i.name.slice(0, 18)}…` : i.name)),
        axisLabel: { fontSize: 10 },
      },
      series: [
        {
          type: 'custom',
          renderItem: (_params, api) => {
            const idx = Number(api.value(0))
            const start = api.coord([Number(api.value(1)), idx])
            const end = api.coord([Number(api.value(2)), idx])
            const height = (api.size?.([0, 1]) as number[] | undefined)?.[1] ?? 20
            const barH = height * 0.6
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - barH / 2, width: end[0] - start[0], height: barH },
              style: {
                fill: items[idx]?.slipped ? '#fd7e14' : (statusColor[items[idx]?.status ?? 'ACTIVE'] ?? '#228be6'),
                opacity: 0.85,
              },
            }
          },
          encode: { x: [1, 2], y: 0 },
          data: items.map((i, idx) => ({ value: [idx, i.start, i.end] })),
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ xAxis: Date.now() }],
            lineStyle: { color: '#fa5252', width: 2, type: 'dashed' },
            label: { show: false },
          },
        },
      ],
    } as EChartsOption
  }, [overviewData])

  const refetchAll = () => {
    refetchOverview()
    refetchTasks()
    refetchProjects()
  }

  const isFetching = overviewFetching || tasksFetching || projectsFetching

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <div>
          <Group gap="xs">
            <Title order={3}>Analitik</Title>
            <InfoTip
              width={360}
              label="Dashboard metrik portfolio-wide: throughput (create vs close), distribusi status, cycle time, aging WIP, timeline project. Data trend & heatmap di-agregat di server; per-task chart di-cap 500 terbaru."
            />
          </Group>
          <Text size="sm" c="dimmed">
            Data di-cap 500 task untuk per-task chart. Trend & heatmap di-agregat di server.
          </Text>
        </div>
        <Group gap="sm">
          <Tooltip label="Rentang waktu untuk trend, heatmap, dan cycle distribution. 7d = 1 minggu, 30d = 1 bulan, 90d = 3 bulan.">
            <SegmentedControl
              size="xs"
              value={windowDays}
              onChange={(v) => setWindowDays(v as '7' | '30' | '90')}
              data={WINDOW_OPTIONS}
            />
          </Tooltip>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={refetchAll} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatCard
          label="Proyek Aktif"
          value={stats.activeProjects.toString()}
          icon={TbTarget}
          color="blue"
          tip="Jumlah project dengan status ACTIVE. Proyek DRAFT / ON_HOLD / COMPLETED / CANCELLED tidak dihitung."
        />
        <StatCard
          label="Task Terbuka"
          value={stats.openTasks.toString()}
          icon={TbListCheck}
          color="violet"
          tip="Task dengan status selain CLOSED (OPEN / IN_PROGRESS / READY_FOR_QC / REOPENED)."
        />
        <StatCard
          label={`Ditutup (${days}h)`}
          value={stats.closedInWindow.toString()}
          icon={TbCheck}
          color="green"
          tip={`Task dengan closedAt dalam ${days} hari terakhir. Indikator velocity tim.`}
        />
        <StatCard
          label="Avg Cycle"
          value={stats.avgCycleDays > 0 ? `${stats.avgCycleDays}h` : '—'}
          icon={TbClock}
          color="orange"
          tip="Rata-rata durasi (hari) antara startsAt dan closedAt untuk task CLOSED. Semakin kecil = tim lebih responsif."
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <ChartCard
          title="Throughput"
          subtitle={`Dibuka vs ditutup, ${days} hari terakhir`}
          tip="Jumlah task dibuka (biru) vs ditutup (hijau) per hari. Line sejajar = velocity sustainable; create >> close = backlog menumpuk."
        >
          <EChart option={trendOption} height={260} />
        </ChartCard>
        <ChartCard
          title="Status Task"
          subtitle="Seluruh task"
          tip="Pie distribusi task per status OPEN / IN_PROGRESS / READY_FOR_QC / REOPENED / CLOSED. Lihat bottleneck: READY_FOR_QC menumpuk = QC lambat, REOPENED banyak = quality issue."
        >
          <EChart option={statusOption} height={260} />
        </ChartCard>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <ChartCard
          title="Heatmap Task Ditutup"
          subtitle={`${days} hari — intensitas per hari`}
          tip="Grid kalender: warna lebih gelap = lebih banyak task ditutup pada hari itu. Deteksi pola kerja mingguan (mis. sprint Jumat) atau blank spot (libur, blocked)."
        >
          <EChart option={throughputHeatmapOption} height={220} />
        </ChartCard>
        <ChartCard
          title="Distribusi Cycle Time"
          subtitle={`Task CLOSED di ${days} hari, bucket durasi`}
          tip="Histogram durasi dari startsAt ke closedAt, bucket: ≤1h, 1–3h, 3–7h, 1–2w, 2w–1bln, >1bln. Tail panjang = ada task molor panjang."
        >
          <EChart option={cycleBucketsOption} height={220} />
        </ChartCard>
      </SimpleGrid>

      <ChartCard
        title="Timeline Proyek"
        subtitle="Garis merah = hari ini · oranye = endsAt mundur dari rencana"
        tip="Gantt chart startsAt → endsAt tiap proyek ACTIVE. Bar biru = on schedule, oranye = slipped (endsAt sudah dimundurkan dari originalEndAt via extension)."
      >
        <EChart option={timelineOption} height={320} />
      </ChartCard>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <ChartCard
          title="Aging WIP"
          subtitle="Task terbuka paling lama tidak bergerak (top 12)"
          tip="Top 12 task non-CLOSED dengan updatedAt terlama. Kandidat kuat untuk ditutup, di-split, atau di-close sebagai wont-fix."
        >
          <EChart option={agingWipOption} height={320} />
        </ChartCard>
        <ChartCard
          title="WIP per Proyek"
          subtitle="Task terbuka per proyek (top 10)"
          tip="Project dengan jumlah task non-CLOSED paling banyak. WIP tinggi = fokus terpecah; pertimbangkan limit WIP per project."
        >
          <EChart option={projectWipOption} height={320} />
        </ChartCard>
      </SimpleGrid>

      <ChartCard
        title="Kontributor Teratas"
        subtitle={`Task ditutup, ${days} hari terakhir (top 10)`}
        tip="User dengan jumlah task CLOSED terbanyak di window. Proxy untuk kontribusi output; bukan ukuran kualitas atau kompleksitas."
      >
        <EChart option={contributorsOption} height={320} />
      </ChartCard>
    </Stack>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  tip,
}: {
  label: string
  value: string
  icon: typeof TbTarget
  color: string
  tip?: string
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start">
        <div style={{ flex: 1 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" fw={500} tt="uppercase">
              {label}
            </Text>
            {tip && <InfoTip label={tip} size={12} />}
          </Group>
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

function ChartCard({
  title,
  subtitle,
  tip,
  children,
}: {
  title: string
  subtitle?: string
  tip?: string
  children: React.ReactNode
}) {
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="xs">
        <div>
          <Group gap={4} wrap="nowrap">
            <Text fw={600} size="sm">
              {title}
            </Text>
            {tip && <InfoTip label={tip} size={12} />}
          </Group>
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
