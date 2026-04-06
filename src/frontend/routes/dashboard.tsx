import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Box,
  Card,
  Container,
  Group,
  NavLink,
  Paper,
  Progress,
  RingProgress,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  TbActivity,
  TbArrowDownRight,
  TbArrowUpRight,
  TbBell,
  TbCalendar,
  TbChartBar,
  TbChevronRight,
  TbClipboardList,
  TbCode,
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarLeftExpand,
  TbCoin,
  TbLayoutDashboard,
  TbLogout,
  TbMessages,
  TbReportAnalytics,
  TbSettings,
  TbUser,
  TbUsers,
} from 'react-icons/tb'
import { useState } from 'react'
import { modals } from '@mantine/modals'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'

const validTabs = ['dashboard', 'analytics', 'orders', 'messages', 'calendar', 'settings'] as const

export const Route = createFileRoute('/dashboard')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: validTabs.includes(search.tab as any) ? (search.tab as string) : 'dashboard',
  }),
  beforeLoad: async ({ context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'session'],
        queryFn: () => fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()),
      })
      if (!data?.user) throw redirect({ to: '/login' })
      if (data.user.blocked) throw redirect({ to: '/blocked' })
      if (data.user.role === 'USER') throw redirect({ to: '/profile' })
    } catch (e) {
      if (e instanceof Error) throw redirect({ to: '/login' })
      throw e
    }
  },
  component: DashboardPage,
})

const navItems = [
  { label: 'Dashboard', icon: TbLayoutDashboard, key: 'dashboard' },
  { label: 'Analytics', icon: TbReportAnalytics, key: 'analytics' },
  { label: 'Orders', icon: TbClipboardList, key: 'orders' },
  { label: 'Messages', icon: TbMessages, key: 'messages', badge: 3 },
  { label: 'Calendar', icon: TbCalendar, key: 'calendar' },
  { label: 'Settings', icon: TbSettings, key: 'settings' },
]

function DashboardPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { tab: active } = Route.useSearch()
  const navigate = useNavigate()
  const setActive = (key: string) => navigate({ to: '/dashboard', search: { tab: key } })
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dashboard:sidebar') === 'collapsed')
  const toggleSidebar = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem('dashboard:sidebar', next ? 'collapsed' : 'open')
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

  return (
    <AppShell
      navbar={{ width: collapsed ? 60 : 260, breakpoint: 'sm' }}
      padding="md"
    >
      <AppShell.Navbar p={collapsed ? 'xs' : 'md'}>
        <AppShell.Section>
          <Group gap="xs" mb="md" justify={collapsed ? 'center' : 'space-between'}>
            {collapsed ? (
              <Tooltip label="Expand sidebar" position="right">
                <ActionIcon variant="subtle" color="gray" size="lg" onClick={toggleSidebar}>
                  <TbLayoutSidebarLeftExpand size={18} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <>
                <Group gap="xs">
                  <ThemeIcon size="lg" variant="gradient" gradient={{ from: 'blue', to: 'cyan' }}>
                    <TbLayoutDashboard size={18} />
                  </ThemeIcon>
                  <div>
                    <Text fw={700} size="sm">Dashboard</Text>
                    <Text size="xs" c="dimmed">Admin Panel</Text>
                  </div>
                </Group>
                <Tooltip label="Minimize sidebar">
                  <ActionIcon variant="subtle" color="gray" size="sm" onClick={toggleSidebar}>
                    <TbLayoutSidebarLeftCollapse size={18} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
          </Group>
        </AppShell.Section>

        <AppShell.Section grow>
          {navItems.map((item) =>
            collapsed ? (
              <Tooltip key={item.key} label={item.label} position="right">
                <ActionIcon
                  variant={active === item.key ? 'light' : 'subtle'}
                  color={active === item.key ? 'blue' : 'gray'}
                  size="lg"
                  onClick={() => setActive(item.key)}
                  mb={4}
                  style={{ width: '100%', position: 'relative' }}
                >
                  <item.icon size={18} />
                  {item.badge && (
                    <Badge size="xs" color="red" variant="filled" style={{ position: 'absolute', top: -2, right: -2, padding: '0 4px', minWidth: 16, height: 16 }}>
                      {item.badge}
                    </Badge>
                  )}
                </ActionIcon>
              </Tooltip>
            ) : (
              <NavLink
                key={item.key}
                label={item.label}
                leftSection={<item.icon size={18} />}
                rightSection={
                  item.badge
                    ? <Badge size="xs" color="red" variant="filled">{item.badge}</Badge>
                    : <TbChevronRight size={14} />
                }
                active={active === item.key}
                onClick={() => setActive(item.key)}
                variant="light"
                mb={4}
              />
            )
          )}

          {user?.role === 'SUPER_ADMIN' && (
            collapsed ? (
              <Tooltip label="Dev Console" position="right">
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  component="a"
                  href="/dev"
                  mt={8}
                  style={{ width: '100%' }}
                >
                  <TbCode size={18} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <>
                <Text size="xs" c="dimmed" fw={500} mt="md" mb={4} ml="sm">Super Admin</Text>
                <NavLink
                  label="Dev Console"
                  leftSection={<TbCode size={18} />}
                  rightSection={<TbChevronRight size={14} />}
                  component="a"
                  href="/dev"
                  variant="light"
                  mb={4}
                />
              </>
            )
          )}
        </AppShell.Section>

        <AppShell.Section>
          <Box p={collapsed ? 'xs' : 'sm'} style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
            {collapsed ? (
              <Stack align="center" gap={4}>
                <Tooltip label={user?.name} position="right">
                  <Avatar color={user?.role === 'SUPER_ADMIN' ? 'red' : 'violet'} radius="xl" size="sm">
                    {user?.name?.charAt(0).toUpperCase()}
                  </Avatar>
                </Tooltip>
                <ThemeToggle size="sm" />
                <Tooltip label="Profile" position="right">
                  <ActionIcon variant="subtle" color="gray" size="sm" component="a" href="/profile">
                    <TbUser size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Logout" position="right">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="sm"
                    onClick={confirmLogout}
                    loading={logout.isPending}
                  >
                    <TbLogout size={14} />
                  </ActionIcon>
                </Tooltip>
              </Stack>
            ) : (
              <Group justify="space-between">
                <Group gap="xs">
                  <Avatar color={user?.role === 'SUPER_ADMIN' ? 'red' : 'violet'} radius="xl" size="sm">
                    {user?.name?.charAt(0).toUpperCase()}
                  </Avatar>
                  <div>
                    <Text size="xs" fw={500}>{user?.name}</Text>
                    <Text size="xs" c="dimmed">{user?.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Admin'}</Text>
                  </div>
                </Group>
                <Group gap={4}>
                  <ThemeToggle size="sm" />
                  <Tooltip label="Profile">
                    <ActionIcon variant="subtle" color="gray" component="a" href="/profile">
                      <TbUser size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Logout">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      onClick={confirmLogout}
                      loading={logout.isPending}
                    >
                      <TbLogout size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            )}
          </Box>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {active === 'dashboard' && <OverviewPanel />}
        {active === 'analytics' && <AnalyticsPanel />}
        {active === 'orders' && <OrdersPanel />}
        {active === 'messages' && <PlaceholderPanel title="Messages" desc="Kelola pesan dan notifikasi." icon={TbMessages} />}
        {active === 'calendar' && <PlaceholderPanel title="Calendar" desc="Jadwal dan agenda kegiatan." icon={TbCalendar} />}
        {active === 'settings' && <PlaceholderPanel title="Settings" desc="Pengaturan akun dan aplikasi." icon={TbSettings} />}
      </AppShell.Main>
    </AppShell>
  )
}

// ─── Overview Panel ────────────────────────────────────

const statsData = [
  { title: 'Revenue', value: '$13,456', diff: 34, icon: TbCoin, color: 'teal' },
  { title: 'Users', value: '1,234', diff: 13, icon: TbUsers, color: 'blue' },
  { title: 'Orders', value: '456', diff: -8, icon: TbClipboardList, color: 'violet' },
  { title: 'Activity', value: '89%', diff: 5, icon: TbActivity, color: 'orange' },
]

function OverviewPanel() {
  return (
    <Container size="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>Overview</Title>
          <Group gap="xs">
            <Tooltip label="Notifications">
              <ActionIcon variant="subtle" color="gray">
                <TbBell size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
          {statsData.map((stat) => (
            <Card key={stat.title} withBorder padding="lg" radius="md">
              <Group justify="space-between" mb="xs">
                <Text size="xs" c="dimmed" fw={600} tt="uppercase">{stat.title}</Text>
                <ThemeIcon variant="light" color={stat.color} size="sm" radius="xl">
                  <stat.icon size={14} />
                </ThemeIcon>
              </Group>
              <Text fw={700} size="xl">{stat.value}</Text>
              <Group gap={4} mt={4}>
                {stat.diff > 0 ? (
                  <TbArrowUpRight size={14} color="var(--mantine-color-teal-6)" />
                ) : (
                  <TbArrowDownRight size={14} color="var(--mantine-color-red-6)" />
                )}
                <Text size="xs" c={stat.diff > 0 ? 'teal' : 'red'} fw={500}>
                  {Math.abs(stat.diff)}%
                </Text>
                <Text size="xs" c="dimmed">vs bulan lalu</Text>
              </Group>
            </Card>
          ))}
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Card withBorder padding="lg" radius="md">
            <Text fw={600} mb="md">Traffic Source</Text>
            <Stack gap="sm">
              {[
                { label: 'Direct', value: 45, color: 'blue' },
                { label: 'Organic Search', value: 30, color: 'teal' },
                { label: 'Social Media', value: 15, color: 'violet' },
                { label: 'Referral', value: 10, color: 'orange' },
              ].map((item) => (
                <div key={item.label}>
                  <Group justify="space-between" mb={4}>
                    <Text size="sm">{item.label}</Text>
                    <Text size="sm" fw={500}>{item.value}%</Text>
                  </Group>
                  <Progress value={item.value} color={item.color} size="sm" radius="xl" />
                </div>
              ))}
            </Stack>
          </Card>

          <Card withBorder padding="lg" radius="md">
            <Text fw={600} mb="md">Performance</Text>
            <Group justify="center" gap="xl">
              <div style={{ textAlign: 'center' }}>
                <RingProgress
                  size={100}
                  thickness={10}
                  roundCaps
                  sections={[{ value: 72, color: 'blue' }]}
                  label={<Text ta="center" fw={700} size="lg">72%</Text>}
                />
                <Text size="xs" c="dimmed" mt={4}>Completion</Text>
              </div>
              <div style={{ textAlign: 'center' }}>
                <RingProgress
                  size={100}
                  thickness={10}
                  roundCaps
                  sections={[{ value: 89, color: 'teal' }]}
                  label={<Text ta="center" fw={700} size="lg">89%</Text>}
                />
                <Text size="xs" c="dimmed" mt={4}>Uptime</Text>
              </div>
              <div style={{ textAlign: 'center' }}>
                <RingProgress
                  size={100}
                  thickness={10}
                  roundCaps
                  sections={[{ value: 56, color: 'orange' }]}
                  label={<Text ta="center" fw={700} size="lg">56%</Text>}
                />
                <Text size="xs" c="dimmed" mt={4}>Efficiency</Text>
              </div>
            </Group>
          </Card>
        </SimpleGrid>

        <RecentActivityTable />
      </Stack>
    </Container>
  )
}

// ─── Analytics Panel ───────────────────────────────────

function AnalyticsPanel() {
  return (
    <Container size="lg">
      <Stack gap="lg">
        <Title order={3}>Analytics</Title>

        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {[
            { label: 'Page Views', value: '24,521', diff: 12 },
            { label: 'Bounce Rate', value: '32.4%', diff: -3 },
            { label: 'Avg. Session', value: '4m 23s', diff: 8 },
          ].map((stat) => (
            <Card key={stat.label} withBorder padding="lg" radius="md">
              <Text size="xs" c="dimmed" fw={600} tt="uppercase">{stat.label}</Text>
              <Text fw={700} size="xl" mt={4}>{stat.value}</Text>
              <Group gap={4} mt={4}>
                {stat.diff > 0 ? (
                  <TbArrowUpRight size={14} color="var(--mantine-color-teal-6)" />
                ) : (
                  <TbArrowDownRight size={14} color="var(--mantine-color-red-6)" />
                )}
                <Text size="xs" c={stat.diff > 0 ? 'teal' : 'red'} fw={500}>
                  {Math.abs(stat.diff)}%
                </Text>
              </Group>
            </Card>
          ))}
        </SimpleGrid>

        <Card withBorder padding="lg" radius="md">
          <Text fw={600} mb="md">Top Pages</Text>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Page</Table.Th>
                <Table.Th ta="right">Views</Table.Th>
                <Table.Th ta="right">Unique</Table.Th>
                <Table.Th ta="right">Bounce</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[
                { page: '/home', views: '8,234', unique: '5,120', bounce: '28%' },
                { page: '/products', views: '5,678', unique: '3,456', bounce: '35%' },
                { page: '/pricing', views: '3,912', unique: '2,890', bounce: '22%' },
                { page: '/about', views: '2,345', unique: '1,780', bounce: '41%' },
                { page: '/contact', views: '1,567', unique: '1,230', bounce: '38%' },
              ].map((row) => (
                <Table.Tr key={row.page}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{row.page}</Text>
                  </Table.Td>
                  <Table.Td ta="right"><Text size="sm">{row.views}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="sm">{row.unique}</Text></Table.Td>
                  <Table.Td ta="right"><Text size="sm">{row.bounce}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}

// ─── Orders Panel ──────────────────────────────────────

const orderStatusColor: Record<string, string> = {
  Completed: 'green',
  Processing: 'blue',
  Pending: 'yellow',
  Cancelled: 'red',
}

const ordersData = [
  { id: '#ORD-001', customer: 'Budi Santoso', amount: 'Rp 1.250.000', status: 'Completed', date: '2 jam lalu' },
  { id: '#ORD-002', customer: 'Siti Rahayu', amount: 'Rp 890.000', status: 'Processing', date: '4 jam lalu' },
  { id: '#ORD-003', customer: 'Andi Pratama', amount: 'Rp 2.100.000', status: 'Pending', date: '6 jam lalu' },
  { id: '#ORD-004', customer: 'Dewi Lestari', amount: 'Rp 560.000', status: 'Completed', date: '1 hari lalu' },
  { id: '#ORD-005', customer: 'Reza Mahendra', amount: 'Rp 1.780.000', status: 'Cancelled', date: '1 hari lalu' },
  { id: '#ORD-006', customer: 'Putri Ayu', amount: 'Rp 3.400.000', status: 'Completed', date: '2 hari lalu' },
  { id: '#ORD-007', customer: 'Hendra Wijaya', amount: 'Rp 720.000', status: 'Processing', date: '2 hari lalu' },
]

function OrdersPanel() {
  return (
    <Container size="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>Orders</Title>
          <Badge variant="light" size="lg">{ordersData.length} orders</Badge>
        </Group>

        <Card withBorder radius="md" p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Order ID</Table.Th>
                <Table.Th>Customer</Table.Th>
                <Table.Th>Amount</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Date</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {ordersData.map((order) => (
                <Table.Tr key={order.id}>
                  <Table.Td><Text size="sm" fw={500}>{order.id}</Text></Table.Td>
                  <Table.Td><Text size="sm">{order.customer}</Text></Table.Td>
                  <Table.Td><Text size="sm" fw={500}>{order.amount}</Text></Table.Td>
                  <Table.Td>
                    <Badge color={orderStatusColor[order.status]} variant="light" size="sm">
                      {order.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td ta="right"><Text size="sm" c="dimmed">{order.date}</Text></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}

// ─── Recent Activity ───────────────────────────────────

function RecentActivityTable() {
  const activities = [
    { user: 'Budi S.', action: 'Membuat order baru', time: '2 menit lalu', color: 'blue' },
    { user: 'Siti R.', action: 'Update profil', time: '15 menit lalu', color: 'green' },
    { user: 'Andi P.', action: 'Pembayaran diterima', time: '1 jam lalu', color: 'teal' },
    { user: 'Dewi L.', action: 'Request refund', time: '3 jam lalu', color: 'orange' },
    { user: 'Reza M.', action: 'Register akun baru', time: '5 jam lalu', color: 'violet' },
  ]

  return (
    <Card withBorder padding="lg" radius="md">
      <Text fw={600} mb="md">Recent Activity</Text>
      <Stack gap="sm">
        {activities.map((act, i) => (
          <Paper key={i} p="sm" radius="sm" bg="var(--mantine-color-default-hover)">
            <Group justify="space-between">
              <Group gap="sm">
                <Avatar color={act.color} radius="xl" size="sm">
                  {act.user.charAt(0)}
                </Avatar>
                <div>
                  <Text size="sm" fw={500}>{act.user}</Text>
                  <Text size="xs" c="dimmed">{act.action}</Text>
                </div>
              </Group>
              <Text size="xs" c="dimmed">{act.time}</Text>
            </Group>
          </Paper>
        ))}
      </Stack>
    </Card>
  )
}

// ─── Placeholder Panel ─────────────────────────────────

function PlaceholderPanel({ title, desc, icon: Icon }: { title: string; desc: string; icon: React.ComponentType<{ size: number }> }) {
  return (
    <Container size="lg">
      <Stack align="center" justify="center" gap="md" mih={400}>
        <ThemeIcon size={64} variant="light" color="gray" radius="xl">
          <Icon size={32} />
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        <Text c="dimmed" ta="center" maw={400}>{desc}</Text>
      </Stack>
    </Container>
  )
}
