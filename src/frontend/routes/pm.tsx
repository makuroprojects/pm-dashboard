import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Button,
  Card,
  Container,
  Divider,
  Group,
  NavLink,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import type { EChartsOption } from 'echarts'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  TbActivity,
  TbAlertTriangle,
  TbBell,
  TbBug,
  TbCalendarDue,
  TbCircleCheck,
  TbClockHour4,
  TbGhost2,
  TbLayoutDashboard,
  TbListCheck,
  TbMessage,
  TbPlus,
  TbSparkles,
  TbTarget,
  TbUserPlus,
  TbUsers,
} from 'react-icons/tb'
import { ActivityPanel } from '@/frontend/components/ActivityPanel'
import { EChart } from '@/frontend/components/charts/EChart'
import { NotificationBell } from '@/frontend/components/NotificationBell'
import { PROJECT_DETAIL_TABS, type ProjectDetailTab, ProjectDetailView } from '@/frontend/components/ProjectDetailView'
import { ProjectsPanel } from '@/frontend/components/ProjectsPanel'
import { SidebarAppSwitcher } from '@/frontend/components/SidebarAppSwitcher'
import { SidebarUserFooter } from '@/frontend/components/SidebarUserFooter'
import { InfoTip } from '@/frontend/components/shared/InfoTip'
import { TaskDetailView } from '@/frontend/components/TaskDetailView'
import { TasksPanel } from '@/frontend/components/TasksPanel'
import { TeamPanel } from '@/frontend/components/TeamPanel'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'

const validTabs = ['overview', 'projects', 'tasks', 'activity', 'team'] as const
type TabKey = (typeof validTabs)[number]

type PmSearch = { tab: TabKey; projectId?: string; detailTab?: ProjectDetailTab; taskId?: string }

export const Route = createFileRoute('/pm')({
  validateSearch: (search: Record<string, unknown>): PmSearch => {
    const tab = validTabs.includes(search.tab as TabKey) ? (search.tab as TabKey) : 'overview'
    const projectId = typeof search.projectId === 'string' ? search.projectId : undefined
    const detailTab = PROJECT_DETAIL_TABS.includes(search.detailTab as ProjectDetailTab)
      ? (search.detailTab as ProjectDetailTab)
      : undefined
    const taskId = typeof search.taskId === 'string' ? search.taskId : undefined
    const out: PmSearch = { tab }
    if (projectId) out.projectId = projectId
    if (detailTab) out.detailTab = detailTab
    if (taskId) out.taskId = taskId
    return out
  },
  beforeLoad: async ({ context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'session'],
        queryFn: () => fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()),
      })
      if (!data?.user) throw redirect({ to: '/login' })
      if (data.user.blocked) throw redirect({ to: '/blocked' })
    } catch (e) {
      if (e instanceof Error) throw redirect({ to: '/login' })
      throw e
    }
  },
  component: PmPage,
})

type NavItem = { label: string; description: string; icon: typeof TbLayoutDashboard; key: TabKey; badge?: string }

const navItems: NavItem[] = [
  { label: 'Ringkasan', description: 'KPI, overdue, prioritas', icon: TbLayoutDashboard, key: 'overview' },
  { label: 'Proyek', description: 'Kelola semua proyek', icon: TbTarget, key: 'projects' },
  { label: 'Task', description: 'Tugas kamu & tim', icon: TbListCheck, key: 'tasks' },
  { label: 'Aktivitas', description: 'Event ActivityWatch', icon: TbActivity, key: 'activity', badge: 'AW' },
  { label: 'Tim', description: 'Anggota & beban kerja', icon: TbUsers, key: 'team' },
]

const TAB_META: Record<TabKey, { label: string; description: string }> = {
  overview: {
    label: 'Ringkasan',
    description: 'KPI task kamu, overdue, deadline minggu ini, dan notifikasi terbaru.',
  },
  projects: {
    label: 'Proyek',
    description: 'Portfolio proyek yang kamu miliki atau ikuti. Buat, pantau, kelola deadline.',
  },
  tasks: {
    label: 'Task',
    description: 'Semua task di proyek kamu. Filter by assignee, status, tag, atau prioritas.',
  },
  activity: {
    label: 'Aktivitas',
    description: 'Event ActivityWatch dari pm-watch agent — pantau fokus kerja tim.',
  },
  team: {
    label: 'Tim',
    description: 'Anggota proyek dan beban kerja per user.',
  },
}

