import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Box,
  Card,
  Container,
  Group,
  Menu,
  NavLink,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  TbChevronRight,
  TbCircleFilled,
  TbCode,
  TbDatabase,
  TbDots,
  TbFileText,
  TbLayoutDashboard,
  TbLock,
  TbLockOpen,
  TbLogout,
  TbRefresh,
  TbServer,
  TbTrash,
  TbSettings,
  TbShieldCheck,
  TbShieldOff,
  TbUser,
  TbUserSearch,
  TbUsers,
  TbWifi,
} from 'react-icons/tb'
import { useLogout, useSession, type Role } from '@/frontend/hooks/useAuth'
import { usePresence } from '@/frontend/hooks/usePresence'

const validTabs = ['overview', 'users', 'app-logs', 'user-logs', 'database', 'server', 'settings'] as const

export const Route = createFileRoute('/dev')({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: validTabs.includes(search.tab as any) ? (search.tab as string) : 'overview',
  }),
  beforeLoad: async ({ context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'session'],
        queryFn: () => fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()),
      })
      if (!data?.user) throw redirect({ to: '/login' })
      if (data.user.blocked) throw redirect({ to: '/blocked' })
      if (data.user.role !== 'SUPER_ADMIN') throw redirect({ to: '/profile' })
    } catch (e) {
      if (e instanceof Error) throw redirect({ to: '/login' })
      throw e
    }
  },
  component: DevPage,
})

interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  blocked: boolean
  createdAt: string
}

const navItems = [
  { label: 'Overview', icon: TbLayoutDashboard, key: 'overview' },
  { label: 'Users', icon: TbUsers, key: 'users' },
  { label: 'App Logs', icon: TbServer, key: 'app-logs' },
  { label: 'User Logs', icon: TbUserSearch, key: 'user-logs' },
  { label: 'Database', icon: TbDatabase, key: 'database' },
  { label: 'Settings', icon: TbSettings, key: 'settings' },
]

function DevPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { tab: active } = Route.useSearch()
  const navigate = useNavigate()
  const setActive = (key: string) => navigate({ to: '/dev', search: { tab: key } })

  return (
    <AppShell
      navbar={{ width: 260, breakpoint: 'sm' }}
      padding="md"
    >
      <AppShell.Navbar p="md">
        <AppShell.Section>
          <Group gap="xs" mb="md">
            <ThemeIcon size="lg" variant="gradient" gradient={{ from: 'red', to: 'orange' }}>
              <TbCode size={18} />
            </ThemeIcon>
            <div>
              <Text fw={700} size="sm">Dev Console</Text>
              <Text size="xs" c="dimmed">Super Admin</Text>
            </div>
          </Group>
        </AppShell.Section>

        <AppShell.Section grow>
          {navItems.map((item) => (
            <NavLink
              key={item.key}
              label={item.label}
              leftSection={<item.icon size={18} />}
              rightSection={<TbChevronRight size={14} />}
              active={active === item.key}
              onClick={() => setActive(item.key)}
              variant="light"
              mb={4}
            />
          ))}
        </AppShell.Section>

        <AppShell.Section>
          <Box
            p="sm"
            style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
          >
            <Group justify="space-between">
              <Group gap="xs">
                <Avatar color="red" radius="xl" size="sm">
                  {user?.name?.charAt(0).toUpperCase()}
                </Avatar>
                <div>
                  <Text size="xs" fw={500}>{user?.name}</Text>
                  <Text size="xs" c="dimmed">{user?.email}</Text>
                </div>
              </Group>
              <Tooltip label="Logout">
                <ActionIcon
                  variant="subtle"
                  color="red"
                  onClick={() => logout.mutate()}
                  loading={logout.isPending}
                >
                  <TbLogout size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Box>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {active === 'overview' && <OverviewPanel />}
        {active === 'users' && <UsersPanel />}
        {active === 'app-logs' && <AppLogsPanel />}
        {active === 'user-logs' && <UserLogsPanel />}
        {active === 'database' && <PlaceholderPanel title="Database" desc="Database management dan monitoring akan ditampilkan di sini." icon={TbDatabase} />}
        {active === 'server' && <PlaceholderPanel title="Server" desc="Server monitoring akan ditampilkan di sini." icon={TbServer} />}
        {active === 'settings' && <PlaceholderPanel title="Settings" desc="System configuration akan ditampilkan di sini." icon={TbSettings} />}
      </AppShell.Main>
    </AppShell>
  )
}

