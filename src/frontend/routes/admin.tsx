import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
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
import { useState } from 'react'
import {
  TbClipboardList,
  TbClockHour3,
  TbCode,
  TbHeartbeat,
  TbLayoutDashboard,
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarLeftExpand,
  TbListCheck,
  TbLogout,
  TbPlugConnected,
  TbReportAnalytics,
  TbShieldLock,
  TbTarget,
  TbUser,
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
import { SectionErrorBoundary } from '@/frontend/components/shared/SectionErrorBoundary'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
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

function AdminPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { tab: active } = Route.useSearch()
  const navigate = useNavigate()
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const isMobile = useMediaQuery('(max-width: 48em)')
  const setActive = (key: TabKey) => {
    navigate({ to: '/admin', search: { tab: key } })
    closeMobile()
  }
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
  const isSuper = user?.role === 'SUPER_ADMIN'
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
        </Stack>

        <Stack gap="xs">
          {!collapsed || isMobile ? (
            <>
              <Button
                variant="light"
                color="blue"
                leftSection={<TbTarget size={16} />}
                onClick={() => navigate({ to: '/pm', search: { tab: 'overview' } })}
                size="sm"
              >
                Manajer Proyek
              </Button>
              {isSuper && (
                <Button
                  variant="light"
                  color="orange"
                  leftSection={<TbCode size={16} />}
                  onClick={() => navigate({ to: '/dev', search: { tab: 'overview' } })}
                  size="sm"
                >
                  Konsol Dev
                </Button>
              )}
              <Button
                variant="light"
                leftSection={<TbUser size={16} />}
                onClick={() => navigate({ to: '/settings' })}
                size="sm"
              >
                Pengaturan
              </Button>
              <Group justify="space-between">
                <ThemeToggle size="sm" />
                <ActionIcon variant="subtle" onClick={toggleSidebar} visibleFrom="sm" size="lg">
                  <TbLayoutSidebarLeftCollapse size={18} />
                </ActionIcon>
              </Group>
              <Button
                variant="light"
                color="red"
                leftSection={<TbLogout size={16} />}
                onClick={confirmLogout}
                loading={logout.isPending}
                size="sm"
              >
                Keluar
              </Button>
            </>
          ) : (
            <Stack gap="xs" align="center">
              <Tooltip label="Manajer Proyek" position="right" withArrow>
                <ActionIcon
                  variant="light"
                  color="blue"
                  size="lg"
                  onClick={() => navigate({ to: '/pm', search: { tab: 'overview' } })}
                >
                  <TbTarget size={18} />
                </ActionIcon>
              </Tooltip>
              {isSuper && (
                <Tooltip label="Konsol Dev" position="right" withArrow>
                  <ActionIcon
                    variant="light"
                    color="orange"
                    size="lg"
                    onClick={() => navigate({ to: '/dev', search: { tab: 'overview' } })}
                  >
                    <TbCode size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Pengaturan" position="right" withArrow>
                <ActionIcon variant="subtle" size="lg" onClick={() => navigate({ to: '/settings' })}>
                  <TbUser size={18} />
                </ActionIcon>
              </Tooltip>
              <ThemeToggle size="sm" />
              <Tooltip label="Perluas sidebar" position="right" withArrow>
                <ActionIcon variant="subtle" onClick={toggleSidebar} size="lg">
                  <TbLayoutSidebarLeftExpand size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Keluar" position="right" withArrow>
                <ActionIcon variant="light" color="red" size="lg" onClick={confirmLogout} loading={logout.isPending}>
                  <TbLogout size={18} />
                </ActionIcon>
              </Tooltip>
            </Stack>
          )}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Container size="xl" px={0}>
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
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}