function PmPageHeader({ tabKey }: { tabKey: TabKey }) {
  const item = navItems.find((n) => n.key === tabKey)
  const meta = TAB_META[tabKey]
  const Icon = item?.icon ?? TbLayoutDashboard
  return (
    <>
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <ThemeIcon variant="light" color="blue" size="xl" radius="md">
          <Icon size={22} />
        </ThemeIcon>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: 0.6 }}>
              Manajer Proyek
            </Text>
            {item?.badge && (
              <Badge size="xs" variant="light" color="blue">
                {item.badge}
              </Badge>
            )}
          </Group>
          <Title order={3} style={{ lineHeight: 1.1 }}>
            {meta.label}
          </Title>
          <Text size="sm" c="dimmed">
            {meta.description}
          </Text>
        </Stack>
      </Group>
      <Divider />
    </>
  )
}

function PmPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { tab: active, projectId: activeProjectId, detailTab, taskId: activeTaskId } = Route.useSearch()
  const navigate = useNavigate()
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const isMobile = useMediaQuery('(max-width: 48em)')
  const scrollPositions = useRef<Partial<Record<TabKey, number>>>({})
  const previousTab = useRef<TabKey>(active)
  const setActive = (key: TabKey) => {
    scrollPositions.current[previousTab.current] = window.scrollY
    navigate({ to: '/pm', search: { tab: key } })
    closeMobile()
  }
  useEffect(() => {
    if (previousTab.current === active) return
    previousTab.current = active
    const saved = scrollPositions.current[active] ?? 0
    window.scrollTo({ top: saved, behavior: 'auto' })
  }, [active])
  const setTasksProjectFilter = (projectId: string | null) => {
    navigate({ to: '/pm', search: { tab: 'tasks', ...(projectId ? { projectId } : {}) } })
  }
  const setProjectDetailTab = (next: ProjectDetailTab) => {
    if (!activeProjectId) return
    navigate({ to: '/pm', search: { tab: 'projects', projectId: activeProjectId, detailTab: next } })
  }
  const closeProjectDetail = () => {
    navigate({ to: '/pm', search: { tab: 'projects' } })
  }
  const closeTaskDetail = () => {
    navigate({
      to: '/pm',
      search: activeProjectId ? { tab: 'tasks', projectId: activeProjectId } : { tab: 'tasks' },
    })
  }
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pm:sidebar') === 'collapsed')
  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('pm:sidebar', next ? 'collapsed' : 'open')
      return next
    })
  }
  const confirmLogout = () =>
    modals.openConfirmModal({
      title: 'Keluar',
      children: <Text size="sm">Yakin ingin keluar dari sesi ini?</Text>,
      labels: { confirm: 'Keluar', cancel: 'Batal' },
      confirmProps: { color: 'red' },
      onConfirm: () => logout.mutate(),
    })

  const desktopWidth = collapsed ? 60 : 260

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: desktopWidth,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      padding="md"
      styles={{
        navbar: { backgroundColor: 'var(--app-navbar-bg)' },
        header: { backgroundColor: 'var(--app-navbar-bg)' },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <ThemeIcon variant="light" color="blue" size="md">
              <TbTarget size={18} />
            </ThemeIcon>
            <Title order={4}>Manajer Proyek</Title>
          </Group>
          <Group gap="xs">
            <NotificationBell size="md" />
            <Badge color="blue" variant="light" size="sm">
              {user?.role}
            </Badge>
            <Text size="sm" visibleFrom="sm" c="dimmed">
              {user?.email}
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={collapsed && !isMobile ? 'xs' : 'md'}>
        <Stack gap="md" style={{ flex: 1, overflowY: 'auto' }}>
          <Stack gap={4}>
            {!(collapsed && !isMobile) && (
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }} px="xs" pt={4}>
                Manajer Proyek
              </Text>
            )}
            {navItems.map((item) => {
              const Icon = item.icon
              if (collapsed && !isMobile) {
                return (
                  <Tooltip
                    key={item.key}
                    label={
                      <Stack gap={0}>
                        <Text size="xs" fw={600}>
                          {item.label}
                          {item.badge ? ` · ${item.badge}` : ''}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {item.description}
                        </Text>
                      </Stack>
                    }
                    position="right"
                    withArrow
                  >
                    <ActionIcon
                      variant={active === item.key ? 'filled' : 'subtle'}
                      color={active === item.key ? 'blue' : 'gray'}
                      size="lg"
                      onClick={() => setActive(item.key)}
                    >
                      <Icon size={18} />
                    </ActionIcon>
                  </Tooltip>
                )
              }
              return (
                <NavLink
                  key={item.key}
                  label={item.label}
                  description={item.description}
                  leftSection={<Icon size={18} />}
                  rightSection={
                    item.badge ? (
                      <Badge size="xs" variant="light">
                        {item.badge}
                      </Badge>
                    ) : null
                  }
                  color="blue"
                  active={active === item.key}
                  onClick={() => setActive(item.key)}
                />
              )
            })}
          </Stack>

          <SidebarAppSwitcher current="pm" role={user?.role} collapsed={collapsed && !isMobile} />
        </Stack>

        <SidebarUserFooter
          user={user}
          collapsed={collapsed && !isMobile}
          onToggleCollapse={toggleSidebar}
          onLogout={confirmLogout}
          isLoggingOut={logout.isPending}
          accentColor="blue"
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <Container fluid px={0}>
          <Stack gap="md">
            {!activeProjectId && !activeTaskId && <PmPageHeader tabKey={active} />}
            <Box key={active}>
              {active === 'overview' && (
                <OverviewPanel
                  userName={user?.name ?? ''}
                  onGoToTasks={() => setActive('tasks')}
                  onGoToProjects={() => setActive('projects')}
                />
              )}
              {active === 'projects' &&
                (activeProjectId ? (
                  <ProjectDetailView
                    projectId={activeProjectId}
                    tab={detailTab ?? 'overview'}
                    onTabChange={setProjectDetailTab}
                    onBack={closeProjectDetail}
                    onDeleted={closeProjectDetail}
                  />
                ) : (
                  <ProjectsPanel />
                ))}
              {active === 'tasks' &&
                (activeTaskId ? (
                  <TaskDetailView taskId={activeTaskId} onBack={closeTaskDetail} />
                ) : (
                  <TasksPanel
                    projectId={activeProjectId}
                    onProjectChange={setTasksProjectFilter}
                    onBackToProjects={() => setActive('projects')}
                  />
                ))}
              {active === 'activity' && <ActivityPanel />}
              {active === 'team' && <TeamPanel />}
            </Box>
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