// ─── Overview Panel ────────────────────────────────────

const overviewStats = [
  { title: 'Total Users', icon: TbUsers, color: 'blue' },
  { title: 'Online', icon: TbWifi, color: 'green' },
  { title: 'Admin', icon: TbShieldCheck, color: 'violet' },
  { title: 'Blocked', icon: TbLock, color: 'red' },
]

function OverviewPanel() {
  const { data } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()) as Promise<{ users: AdminUser[] }>,
  })
  const { onlineUserIds } = usePresence()

  const users = data?.users ?? []
  const counts = {
    'Total Users': users.length,
    'Online': onlineUserIds.length,
    'Admin': users.filter((u) => u.role === 'ADMIN' || u.role === 'SUPER_ADMIN').length,
    'Blocked': users.filter((u) => u.blocked).length,
  }

  return (
    <Container size="lg">
      <Stack gap="lg">
        <Title order={3}>Overview</Title>
        <SimpleGrid cols={{ base: 1, sm: 4 }}>
          {overviewStats.map((stat) => (
            <Card key={stat.title} withBorder padding="lg" radius="md">
              <Group justify="space-between" mb="xs">
                <Text size="sm" c="dimmed" fw={500}>{stat.title}</Text>
                <ThemeIcon variant="light" color={stat.color} size="sm">
                  <stat.icon size={14} />
                </ThemeIcon>
              </Group>
              <Text fw={700} size="xl">{counts[stat.title as keyof typeof counts]}</Text>
            </Card>
          ))}
        </SimpleGrid>
      </Stack>
    </Container>
  )
}

// ─── Users Panel ───────────────────────────────────────

const roleBadge: Record<string, { color: string; label: string }> = {
  USER: { color: 'blue', label: 'User' },
  ADMIN: { color: 'violet', label: 'Admin' },
  SUPER_ADMIN: { color: 'red', label: 'Super Admin' },
}

