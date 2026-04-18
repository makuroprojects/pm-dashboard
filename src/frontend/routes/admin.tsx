import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
  Card,
  Container,
  Group,
  NavLink,
  Paper,
  SimpleGrid,
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
  TbActivity,
  TbBug,
  TbCode,
  TbLayoutDashboard,
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarLeftExpand,
  TbLogout,
  TbReportAnalytics,
  TbSettings,
  TbShieldLock,
  TbTarget,
  TbUser,
  TbUsers,
} from 'react-icons/tb'
import { NotificationBell } from '@/frontend/components/NotificationBell'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'

const validTabs = ['overview', 'users', 'analytics'] as const
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

type NavItem = { label: string; icon: typeof TbLayoutDashboard; key: TabKey }

const navItems: NavItem[] = [
  { label: 'Overview', icon: TbLayoutDashboard, key: 'overview' },
  { label: 'Users', icon: TbUsers, key: 'users' },
  { label: 'Analytics', icon: TbReportAnalytics, key: 'analytics' },
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
      title: 'Logout',
      children: <Text size="sm">Are you sure you want to logout?</Text>,
      labels: { confirm: 'Logout', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => logout.mutate(),
    })

  const desktopWidth = collapsed ? 60 : 260
  const isSuper = user?.role === 'SUPER_ADMIN'

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: desktopWidth, breakpoint: 'sm', collapsed: { mobile: !mobileOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <ThemeIcon variant="light" color="violet" size="md">
              <TbShieldLock size={18} />
            </ThemeIcon>
            <Title order={4}>Admin Console</Title>
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
        <Stack gap="xs" style={{ flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon
            if (collapsed && !isMobile) {
              return (
                <Tooltip key={item.key} label={item.label} position="right" withArrow>
                  <ActionIcon
                    variant={active === item.key ? 'filled' : 'subtle'}
                    color={active === item.key ? 'violet' : 'gray'}
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
                leftSection={<Icon size={18} />}
                active={active === item.key}
                onClick={() => setActive(item.key)}
              />
            )
          })}
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
                Project Manager
              </Button>
              {isSuper && (
                <Button
                  variant="light"
                  color="orange"
                  leftSection={<TbCode size={16} />}
                  onClick={() => navigate({ to: '/dev', search: { tab: 'overview' } })}
                  size="sm"
                >
                  Dev Console
                </Button>
              )}
              <Button
                variant="light"
                leftSection={<TbUser size={16} />}
                onClick={() => navigate({ to: '/settings' })}
                size="sm"
              >
                Settings
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
                Logout
              </Button>
            </>
          ) : (
            <Stack gap="xs" align="center">
              <Tooltip label="Project Manager" position="right" withArrow>
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
                <Tooltip label="Dev Console" position="right" withArrow>
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
              <Tooltip label="Settings" position="right" withArrow>
                <ActionIcon variant="subtle" size="lg" onClick={() => navigate({ to: '/settings' })}>
                  <TbUser size={18} />
                </ActionIcon>
              </Tooltip>
              <ThemeToggle size="sm" />
              <Tooltip label="Expand sidebar" position="right" withArrow>
                <ActionIcon variant="subtle" onClick={toggleSidebar} size="lg">
                  <TbLayoutSidebarLeftExpand size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Logout" position="right" withArrow>
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
          {active === 'overview' && <AdminOverview />}
          {active === 'users' && (
            <PlaceholderPanel
              title="Users"
              icon={TbUsers}
              description="User management moved here from Dev Console. Coming in Phase 2."
            />
          )}
          {active === 'analytics' && (
            <PlaceholderPanel
              title="Analytics"
              icon={TbReportAnalytics}
              description="Cross-project KPIs and throughput trends. Coming in Phase 2."
            />
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

function AdminOverview() {
  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Admin Overview</Title>
        <Text c="dimmed" size="sm">
          System-wide summary. Dive into users and analytics from the sidebar.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
        <StatCard label="Total Users" value="—" icon={TbUsers} color="violet" />
        <StatCard label="Open Tasks" value="—" icon={TbBug} color="red" />
        <StatCard label="Live Agents" value="—" icon={TbActivity} color="teal" />
        <StatCard label="Projects" value="—" icon={TbTarget} color="blue" />
      </SimpleGrid>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Group gap="xs">
            <TbSettings size={16} />
            <Title order={5}>Phase 2 preview</Title>
          </Group>
          <Text size="sm" c="dimmed">
            This screen will bring together user management, task triage, and cross-project metrics. Role-based sections
            will replace the Dev Console's admin duties.
          </Text>
        </Stack>
      </Paper>
    </Stack>
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
  icon: typeof TbLayoutDashboard
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

function PlaceholderPanel({
  title,
  icon: Icon,
  description,
}: {
  title: string
  icon: typeof TbLayoutDashboard
  description: string
}) {
  return (
    <Paper withBorder p="xl" radius="md">
      <Stack align="center" gap="md" py="xl">
        <ThemeIcon variant="light" color="violet" size={60} radius="md">
          <Icon size={32} />
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        <Text size="sm" c="dimmed" ta="center" maw={480}>
          {description}
        </Text>
      </Stack>
    </Paper>
  )
}