type OverviewTask = {
  id: string
  title: string
  status: 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
  kind: 'TASK' | 'BUG' | 'QC'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  dueAt: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  projectId: string
  project: { id: string; name: string } | null
}

type OverviewNotification = {
  id: string
  kind: 'TASK_ASSIGNED' | 'TASK_COMMENTED' | 'TASK_STATUS_CHANGED' | 'TASK_DUE_SOON' | 'TASK_OVERDUE' | 'TASK_MENTIONED'
  taskId: string | null
  projectId: string | null
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
  actor: { id: string; name: string; email: string } | null
}

const PRIORITY_COLOR: Record<OverviewTask['priority'], string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

const NOTIF_ICON: Record<OverviewNotification['kind'], typeof TbBell> = {
  TASK_ASSIGNED: TbUserPlus,
  TASK_COMMENTED: TbMessage,
  TASK_STATUS_CHANGED: TbActivity,
  TASK_DUE_SOON: TbCalendarDue,
  TASK_OVERDUE: TbAlertTriangle,
  TASK_MENTIONED: TbMessage,
}

const NOTIF_COLOR: Record<OverviewNotification['kind'], string> = {
  TASK_ASSIGNED: 'blue',
  TASK_COMMENTED: 'grape',
  TASK_STATUS_CHANGED: 'teal',
  TASK_DUE_SOON: 'orange',
  TASK_OVERDUE: 'red',
  TASK_MENTIONED: 'violet',
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const mins = Math.floor(abs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const suffix = diff >= 0 ? 'lalu' : 'lagi'
  if (days > 0) return `${days}h ${suffix}`
  if (hours > 0) return `${hours}j ${suffix}`
  if (mins > 0) return `${mins}m ${suffix}`
  return 'baru saja'
}

function formatDueLabel(iso: string): { label: string; color: string } {
  const diff = new Date(iso).getTime() - Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const days = Math.ceil(diff / dayMs)
  if (diff < 0) {
    const overdueDays = Math.abs(Math.floor(diff / dayMs))
    return { label: overdueDays === 0 ? 'Hari ini' : `Telat ${overdueDays}h`, color: 'red' }
  }
  if (days <= 1) return { label: 'Besok', color: 'orange' }
  if (days <= 3) return { label: `${days} hari`, color: 'orange' }
  return { label: `${days} hari`, color: 'blue' }
}

function OverviewPanel({
  userName,
  onGoToTasks,
  onGoToProjects,
}: {
  userName: string
  onGoToTasks: () => void
  onGoToProjects: () => void
}) {
  const navigate = useNavigate()
  const openTask = (t: OverviewTask) => {
    navigate({
      to: '/pm',
      search: { tab: 'tasks', taskId: t.id, ...(t.projectId ? { projectId: t.projectId } : {}) },
    })
  }

  const projectsQ = useQuery<{
    projects: Array<{ id: string; name?: string; archivedAt: string | null; _count: { tasks: number } }>
  }>({
    queryKey: ['projects'],
    queryFn: () => fetch('/api/projects', { credentials: 'include' }).then((r) => r.json()),
  })
  const openTasksQ = useQuery<{ tasks: Array<{ id: string; kind: string }> }>({
    queryKey: ['tasks', 'status=OPEN'],
    queryFn: () => fetch('/api/tasks?status=OPEN', { credentials: 'include' }).then((r) => r.json()),
  })
  const myTasksQ = useQuery<{ tasks: OverviewTask[] }>({
    queryKey: ['tasks', 'mine=1', 'overview'],
    queryFn: () => fetch('/api/tasks?mine=1&limit=300', { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 60_000,
  })
  const notifsQ = useQuery<{ notifications: OverviewNotification[] }>({
    queryKey: ['me', 'notifications', 'overview'],
    queryFn: () => fetch('/api/me/notifications?limit=10', { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 60_000,
  })

  const projects = projectsQ.data?.projects ?? []
  const activeProjects = projects.filter((p) => !p.archivedAt)
  const openTasks = openTasksQ.data?.tasks ?? []
  const openBugs = openTasks.filter((t) => t.kind === 'BUG').length
  const myTasks = myTasksQ.data?.tasks ?? []
  const activeMine = myTasks.filter((t) => t.status !== 'CLOSED')

  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)
  const todayCutoff = endOfToday.getTime()

  const overdue = activeMine
    .filter((t) => t.dueAt && new Date(t.dueAt).getTime() <= todayCutoff)
    .sort((a, b) => +new Date(a.dueAt as string) - +new Date(b.dueAt as string))
  const dueSoon = activeMine
    .filter((t) => {
      if (!t.dueAt) return false
      const due = new Date(t.dueAt).getTime()
      return due > todayCutoff && due <= now + 7 * dayMs
    })
    .sort((a, b) => +new Date(a.dueAt as string) - +new Date(b.dueAt as string))
  const ghost = activeMine
    .filter((t) => t.status === 'IN_PROGRESS' && new Date(t.updatedAt).getTime() < now - 3 * dayMs)
    .sort((a, b) => +new Date(a.updatedAt) - +new Date(b.updatedAt))

  const weekAgo = now - 7 * dayMs
  const closedThisWeek = myTasks.filter((t) => t.closedAt && new Date(t.closedAt).getTime() > weekAgo)
  const bugsAssignedThisWeek = myTasks.filter((t) => t.kind === 'BUG' && new Date(t.createdAt).getTime() > weekAgo)
  const inProgressCount = activeMine.filter((t) => t.status === 'IN_PROGRESS').length
  const notifs = notifsQ.data?.notifications ?? []

  const statusDonutOption = useMemo(() => {
    const buckets: Record<OverviewTask['status'], number> = {
      OPEN: 0,
      IN_PROGRESS: 0,
      READY_FOR_QC: 0,
      REOPENED: 0,
      CLOSED: 0,
    }
    for (const t of activeMine) buckets[t.status]++
    const total = activeMine.length
    return {
      tooltip: { trigger: 'item', formatter: '{b}: <b>{c}</b> ({d}%)' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11 } },
      series: [
        {
          type: 'pie',
          radius: ['55%', '80%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: true,
          label: {
            show: true,
            position: 'center',
            formatter: () => `{n|${total}}\n{l|aktif}`,
            rich: {
              n: { fontSize: 22, fontWeight: 700, color: 'var(--mantine-color-text)' },
              l: { fontSize: 10, color: 'var(--mantine-color-dimmed)', padding: [4, 0, 0, 0] },
            },
          },
          data: [
            { name: 'Open', value: buckets.OPEN, itemStyle: { color: '#228be6' } },
            { name: 'In Progress', value: buckets.IN_PROGRESS, itemStyle: { color: '#7950f2' } },
            { name: 'Ready for QC', value: buckets.READY_FOR_QC, itemStyle: { color: '#fab005' } },
            { name: 'Reopened', value: buckets.REOPENED, itemStyle: { color: '#fd7e14' } },
          ],
        },
      ],
    } as EChartsOption
  }, [activeMine])

  const closedTrendOption = useMemo(() => {
    const days: Array<{ key: string; label: string; count: number }> = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days.push({ key, label: key.slice(5), count: 0 })
    }
    const index = new Map(days.map((d, i) => [d.key, i]))
    for (const t of myTasks) {
      if (!t.closedAt) continue
      const d = new Date(t.closedAt)
      d.setHours(0, 0, 0, 0)
      const i = index.get(d.toISOString().slice(0, 10))
      if (i !== undefined) days[i].count++
    }
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 28, right: 12, top: 10, bottom: 22 },
      xAxis: { type: 'category', data: days.map((d) => d.label), axisLabel: { fontSize: 9 } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 9 } },
      series: [
        {
          type: 'bar',
          data: days.map((d) => d.count),
          itemStyle: { color: '#20c997', borderRadius: [3, 3, 0, 0] },
          barWidth: '60%',
        },
      ],
    } as EChartsOption
  }, [myTasks])

  const dueBarOption = useMemo(() => {
    const buckets = { Telat: 0, 'Hari ini': 0, '1–3h': 0, '4–7h': 0, '>7h': 0, 'Tanpa deadline': 0 }
    for (const t of activeMine) {
      if (!t.dueAt) {
        buckets['Tanpa deadline']++
        continue
      }
      const diffDays = Math.ceil((new Date(t.dueAt).getTime() - now) / dayMs)
      if (diffDays < 0) buckets.Telat++
      else if (diffDays === 0) buckets['Hari ini']++
      else if (diffDays <= 3) buckets['1–3h']++
      else if (diffDays <= 7) buckets['4–7h']++
      else buckets['>7h']++
    }
    const labels = Object.keys(buckets)
    const palette = ['#fa5252', '#fd7e14', '#fab005', '#228be6', '#868e96', '#adb5bd']
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 90, right: 24, top: 10, bottom: 22 },
      xAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 9 } },
      yAxis: { type: 'category', data: labels, axisLabel: { fontSize: 10 } },
      series: [
        {
          type: 'bar',
          data: labels.map((k, i) => ({
            value: buckets[k as keyof typeof buckets],
            itemStyle: { color: palette[i], borderRadius: [0, 3, 3, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10 },
          barWidth: '55%',
        },
      ],
    } as EChartsOption
  }, [activeMine, now])

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Halo, {userName.split(' ')[0]}</Title>
        <Text c="dimmed" size="sm">
          Ringkasan proyek kamu. Mulai proyek, pantau task, dan lihat pipeline bergerak.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
        <StatCard
          label="Proyek Aktif"
          value={String(activeProjects.length)}
          icon={TbTarget}
          color="blue"
          tip="Proyek dengan status ACTIVE — belum ARCHIVED/COMPLETED. Termasuk proyek yang kamu miliki atau jadi member di dalamnya."
        />
        <StatCard
          label="Task Terbuka"
          value={String(openTasks.length)}
          icon={TbListCheck}
          color="orange"
          tip="Task dengan status OPEN, IN_PROGRESS, READY_FOR_QC, atau REOPENED di semua proyek yang kamu lihat. CLOSED tidak dihitung."
        />
        <StatCard
          label="Bug Terbuka"
          value={String(openBugs)}
          icon={TbBug}
          color="red"
          tip="Subset Task Terbuka dengan kind=BUG. Prioritaskan ini — bug aktif berdampak ke user."
        />
        <StatCard
          label="Ditugaskan ke Saya"
          value={String(activeMine.length)}
          icon={TbActivity}
          color="grape"
          tip="Task aktif dengan assigneeId = kamu. Ini yang benar-benar kamu pegang sekarang. Lihat tab Task untuk detail."
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
        <ChartMini
          title="Status Task Saya"
          subtitle={`${activeMine.length} task aktif`}
          option={statusDonutOption}
          height={180}
          tip="Breakdown status task yang ditugaskan ke kamu: OPEN (belum dikerjakan), IN_PROGRESS (sedang jalan), READY_FOR_QC (menunggu review), REOPENED (dibuka kembali)."
        />
        <ChartMini
          title="Ditutup 14 Hari Terakhir"
          subtitle={`${closedThisWeek.length} ditutup 7h terakhir`}
          option={closedTrendOption}
          height={180}
          tip="Jumlah task kamu yang transisi ke CLOSED per hari, 14 hari terakhir. Momentum delivery — tren turun = velocity drop."
        />
        <ChartMini
          title="Jadwal Task"
          subtitle="Distribusi deadline task aktif"
          option={dueBarOption}
          height={180}
          tip="Task aktif dikelompokkan by dueAt: Telat (overdue), Hari Ini, Besok, Minggu Ini, Nanti, Tanpa Tenggat. Bar panjang di Telat = alarm."
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Stack gap="lg">
          <SectionCard
            title="Perlu Perhatian Kamu"
            subtitle="Task yang sudah lewat deadline atau jatuh tempo hari ini."
            icon={TbAlertTriangle}
            color="red"
            count={overdue.length}
            loading={myTasksQ.isLoading}
            emptyMessage="Tidak ada task yang telat. Keren!"
            tip="Task kamu dengan dueAt < sekarang dan belum CLOSED. Top 5 ditampilkan — klik untuk buka detail. Selesaikan atau minta extension."
            action={
              overdue.length > 0 ? (
                <Button variant="subtle" size="xs" onClick={onGoToTasks}>
                  Semua task
                </Button>
              ) : null
            }
          >
            {overdue.slice(0, 5).map((t) => (
              <TaskRow key={t.id} task={t} onOpen={openTask} />
            ))}
          </SectionCard>

          <SectionCard
            title="Jatuh Tempo 7 Hari ke Depan"
            subtitle="Task yang akan jatuh tempo dalam seminggu ke depan."
            icon={TbCalendarDue}
            color="orange"
            count={dueSoon.length}
            loading={myTasksQ.isLoading}
            emptyMessage="Minggu depan kosong. Manfaatkan untuk nyicil task lain."
            tip="Task kamu dengan dueAt dalam 7 hari ke depan. Early-warning — kalau banyak, mulai cicil sekarang supaya tidak jadi overdue minggu depan."
          >
            {dueSoon.slice(0, 5).map((t) => (
              <TaskRow key={t.id} task={t} onOpen={openTask} />
            ))}
          </SectionCard>

          <SectionCard
            title="Ghost Reminder"
            subtitle="Task In Progress yang tidak kamu sentuh dalam 3 hari terakhir."
            icon={TbGhost2}
            color="gray"
            count={ghost.length}
            loading={myTasksQ.isLoading}
            emptyMessage="Tidak ada task yang mangkrak. Momentum bagus."
            tip="Task kamu dengan status IN_PROGRESS tapi updatedAt > 3 hari yang lalu. Kemungkinan lupa update status atau stuck — tinjau dan tentukan nasibnya."
          >
            {ghost.slice(0, 5).map((t) => (
              <TaskRow key={t.id} task={t} onOpen={openTask} showStale />
            ))}
          </SectionCard>
        </Stack>

        <Stack gap="lg">
          <Paper withBorder p="lg" radius="md">
            <Group gap="xs" mb="md">
              <ThemeIcon variant="light" color="teal" size="md" radius="md">
                <TbSparkles size={16} />
              </ThemeIcon>
              <div style={{ flex: 1 }}>
                <Group gap="xs">
                  <Title order={5}>Snapshot Minggu Ini</Title>
                  <InfoTip
                    label="Rangkuman kilat 7 hari terakhir: task kamu yang closed, yang in-progress sekarang, bug yang baru ditugaskan ke kamu, dan total task aktif. Quick pulse check sebelum standup."
                    size={12}
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  Rangkuman aktivitas kamu 7 hari terakhir.
                </Text>
              </div>
            </Group>
            <SimpleGrid cols={2} spacing="sm">
              <MiniStat
                label="Task Selesai"
                value={closedThisWeek.length}
                icon={TbCircleCheck}
                color="teal"
                tip="Task kamu yang transisi ke CLOSED dalam 7 hari terakhir. Output delivery — indikator velocity individu."
              />
              <MiniStat
                label="Sedang Dikerjakan"
                value={inProgressCount}
                icon={TbClockHour4}
                color="blue"
                tip="Task kamu dengan status IN_PROGRESS saat ini. Idealnya fokus di 1–3 — terlalu banyak = context switching."
              />
              <MiniStat
                label="Bug Baru"
                value={bugsAssignedThisWeek.length}
                icon={TbBug}
                color="red"
                tip="Task kind=BUG yang ditugaskan ke kamu dalam 7 hari terakhir (berdasarkan createdAt). Incoming workload dari QC/reporter."
              />
              <MiniStat
                label="Total Ditugaskan"
                value={activeMine.length}
                icon={TbListCheck}
                color="grape"
                tip="Total task aktif (non-CLOSED) yang ditugaskan ke kamu. Jika angka naik terus, waktunya bicara dengan PM tentang kapasitas."
              />
            </SimpleGrid>
            {closedThisWeek.length > 0 && (
              <>
                <Divider my="md" />
                <Text size="xs" c="dimmed" mb="xs" fw={500}>
                  SELESAI MINGGU INI
                </Text>
                <Stack gap={4}>
                  {closedThisWeek.slice(0, 3).map((t) => (
                    <UnstyledButton
                      key={t.id}
                      onClick={() => openTask(t)}
                      style={{ borderRadius: 6, padding: '4px 8px' }}
                    >
                      <Group gap="xs" wrap="nowrap">
                        <TbCircleCheck size={14} color="var(--mantine-color-teal-6)" />
                        <Text size="sm" truncate>
                          {t.title}
                        </Text>
                      </Group>
                    </UnstyledButton>
                  ))}
                </Stack>
              </>
            )}
          </Paper>

          <SectionCard
            title="Aktivitas Terbaru"
            subtitle="Notifikasi terbaru tentang task kamu."
            icon={TbBell}
            color="blue"
            count={notifs.filter((n) => !n.readAt).length}
            countLabel="belum dibaca"
            loading={notifsQ.isLoading}
            emptyMessage="Belum ada aktivitas. Kerjaan sunyi — bagus!"
            tip="Notifikasi terbaru: komentar, assignment, status change, mention. Yang belum dibaca disorot biru. Klik untuk loncat ke task/proyek terkait."
          >
            {notifs.slice(0, 6).map((n) => {
              const Icon = NOTIF_ICON[n.kind] ?? TbBell
              const color = NOTIF_COLOR[n.kind] ?? 'gray'
              return (
                <UnstyledButton
                  key={n.id}
                  onClick={() => {
                    if (n.taskId) {
                      navigate({
                        to: '/pm',
                        search: {
                          tab: 'tasks',
                          taskId: n.taskId,
                          ...(n.projectId ? { projectId: n.projectId } : {}),
                        },
                      })
                    } else if (n.projectId) {
                      navigate({ to: '/pm', search: { tab: 'projects', projectId: n.projectId } })
                    }
                  }}
                  style={{
                    borderRadius: 6,
                    padding: '8px 10px',
                    backgroundColor: n.readAt ? 'transparent' : 'var(--mantine-color-blue-light)',
                  }}
                >
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color={color} size="sm" radius="xl">
                      <Icon size={12} />
                    </ThemeIcon>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={n.readAt ? 400 : 500} truncate>
                        {n.title}
                      </Text>
                      {n.body && (
                        <Text size="xs" c="dimmed" truncate>
                          {n.body}
                        </Text>
                      )}
                      <Text size="xs" c="dimmed">
                        {formatRelativeTime(n.createdAt)}
                      </Text>
                    </div>
                  </Group>
                </UnstyledButton>
              )
            })}
          </SectionCard>
        </Stack>
      </SimpleGrid>

      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Group gap="xs">
            <Title order={5}>Proyek Kamu</Title>
            <InfoTip
              label="Daftar singkat proyek aktif yang kamu miliki atau ikuti. Max 5 ditampilkan. Klik nama proyek untuk buka detail, atau 'Kelola' untuk lihat semua di tab Proyek."
              size={12}
            />
          </Group>
          <Group gap="xs">
            <Button variant="subtle" size="xs" onClick={onGoToTasks}>
              Lihat task
            </Button>
            <Button leftSection={<TbPlus size={14} />} size="xs" onClick={onGoToProjects}>
              Kelola
            </Button>
          </Group>
        </Group>
        {activeProjects.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            Belum ada proyek aktif. Buat satu dari tab Proyek.
          </Text>
        ) : (
          <Stack gap="xs">
            {activeProjects.slice(0, 5).map((p) => (
              <UnstyledButton
                key={p.id}
                onClick={() => navigate({ to: '/pm', search: { tab: 'projects', projectId: p.id } })}
                style={{ borderRadius: 6, padding: '8px 12px' }}
              >
                <Group justify="space-between">
                  <Text size="sm">{p.name ?? p.id.slice(0, 8)}</Text>
                  <Badge size="xs" variant="light">
                    {p._count.tasks} task
                  </Badge>
                </Group>
              </UnstyledButton>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}

function SectionCard({
  title,
  subtitle,
  icon: Icon,
  color,
  count,
  countLabel,
  loading,
  emptyMessage,
  action,
  tip,
  children,
}: {
  title: string
  subtitle?: string
  icon: typeof TbBell
  color: string
  count: number
  countLabel?: string
  loading?: boolean
  emptyMessage: string
  action?: React.ReactNode
  tip?: string
  children: React.ReactNode
}) {
  return (
    <Paper withBorder p="lg" radius="md">
      <Group justify="space-between" mb="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap">
          <ThemeIcon variant="light" color={color} size="md" radius="md">
            <Icon size={16} />
          </ThemeIcon>
          <div>
            <Group gap="xs">
              <Title order={5}>{title}</Title>
              {count > 0 && (
                <Badge color={color} variant="light" size="sm">
                  {count}
                  {countLabel ? ` ${countLabel}` : ''}
                </Badge>
              )}
              {tip && <InfoTip label={tip} size={12} />}
            </Group>
            {subtitle && (
              <Text size="xs" c="dimmed">
                {subtitle}
              </Text>
            )}
          </div>
        </Group>
        {action}
      </Group>
      {loading ? (
        <Text size="sm" c="dimmed" ta="center" py="md">
          Memuat…
        </Text>
      ) : count === 0 ? (
        <Text size="sm" c="dimmed" ta="center" py="md">
          {emptyMessage}
        </Text>
      ) : (
        <Stack gap={4}>{children}</Stack>
      )}
    </Paper>
  )
}

function TaskRow({
  task,
  onOpen,
  showStale,
}: {
  task: OverviewTask
  onOpen: (t: OverviewTask) => void
  showStale?: boolean
}) {
  const due = task.dueAt ? formatDueLabel(task.dueAt) : null
  const staleFor = showStale ? formatRelativeTime(task.updatedAt) : null
  return (
    <UnstyledButton onClick={() => onOpen(task)} style={{ borderRadius: 6, padding: '8px 10px' }}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Badge color={PRIORITY_COLOR[task.priority]} variant="dot" size="sm" style={{ flexShrink: 0, marginTop: 2 }}>
          {task.kind}
        </Badge>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="sm" fw={500} truncate>
            {task.title}
          </Text>
          <Group gap={6} wrap="nowrap">
            {task.project?.name && (
              <Text size="xs" c="dimmed" truncate>
                {task.project.name}
              </Text>
            )}
            {staleFor && (
              <Text size="xs" c="dimmed">
                · diam {staleFor}
              </Text>
            )}
          </Group>
        </div>
        {due && (
          <Badge color={due.color} variant="light" size="sm" style={{ flexShrink: 0 }}>
            {due.label}
          </Badge>
        )}
      </Group>
    </UnstyledButton>
  )
}

function ChartMini({
  title,
  subtitle,
  option,
  height = 180,
  tip,
}: {
  title: string
  subtitle?: string
  option: Parameters<typeof EChart>[0]['option']
  height?: number
  tip?: string
}) {
  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap={2} mb={4}>
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
      </Stack>
      <EChart option={option} height={height} />
    </Card>
  )
}

function MiniStat({
  label,
  value,
  icon: Icon,
  color,
  tip,
}: {
  label: string
  value: number
  icon: typeof TbBell
  color: string
  tip?: string
}) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon variant="light" color={color} size="md" radius="md">
          <Icon size={16} />
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" fw={500}>
              {label}
            </Text>
            {tip && <InfoTip label={tip} size={11} />}
          </Group>
          <Text fw={700} size="lg">
            {value}
          </Text>
        </div>
      </Group>
    </Card>
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
  icon: typeof TbLayoutDashboard
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
