import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Container,
  Group,
  NavLink,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import {
  TbClipboardList,
  TbClockHour3,
  TbHeartbeat,
  TbLayoutDashboard,
  TbListCheck,
  TbPlugConnected,
  TbReportAnalytics,
  TbShieldLock,
  TbTarget,
  TbUsers,
} from 'react-icons/tb'
import { AnalyticsPanel } from '@/frontend/components/admin/AnalyticsPanel'
import { AuditLogsPanel } from '@/frontend/components/admin/AuditLogsPanel'
import { EffortPanel } from '@/frontend/components/admin/EffortPanel'
import { OverviewPanel } from '@/frontend/components/admin/OverviewPanel'
import { ProjectsOverviewPanel } from '@/frontend/components/admin/ProjectsOverviewPanel'
import { SessionsPanel } from '@/frontend/components/admin/SessionsPanel'
import { SystemHealthPanel } from '@/frontend/components/admin/SystemHealthPanel'
import { TaskTriagePanel } from '@/frontend/components/admin/TaskTriagePanel'
import { UsersPanel } from '@/frontend/components/admin/UsersPanel'
import { NotificationBell } from '@/frontend/components/NotificationBell'
import { SidebarAppSwitcher } from '@/frontend/components/SidebarAppSwitcher'
import { SidebarUserFooter } from '@/frontend/components/SidebarUserFooter'
import { SectionErrorBoundary } from '@/frontend/components/shared/SectionErrorBoundary'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'
import { useNavBadges } from '@/frontend/hooks/useNavBadges'

const validTabs = [
  'overview',
  'users',
  'audit-logs',
  'projects',
  'tasks',
  'effort',
  'analytics',
  'sessions',
  'health',
] as const
type TabKey = (typeof validTabs)[number]

export const Route = createFileRoute('/admin')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: validTabs.includes(search.tab as TabKey) ? (search.tab as TabKey) : 'overview',
  }),
  beforeLoad: async ({ context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'session'],
        queryFn: () => fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()),
      })
      if (!data?.user) throw redirect({ to: '/login' })
      if (data.user.blocked) throw redirect({ to: '/blocked' })
      if (data.user.role !== 'ADMIN' && data.user.role !== 'SUPER_ADMIN') {
        throw redirect({ to: '/pm', search: { tab: 'overview' } })
      }
    } catch (e) {
      if (e instanceof Error) throw redirect({ to: '/login' })
      throw e
    }
  },
  component: AdminPage,
})

type NavItem = {
  label: string
  icon: typeof TbLayoutDashboard
  key: TabKey
  badgeKey?: 'pastDueProjects' | 'overdueTasks' | 'offlineAgents' | 'missingEnv'
  badgeColor?: string
}

type NavGroup = { label: string; items: NavItem[] }

const navGroups: NavGroup[] = [
  {
    label: 'Pantau',
    items: [
      { label: 'Ringkasan', icon: TbLayoutDashboard, key: 'overview' },
      { label: 'Proyek', icon: TbTarget, key: 'projects', badgeKey: 'pastDueProjects', badgeColor: 'red' },
      { label: 'Triase Task', icon: TbListCheck, key: 'tasks', badgeKey: 'overdueTasks', badgeColor: 'orange' },
      { label: 'Effort', icon: TbClockHour3, key: 'effort' },
      { label: 'Analitik', icon: TbReportAnalytics, key: 'analytics' },
    ],
  },
  {
    label: 'Manajemen',
    items: [
      { label: 'Pengguna', icon: TbUsers, key: 'users' },
      { label: 'Log Audit', icon: TbClipboardList, key: 'audit-logs' },
      { label: 'Sesi', icon: TbPlugConnected, key: 'sessions' },
    ],
  },
  {
    label: 'Sistem',
    items: [{ label: 'Kesehatan Sistem', icon: TbHeartbeat, key: 'health', badgeKey: 'missingEnv', badgeColor: 'red' }],
  },
]

const TAB_META: Record<TabKey, { label: string; description: string }> = {
  overview: {
    label: 'Ringkasan',
    description: 'Red flags, kesehatan portfolio, beban tim, dan KPI sistem.',
  },
  users: {
    label: 'Pengguna',
    description: 'Kelola role dan status akses anggota sistem.',
  },
  'audit-logs': {
    label: 'Log Audit',
    description: 'Jejak aktivitas login, perubahan role, dan aksi admin.',
  },
  projects: {
    label: 'Proyek',
    description: 'Pantau status, kesehatan, dan deadline setiap proyek.',
  },
  tasks: {
    label: 'Triase Task',
    description: 'Task overdue, tanpa assignee, terblokir, atau stale.',
  },
  effort: {
    label: 'Effort',
    description: 'Estimasi vs aktual, ghost task, dan phantom work per user.',
  },
  analytics: {
    label: 'Analitik',
    description: 'Throughput, cycle time, WIP, dan timeline proyek.',
  },
  sessions: {
    label: 'Sesi',
    description: 'Sesi login aktif dan status online lintas user.',
  },
  health: {
    label: 'Kesehatan Sistem',
    description: 'Env vars, agents, webhook, dan retensi log.',
  },
}

function AdminPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { tab: active } = Route.useSearch()
  const navigate = useNavigate()
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const isMobile = useMediaQuery('(max-width: 48em)')
  const scrollPositions = useRef<Partial<Record<TabKey, number>>>({})
  const previousTab = useRef<TabKey>(active)
  const setActive = (key: TabKey) => {
    scrollPositions.current[previousTab.current] = window.scrollY
    navigate({ to: '/admin', search: { tab: key } })
    closeMobile()
  }
  useEffect(() => {
    if (previousTab.current === active) return
    previousTab.current = active
    const saved = scrollPositions.current[active] ?? 0
    window.scrollTo({ top: saved, behavior: 'auto' })
  }, [active])
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('admin:sidebar') === 'collapsed')
  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('admin:sidebar', next ? 'collapsed' : 'open')
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
  const badges = useNavBadges(true)

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: desktopWidth, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
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
            <ThemeIcon variant="light" color="violet" size="md">
              <TbShieldLock size={18} />
            </ThemeIcon>
            <Title order={4}>Konsol Admin</Title>
          </Group>
          <Group gap="xs">
            <NotificationBell size="md" />
            <Badge color="violet" variant="light" size="sm">
              {user?.role}
            </Badge>
            <Text size="sm" visibleFrom="sm" c="dimmed">
              {user?.email}
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={collapsed && !isMobile ? 'xs' : 'md'}>
        <Stack gap={collapsed && !isMobile ? 'xs' : 'md'} style={{ flex: 1, overflowY: 'auto' }}>
          {navGroups.map((group) => (
            <Stack key={group.label} gap={4}>
              {!(collapsed && !isMobile) && (
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }} px="xs" pt={4}>
                  {group.label}
                </Text>
              )}
              {group.items.map((item) => {
                const Icon = item.icon
                const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0
                if (collapsed && !isMobile) {
                  return (
                    <Tooltip
                      key={item.key}
                      label={badgeCount > 0 ? `${item.label} (${badgeCount})` : item.label}
                      position="right"
                      withArrow
                    >
                      <div style={{ position: 'relative' }}>
                        <ActionIcon
                          variant={active === item.key ? 'filled' : 'subtle'}
                          color={active === item.key ? 'violet' : 'gray'}
                          size="lg"
                          onClick={() => setActive(item.key)}
                        >
                          <Icon size={18} />
                        </ActionIcon>
                        {badgeCount > 0 && (
                          <Badge
                            size="xs"
                            color={item.badgeColor ?? 'red'}
                            variant="filled"
                            style={{ position: 'absolute', top: -4, right: -4, pointerEvents: 'none' }}
                          >
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </Badge>
                        )}
                      </div>
                    </Tooltip>
                  )
                }
                return (
                  <NavLink
                    key={item.key}
                    label={item.label}
                    leftSection={<Icon size={18} />}
                    rightSection={
                      badgeCount > 0 ? (
                        <Badge size="xs" color={item.badgeColor ?? 'red'} variant="filled">
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </Badge>
                      ) : null
                    }
                    color="violet"
                    active={active === item.key}
                    onClick={() => setActive(item.key)}
                  />
                )
              })}
            </Stack>
          ))}

          <SidebarAppSwitcher current="admin" role={user?.role} collapsed={collapsed && !isMobile} />
        </Stack>

        <SidebarUserFooter
          user={user}
          collapsed={collapsed && !isMobile}
          onToggleCollapse={toggleSidebar}
          onLogout={confirmLogout}
          isLoggingOut={logout.isPending}
          accentColor="violet"
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <Container fluid px={0}>
          <Stack gap="md">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: 0.6 }}>
                Admin · {TAB_META[active].label}
              </Text>
              <Text size="sm" c="dimmed">
                {TAB_META[active].description}
              </Text>
            </div>
            <SectionErrorBoundary key={active} label={active}>
              {active === 'overview' && <OverviewPanel />}
              {active === 'users' && <UsersPanel />}
              {active === 'audit-logs' && <AuditLogsPanel />}
              {active === 'projects' && <ProjectsOverviewPanel />}
              {active === 'tasks' && <TaskTriagePanel />}
              {active === 'effort' && <EffortPanel />}
              {active === 'analytics' && <AnalyticsPanel />}
              {active === 'sessions' && <SessionsPanel />}
              {active === 'health' && <SystemHealthPanel />}
            </SectionErrorBoundary>
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}