function UsersPanel() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()) as Promise<{ users: AdminUser[] }>,
  })

  const { data: sessionData } = useSession()
  const currentUserId = sessionData?.user?.id
  const { onlineUserIds } = usePresence()

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      fetch(`/api/admin/users/${id}/role`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  const toggleBlock = useMutation({
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) =>
      fetch(`/api/admin/users/${id}/block`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked }),
      }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  const users = data?.users ?? []

  return (
    <Container size="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>User Management</Title>
          <Badge variant="light" size="lg">{users.length} users</Badge>
        </Group>

        <Card withBorder radius="md" p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text ta="center" c="dimmed" py="md">Loading...</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {users.map((u) => {
                const isSelf = u.id === currentUserId
                const badge = roleBadge[u.role] ?? roleBadge.USER
                const isOnline = onlineUserIds.includes(u.id)

                return (
                  <Table.Tr key={u.id} opacity={u.blocked ? 0.5 : 1}>
                    <Table.Td>
                      <Group gap="sm">
                        <div style={{ position: 'relative' }}>
                          <Avatar color={badge.color} radius="xl" size="sm">
                            {u.name.charAt(0).toUpperCase()}
                          </Avatar>
                          {!u.blocked && (
                            <TbCircleFilled
                              size={10}
                              color={isOnline ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-gray-6)'}
                              style={{
                                position: 'absolute',
                                bottom: -1,
                                right: -1,
                                borderRadius: '50%',
                                border: '2px solid var(--mantine-color-body)',
                              }}
                            />
                          )}
                        </div>
                        <div>
                          <Text size="sm" fw={500}>
                            {u.name} {isSelf && <Text span c="dimmed" size="xs">(you)</Text>}
                          </Text>
                          <Text size="xs" c="dimmed">{u.email}</Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={badge.color} variant="light" size="sm">
                        {badge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {u.blocked ? (
                        <Badge color="red" variant="filled" size="sm">Blocked</Badge>
                      ) : isOnline ? (
                        <Badge color="green" variant="filled" size="sm">Online</Badge>
                      ) : (
                        <Badge color="gray" variant="light" size="sm">Offline</Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {!isSelf && u.role !== 'SUPER_ADMIN' && (
                        <Menu shadow="md" width={200} position="bottom-end">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray">
                              <TbDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Role</Menu.Label>
                            {u.role !== 'ADMIN' && (
                              <Menu.Item
                                leftSection={<TbShieldCheck size={14} />}
                                onClick={() => changeRole.mutate({ id: u.id, role: 'ADMIN' })}
                              >
                                Angkat jadi Admin
                              </Menu.Item>
                            )}
                            {u.role === 'ADMIN' && (
                              <Menu.Item
                                leftSection={<TbShieldOff size={14} />}
                                onClick={() => changeRole.mutate({ id: u.id, role: 'USER' })}
                              >
                                Turunkan ke User
                              </Menu.Item>
                            )}

                            <Menu.Divider />
                            <Menu.Label>Status</Menu.Label>
                            {u.blocked ? (
                              <Menu.Item
                                leftSection={<TbLockOpen size={14} />}
                                color="green"
                                onClick={() => toggleBlock.mutate({ id: u.id, blocked: false })}
                              >
                                Unblock User
                              </Menu.Item>
                            ) : (
                              <Menu.Item
                                leftSection={<TbLock size={14} />}
                                color="red"
                                onClick={() => toggleBlock.mutate({ id: u.id, blocked: true })}
                              >
                                Block User
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}

// ─── App Logs Panel ────────────────────────────────────

interface AppLogEntry {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: string
  timestamp: string
}

const levelBadge: Record<string, { color: string }> = {
  info: { color: 'blue' },
  warn: { color: 'yellow' },
  error: { color: 'red' },
}

function AppLogsPanel() {
  const [levelFilter, setLevelFilter] = useState<string>('all')
  const queryClient = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'logs', 'app', levelFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' })
      if (levelFilter !== 'all') params.set('level', levelFilter)
      return fetch(`/api/admin/logs/app?${params}`, { credentials: 'include' }).then((r) => r.json()) as Promise<{ logs: AppLogEntry[] }>
    },
    refetchInterval: 5000,
  })

  const clearLogs = useMutation({
    mutationFn: () => fetch('/api/admin/logs/app', { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'logs', 'app'] }),
  })

  const logs = data?.logs ?? []

  return (
    <Container size="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Group gap="sm">
            <Title order={3}>App Logs</Title>
            <Badge variant="light" color="gray" size="sm">redis</Badge>
          </Group>
          <Group gap="sm">
            <SegmentedControl
              size="xs"
              value={levelFilter}
              onChange={setLevelFilter}
              data={[
                { label: 'All', value: 'all' },
                { label: 'Info', value: 'info' },
                { label: 'Warn', value: 'warn' },
                { label: 'Error', value: 'error' },
              ]}
            />
            <Tooltip label="Clear all">
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() => { if (confirm('Hapus semua app logs?')) clearLogs.mutate() }}
                loading={clearLogs.isPending}
              >
                <TbTrash size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Refresh">
              <ActionIcon variant="subtle" color="gray" onClick={() => refetch()} loading={isFetching}>
                <TbRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Card withBorder radius="md" p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={180}>Time</Table.Th>
                <Table.Th w={70}>Level</Table.Th>
                <Table.Th>Message</Table.Th>
                <Table.Th>Detail</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text ta="center" c="dimmed" py="md">Loading...</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {logs.length === 0 && !isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text ta="center" c="dimmed" py="md">Belum ada log</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {[...logs].reverse().map((log) => {
                const badge = levelBadge[log.level] ?? levelBadge.info
                return (
                  <Table.Tr key={log.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace" c="dimmed">
                        {new Date(log.timestamp).toLocaleString('id-ID', { hour12: false })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={badge.color} variant="light" size="xs" tt="uppercase">
                        {log.level}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" ff="monospace">{log.message}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">{log.detail ?? '—'}</Text>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}

// ─── User Logs (Audit) Panel ───────────────────────────

interface AuditLogEntry {
  id: string
  userId: string | null
  action: string
  detail: string | null
  ip: string | null
  createdAt: string
  user: { name: string; email: string } | null
}

const actionBadge: Record<string, { color: string; label: string }> = {
  LOGIN: { color: 'green', label: 'Login' },
  LOGOUT: { color: 'gray', label: 'Logout' },
  LOGIN_FAILED: { color: 'orange', label: 'Login Failed' },
  LOGIN_BLOCKED: { color: 'red', label: 'Login Blocked' },
  ROLE_CHANGED: { color: 'violet', label: 'Role Changed' },
  BLOCKED: { color: 'red', label: 'Blocked' },
  UNBLOCKED: { color: 'teal', label: 'Unblocked' },
}

function UserLogsPanel() {
  const [actionFilter, setActionFilter] = useState<string | null>(null)
  const [userFilter, setUserFilter] = useState<string | null>(null)
  const queryClient = useQueryClient()

  // Fetch users for the filter dropdown
  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()) as Promise<{ users: AdminUser[] }>,
  })

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'logs', 'audit', actionFilter, userFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' })
      if (actionFilter) params.set('action', actionFilter)
      if (userFilter) params.set('userId', userFilter)
      return fetch(`/api/admin/logs/audit?${params}`, { credentials: 'include' }).then((r) => r.json()) as Promise<{ logs: AuditLogEntry[] }>
    },
  })

  const clearLogs = useMutation({
    mutationFn: () => fetch('/api/admin/logs/audit', { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'logs', 'audit'] }),
  })

  const logs = data?.logs ?? []
  const userOptions = (usersData?.users ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))
  const actionOptions = Object.entries(actionBadge).map(([key, val]) => ({ value: key, label: val.label }))

  return (
    <Container size="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Group gap="sm">
            <Title order={3}>User Logs</Title>
            <Badge variant="light" color="gray" size="sm">audit trail</Badge>
          </Group>
          <Group gap="sm">
            <Tooltip label="Clear all">
              <ActionIcon
                variant="subtle"
                color="red"
                onClick={() => { if (confirm('Hapus semua audit logs?')) clearLogs.mutate() }}
                loading={clearLogs.isPending}
              >
                <TbTrash size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Refresh">
              <ActionIcon variant="subtle" color="gray" onClick={() => refetch()} loading={isFetching}>
                <TbRefresh size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group gap="sm">
          <Select
            placeholder="Filter by user"
            data={userOptions}
            value={userFilter}
            onChange={setUserFilter}
            clearable
            searchable
            size="xs"
            w={250}
            leftSection={<TbUser size={14} />}
          />
          <Select
            placeholder="Filter by action"
            data={actionOptions}
            value={actionFilter}
            onChange={setActionFilter}
            clearable
            size="xs"
            w={200}
            leftSection={<TbFileText size={14} />}
          />
        </Group>

        <Card withBorder radius="md" p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={180}>Time</Table.Th>
                <Table.Th>User</Table.Th>
                <Table.Th>Action</Table.Th>
                <Table.Th>Detail</Table.Th>
                <Table.Th w={120}>IP</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text ta="center" c="dimmed" py="md">Loading...</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {logs.length === 0 && !isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text ta="center" c="dimmed" py="md">Belum ada log</Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {logs.map((log) => {
                const badge = actionBadge[log.action] ?? { color: 'gray', label: log.action }
                return (
                  <Table.Tr key={log.id}>
                    <Table.Td>
                      <Text size="xs" ff="monospace" c="dimmed">
                        {new Date(log.createdAt).toLocaleString('id-ID', { hour12: false })}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {log.user ? (
                        <div>
                          <Text size="sm" fw={500}>{log.user.name}</Text>
                          <Text size="xs" c="dimmed">{log.user.email}</Text>
                        </div>
                      ) : (
                        <Text size="sm" c="dimmed">—</Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Badge color={badge.color} variant="light" size="sm">
                        {badge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" ff="monospace">{log.detail ?? '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" ff="monospace" c="dimmed">{log.ip ?? '—'}</Text>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
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
