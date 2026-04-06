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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  Position,
  MarkerType,
  Handle,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
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
  TbArrowRight,
  TbLogout,
  TbRefresh,
  TbServer,
  TbSitemap,
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

const validTabs = ['overview', 'users', 'app-logs', 'user-logs', 'database', 'project', 'settings'] as const

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
  { label: 'Project', icon: TbSitemap, key: 'project' },
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
        {active === 'database' && <DatabasePanel />}
        {active === 'project' && <ProjectPanel />}
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

// ─── Database Panel (React Flow) ───────────────────────

interface SchemaField {
  name: string
  type: string
  isId: boolean
  isUnique: boolean
  isOptional: boolean
  isList: boolean
  isRelation: boolean
  default?: string
}

interface SchemaModel {
  name: string
  tableName: string
  fields: SchemaField[]
}

interface SchemaEnum {
  name: string
  values: string[]
}

interface SchemaRelation {
  from: string
  fromField: string
  to: string
  toField: string
  onDelete?: string
}

interface ParsedSchema {
  models: SchemaModel[]
  enums: SchemaEnum[]
  relations: SchemaRelation[]
}

// Custom node for model tables
function ModelNode({ data }: { data: { label: string; tableName: string; fields: SchemaField[] } }) {
  return (
    <div style={{
      background: 'var(--mantine-color-body)',
      border: '1px solid var(--mantine-color-default-border)',
      borderRadius: 8,
      minWidth: 240,
      fontSize: 12,
      fontFamily: 'monospace',
      overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--mantine-color-blue-6)' }} />
      <div style={{
        padding: '8px 12px',
        fontWeight: 700,
        fontSize: 13,
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-blue-light)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>{data.label}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>{data.tableName}</span>
      </div>
      <div style={{ padding: '4px 0' }}>
        {data.fields.filter((f) => !f.isRelation).map((field) => (
          <div key={field.name} style={{
            padding: '3px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'center',
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {field.isId && <span style={{ color: 'var(--mantine-color-yellow-6)' }} title="Primary Key">PK</span>}
              {field.isUnique && !field.isId && <span style={{ color: 'var(--mantine-color-teal-6)' }} title="Unique">UQ</span>}
              {!field.isId && !field.isUnique && <span style={{ width: 16 }} />}
              <span>{field.name}</span>
            </span>
            <span style={{ opacity: 0.5 }}>
              {field.type}{field.isOptional ? '?' : ''}
            </span>
          </div>
        ))}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: 'var(--mantine-color-blue-6)' }} />
    </div>
  )
}

function EnumNode({ data }: { data: { label: string; values: string[] } }) {
  return (
    <div style={{
      background: 'var(--mantine-color-body)',
      border: '1px solid var(--mantine-color-default-border)',
      borderRadius: 8,
      minWidth: 160,
      fontSize: 12,
      fontFamily: 'monospace',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '8px 12px',
        fontWeight: 700,
        fontSize: 13,
        borderBottom: '1px solid var(--mantine-color-default-border)',
        background: 'var(--mantine-color-violet-light)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <span>{data.label}</span>
        <span style={{ fontSize: 10, opacity: 0.6 }}>enum</span>
      </div>
      <div style={{ padding: '4px 0' }}>
        {data.values.map((v) => (
          <div key={v} style={{ padding: '3px 12px' }}>{v}</div>
        ))}
      </div>
    </div>
  )
}

const nodeTypes = { model: ModelNode, enum: EnumNode }
const STORAGE_KEY = 'dev:schema:positions'
const VIEWPORT_KEY = 'dev:schema:viewport'

function savePositions(nodes: Node[]) {
  const positions: Record<string, { x: number; y: number }> = {}
  for (const n of nodes) {
    positions[n.id] = n.position
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
}

function loadPositions(): Record<string, { x: number; y: number }> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveViewport(viewport: { x: number; y: number; zoom: number }) {
  localStorage.setItem(VIEWPORT_KEY, JSON.stringify(viewport))
}

function loadViewport(): { x: number; y: number; zoom: number } | null {
  try {
    const raw = localStorage.getItem(VIEWPORT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function DatabasePanel() {
  return (
    <ReactFlowProvider>
      <DatabasePanelInner />
    </ReactFlowProvider>
  )
}

function DatabasePanelInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'schema'],
    queryFn: () => fetch('/api/admin/schema', { credentials: 'include' }).then((r) => r.json()) as Promise<{ schema: ParsedSchema }>,
  })

  const schema = data?.schema
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const viewportTimer = useRef<ReturnType<typeof setTimeout>>()
  const { setViewport, fitView: fitViewDb } = useReactFlow()
  const savedViewport = useMemo(() => loadViewport(), [])

  const { initialNodes, initialEdges } = useMemo(() => {
    if (!schema) return { initialNodes: [], initialEdges: [] }

    const saved = loadPositions()
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Layout models in a grid, restore saved positions
    const cols = Math.ceil(Math.sqrt(schema.models.length + schema.enums.length))

    schema.models.forEach((model, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const defaultPos = { x: col * 340, y: row * 300 }
      nodes.push({
        id: model.name,
        type: 'model',
        position: saved?.[model.name] ?? defaultPos,
        data: { label: model.name, tableName: model.tableName, fields: model.fields },
      })
    })

    schema.enums.forEach((en, i) => {
      const totalModels = schema.models.length
      const idx = totalModels + i
      const col = idx % cols
      const row = Math.floor(idx / cols)
      const id = `enum_${en.name}`
      const defaultPos = { x: col * 340, y: row * 300 }
      nodes.push({
        id,
        type: 'enum',
        position: saved?.[id] ?? defaultPos,
        data: { label: en.name, values: en.values },
      })
    })

    schema.relations.forEach((rel, i) => {
      edges.push({
        id: `rel_${i}`,
        source: rel.from,
        target: rel.to,
        sourceHandle: null,
        targetHandle: null,
        label: `${rel.fromField} → ${rel.toField}${rel.onDelete ? ` (${rel.onDelete})` : ''}`,
        labelStyle: { fontSize: 10, fontFamily: 'monospace' },
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { stroke: 'var(--mantine-color-blue-6)', strokeWidth: 1.5 },
        animated: true,
      })
    })

    return { initialNodes: nodes, initialEdges: edges }
  }, [schema])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
  }, [initialNodes, initialEdges])

  // Debounced auto-save viewport on pan/zoom
  const handleMoveEnd = useCallback((_event: any, viewport: { x: number; y: number; zoom: number }) => {
    clearTimeout(viewportTimer.current)
    viewportTimer.current = setTimeout(() => saveViewport(viewport), 500)
  }, [])

  // Debounced auto-save on node drag
  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      // Read latest nodes from DOM via setNodes callback
      setNodes((current) => {
        savePositions(current)
        return current
      })
    }, 500)
  }, [onNodesChange])

  if (isLoading) {
    return (
      <Container size="lg">
        <Stack align="center" justify="center" mih={400}>
          <Text c="dimmed">Loading schema...</Text>
        </Stack>
      </Container>
    )
  }

  if (!schema) {
    return (
      <Container size="lg">
        <Stack align="center" justify="center" mih={400}>
          <Text c="dimmed">Schema not found</Text>
        </Stack>
      </Container>
    )
  }

  return (
    <Stack gap={0} h="calc(100vh - 32px)">
      <Group justify="space-between" px="md" py="xs">
        <Group gap="sm">
          <Title order={3}>Database Schema</Title>
          <Badge variant="light" size="sm">{schema.models.length} models</Badge>
          <Badge variant="light" color="violet" size="sm">{schema.enums.length} enums</Badge>
          <Badge variant="light" color="blue" size="sm">{schema.relations.length} relations</Badge>
        </Group>
        <LayoutSelector layoutKey={STORAGE_KEY} onLayout={(layout) => {
          getLayoutedElements(nodes, edges, layout).then(({ nodes: laid }) => {
            setNodes(laid)
            localStorage.removeItem(STORAGE_KEY)
            localStorage.removeItem(VIEWPORT_KEY)
            const pos: Record<string, { x: number; y: number }> = {}
            for (const n of laid) pos[n.id] = n.position
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
            requestAnimationFrame(() => fitViewDb({ padding: 0.2 }))
          })
        }} />
        <Tooltip label="Reload schema">
          <ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'schema'] })}>
            <TbRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onMoveEnd={handleMoveEnd}
          nodeTypes={nodeTypes}
          defaultViewport={savedViewport ?? undefined}
          fitView={!savedViewport}
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </Stack>
  )
}

// ─── Project Panel ─────────────────────────────────────

interface RouteInfo {
  method: string; path: string; auth: string; category: string; description: string
}
interface RoutesData {
  routes: RouteInfo[]
  summary: { total: number; byMethod: Record<string, number>; byAuth: Record<string, number>; byCategory: Record<string, number> }
}
interface FileInfo {
  path: string; category: string; lines: number; exports: string[]; imports: { from: string; names: string[] }[]
}
interface ProjectData {
  files: FileInfo[]
  directories: { path: string; category: string; fileCount: number }[]
  summary: { totalFiles: number; totalLines: number; totalExports: number; totalImports: number; byCategory: Record<string, number> }
}

const projectSubViews = ['api-routes', 'file-structure', 'user-flow', 'data-flow', 'env-map', 'test-coverage', 'dependencies', 'migrations', 'sessions', 'live-requests'] as const
type ProjectSubView = (typeof projectSubViews)[number]

const METHOD_COLORS: Record<string, string> = {
  GET: 'green', POST: 'blue', PUT: 'orange', DELETE: 'red', WS: 'violet', PAGE: 'cyan',
}
const AUTH_COLORS: Record<string, string> = {
  public: 'gray', authenticated: 'yellow', admin: 'orange', superAdmin: 'red',
}
const CATEGORY_COLORS: Record<string, string> = {
  frontend: 'blue', route: 'blue', auth: 'cyan', admin: 'red', utility: 'gray', realtime: 'violet',
  backend: 'green', lib: 'violet', hook: 'teal', component: 'indigo', prisma: 'orange',
  'test-unit': 'yellow', 'test-integration': 'yellow', 'test-e2e': 'yellow', test: 'yellow', config: 'gray',
}

// ─── Route Node ───────────────────────────────
function RouteNode({ data }: { data: { method: string; path: string; auth: string; category: string; description: string } }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, border: '1px solid var(--mantine-color-default-border)', background: 'var(--mantine-color-body)', minWidth: 220 }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--mantine-color-blue-6)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--mantine-color-blue-6)' }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={METHOD_COLORS[data.method] || 'gray'} variant="filled">{data.method}</Badge>
        <Text size="xs" fw={700} ff="monospace">{data.path}</Text>
      </Group>
      <Text size="xs" c="dimmed" lineClamp={1}>{data.description}</Text>
      <Group gap={4} mt={4}>
        <Badge size="xs" variant="dot" color={AUTH_COLORS[data.auth] || 'gray'}>{data.auth}</Badge>
        <Badge size="xs" variant="light" color={CATEGORY_COLORS[data.category] || 'gray'}>{data.category}</Badge>
      </Group>
    </div>
  )
}

// ─── File Node ────────────────────────────────
function openInEditor(relativePath: string) {
  fetch('/__open-in-editor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relativePath, lineNumber: '1', columnNumber: '1' }),
  }).catch(() => {})
}

function FileNode2({ data }: { data: { path: string; category: string; lines: number; exports: string[]; imports: { from: string; names: string[] }[] } }) {
  const name = data.path.split('/').pop() || data.path
  return (
    <div
      style={{ padding: 8, borderRadius: 8, border: '1px solid var(--mantine-color-default-border)', background: 'var(--mantine-color-body)', minWidth: 180, cursor: 'pointer' }}
      onDoubleClick={() => openInEditor(data.path)}
      title="Double-click to open in editor"
    >
      <Handle type="target" position={Position.Left} style={{ background: 'var(--mantine-color-violet-6)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--mantine-color-violet-6)' }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={CATEGORY_COLORS[data.category] || 'gray'} variant="filled">{data.category}</Badge>
        <Text size="xs" fw={700} ff="monospace">{name}</Text>
      </Group>
      <Text size="xs" c="dimmed" ff="monospace">{data.path}</Text>
      <Group gap={8} mt={4}>
        <Text size="xs" c="dimmed">{data.lines} lines</Text>
        {data.exports.length > 0 && <Badge size="xs" variant="light" color="green">{data.exports.length} exports</Badge>}
        {data.imports.length > 0 && <Badge size="xs" variant="light" color="blue">{data.imports.length} imports</Badge>}
      </Group>
    </div>
  )
}

// ─── Flow Node (for user-flow & data-flow) ────
function FlowNode({ data }: { data: { label: string; description?: string; color?: string; type?: string } }) {
  const isDiamond = data.type === 'decision'
  return (
    <div style={{
      padding: isDiamond ? 12 : 8,
      borderRadius: isDiamond ? 4 : 8,
      border: `2px solid var(--mantine-color-${data.color || 'blue'}-6)`,
      background: 'var(--mantine-color-body)',
      minWidth: isDiamond ? 120 : 160,
      transform: isDiamond ? 'rotate(0deg)' : undefined,
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: `var(--mantine-color-${data.color || 'blue'}-6)` }} />
      <Handle type="source" position={Position.Bottom} style={{ background: `var(--mantine-color-${data.color || 'blue'}-6)` }} />
      <Handle type="source" position={Position.Right} id="right" style={{ background: `var(--mantine-color-${data.color || 'blue'}-6)` }} />
      <Handle type="source" position={Position.Left} id="left" style={{ background: `var(--mantine-color-${data.color || 'blue'}-6)` }} />
      <Text size="xs" fw={700}>{data.label}</Text>
      {data.description && <Text size="xs" c="dimmed">{data.description}</Text>}
    </div>
  )
}

const projectNodeTypes = { route: RouteNode, file: FileNode2, flow: FlowNode }

function storageKey(view: string) { return `dev:project:${view}` }

function ProjectPanel() {
  const [subView, setSubView] = useState<ProjectSubView>('api-routes')

  return (
    <Stack gap={0} h="calc(100vh - 32px)">
      <Group px="md" py="xs" justify="space-between">
        <Title order={3}>Project</Title>
        <Select
          size="xs"
          w={200}
          value={subView}
          onChange={(v) => v && setSubView(v as ProjectSubView)}
          data={[
            { group: 'Architecture', items: [
              { label: 'API Routes', value: 'api-routes' },
              { label: 'File Structure', value: 'file-structure' },
              { label: 'User Flow', value: 'user-flow' },
              { label: 'Data Flow', value: 'data-flow' },
            ]},
            { group: 'DevOps', items: [
              { label: 'Env Variables', value: 'env-map' },
              { label: 'Test Coverage', value: 'test-coverage' },
              { label: 'Dependencies', value: 'dependencies' },
              { label: 'Migrations', value: 'migrations' },
            ]},
            { group: 'Live', items: [
              { label: 'Sessions', value: 'sessions' },
              { label: 'Live Requests', value: 'live-requests' },
            ]},
          ]}
        />
      </Group>
      {subView === 'api-routes' && <ApiRoutesFlow />}
      {subView === 'file-structure' && <FileStructureFlow />}
      {subView === 'user-flow' && <UserFlowView />}
      {subView === 'data-flow' && <DataFlowView />}
      {subView === 'env-map' && <EnvMapFlow />}
      {subView === 'test-coverage' && <TestCoverageFlow />}
      {subView === 'dependencies' && <DependenciesFlow />}
      {subView === 'migrations' && <MigrationsFlow />}
      {subView === 'sessions' && <SessionsFlow />}
      {subView === 'live-requests' && <LiveRequestsFlow />}
    </Stack>
  )
}

// ─── ELK Layout Engine ────────────────────────
import ELK from 'elkjs/lib/elk.bundled.js'

const elk = new ELK()
type LayoutType = 'horizontal' | 'vertical' | 'radial' | 'force'

const ELK_OPTIONS: Record<string, Record<string, string>> = {
  horizontal: {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    'elk.spacing.nodeNode': '60',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  },
  vertical: {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.layered.spacing.nodeNodeBetweenLayers': '80',
    'elk.spacing.nodeNode': '60',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  },
  force: {
    'elk.algorithm': 'force',
    'elk.force.iterations': '100',
    'elk.spacing.nodeNode': '80',
    'elk.force.repulsion': '2.0',
  },
}

function radialLayout(nodes: Node[], nodeWidth = 240, nodeHeight = 100): Node[] {
  if (nodes.length === 0) return nodes
  if (nodes.length === 1) return [{ ...nodes[0], position: { x: 0, y: 0 } }]

  const perRing = Math.max(6, Math.ceil(nodes.length * 0.6))
  const ringGap = Math.max(nodeWidth, nodeHeight) + 80

  return nodes.map((n, i) => {
    const ring = Math.floor(i / perRing)
    const idxInRing = i % perRing
    const countInRing = Math.min(perRing, nodes.length - ring * perRing)
    const radius = (ring + 1) * ringGap
    const angle = (2 * Math.PI * idxInRing) / countInRing - Math.PI / 2
    return {
      ...n,
      position: {
        x: radius * Math.cos(angle) - nodeWidth / 2,
        y: radius * Math.sin(angle) - nodeHeight / 2,
      },
    }
  })
}

async function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  layout: LayoutType,
  nodeWidth = 240,
  nodeHeight = 100,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  if (nodes.length === 0) return { nodes, edges }

  // Radial: ELK radial needs a tree structure, so use custom circle layout
  if (layout === 'radial') {
    return { nodes: radialLayout(nodes, nodeWidth, nodeHeight), edges }
  }

  // ELK for horizontal, vertical, force
  const graph = {
    id: 'root',
    layoutOptions: ELK_OPTIONS[layout],
    children: nodes.map((node) => ({
      id: node.id,
      width: nodeWidth,
      height: nodeHeight,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  }

  const layoutedGraph = await elk.layout(graph)

  const layoutedNodes = nodes.map((node) => {
    const elkNode = layoutedGraph.children?.find((n) => n.id === node.id)
    return {
      ...node,
      position: elkNode ? { x: elkNode.x!, y: elkNode.y! } : node.position,
    }
  })

  return { nodes: layoutedNodes, edges }
}

function savedLayout(key: string): LayoutType {
  try { return (localStorage.getItem(`${key}:layout`) as LayoutType) || 'horizontal' } catch { return 'horizontal' }
}

function LayoutSelector({ layoutKey, onLayout }: { layoutKey: string; onLayout: (layout: LayoutType) => void }) {
  const [layout, setLayout] = useState<LayoutType>(() => savedLayout(layoutKey))
  const change = (v: string) => {
    const l = v as LayoutType
    setLayout(l)
    localStorage.setItem(`${layoutKey}:layout`, l)
    onLayout(l)
  }
  return (
    <SegmentedControl size="xs" value={layout} onChange={change} data={[
      { label: '↔ Horizontal', value: 'horizontal' },
      { label: '↕ Vertical', value: 'vertical' },
      { label: '◎ Radial', value: 'radial' },
      { label: '⚡ Force', value: 'force' },
    ]} />
  )
}

// ─── Shared flow hook ─────────────────────────
function useFlowAutoSave(key: string) {
  const saveTimer = useRef<ReturnType<typeof setTimeout>>()
  const vpTimer = useRef<ReturnType<typeof setTimeout>>()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const savedVp = useMemo(() => {
    try { const r = localStorage.getItem(`${key}:viewport`); return r ? JSON.parse(r) : null } catch { return null }
  }, [key])
  const loadPos = useMemo(() => {
    try { const r = localStorage.getItem(`${key}:positions`); return r ? JSON.parse(r) as Record<string, { x: number; y: number }> : null } catch { return null }
  }, [key])

  const handleNodesChange = useCallback((changes: any) => {
    onNodesChange(changes)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setNodes((cur) => {
        const pos: Record<string, { x: number; y: number }> = {}
        for (const n of cur) pos[n.id] = n.position
        localStorage.setItem(`${key}:positions`, JSON.stringify(pos))
        return cur
      })
    }, 500)
  }, [onNodesChange, key])

  const handleMoveEnd = useCallback((_e: any, vp: { x: number; y: number; zoom: number }) => {
    clearTimeout(vpTimer.current)
    vpTimer.current = setTimeout(() => localStorage.setItem(`${key}:viewport`, JSON.stringify(vp)), 500)
  }, [key])

  const { fitView } = useReactFlow()

  const relayout = useCallback((layout: LayoutType) => {
    const currentNodes = nodes
    const currentEdges = edges
    getLayoutedElements(currentNodes, currentEdges, layout).then(({ nodes: laid }) => {
      setNodes(laid)
      // Clear saved positions/viewport so layout takes effect
      localStorage.removeItem(`${key}:positions`)
      localStorage.removeItem(`${key}:viewport`)
      // Save new positions
      const pos: Record<string, { x: number; y: number }> = {}
      for (const n of laid) pos[n.id] = n.position
      localStorage.setItem(`${key}:positions`, JSON.stringify(pos))
      // Fit view after layout settles
      requestAnimationFrame(() => fitView({ padding: 0.2 }))
    })
  }, [key, nodes, edges, fitView])

  return { nodes, setNodes, edges, setEdges, onEdgesChange, handleNodesChange, handleMoveEnd, savedVp, loadPos, relayout }
}

// ─── API Routes Flow ──────────────────────────
function ApiRoutesFlow() {
  return <ReactFlowProvider><ApiRoutesFlowInner /></ReactFlowProvider>
}

function ApiRoutesFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'routes'],
    queryFn: () => fetch('/api/admin/routes', { credentials: 'include' }).then(r => r.json()) as Promise<RoutesData>,
  })
  const flow = useFlowAutoSave(storageKey('api-routes'))

  useEffect(() => {
    if (!data?.routes) return
    const categories = ['frontend', 'auth', 'admin', 'utility', 'realtime']
    const grouped: Record<string, RouteInfo[]> = {}
    for (const r of data.routes) {
      if (!grouped[r.category]) grouped[r.category] = []
      grouped[r.category].push(r)
    }

    const nodes: Node[] = []
    const edges: Edge[] = []
    let colX = 0

    for (const cat of categories) {
      const routes = grouped[cat]
      if (!routes) continue
      routes.forEach((r, i) => {
        const id = `${r.method}_${r.path}`
        const defaultPos = { x: colX, y: i * 80 }
        nodes.push({
          id,
          type: 'route',
          position: flow.loadPos?.[id] ?? defaultPos,
          data: r,
        })
      })
      colX += 300
    }

    // Edges: auth flow connections
    const loginId = 'POST_/api/auth/login'
    const sessionId = 'GET_/api/auth/session'
    const googleId = 'GET_/api/auth/google'
    const callbackId = 'GET_/api/auth/callback/google'
    const logoutId = 'POST_/api/auth/logout'

    const flowEdges: [string, string, string][] = [
      ['PAGE_/login', loginId, 'email login'],
      ['PAGE_/login', googleId, 'google'],
      [googleId, callbackId, 'redirect'],
      [callbackId, 'PAGE_/dev', 'SUPER_ADMIN'],
      [callbackId, 'PAGE_/dashboard', 'ADMIN'],
      [callbackId, 'PAGE_/profile', 'USER'],
      [loginId, 'PAGE_/dev', 'SUPER_ADMIN'],
      [loginId, 'PAGE_/dashboard', 'ADMIN'],
      [loginId, 'PAGE_/profile', 'USER'],
      [logoutId, 'PAGE_/login', 'redirect'],
      [sessionId, 'PAGE_/login', '401 redirect'],
    ]

    for (const [from, to, label] of flowEdges) {
      if (nodes.find(n => n.id === from) && nodes.find(n => n.id === to)) {
        edges.push({
          id: `e_${from}_${to}`,
          source: from,
          target: to,
          label,
          labelStyle: { fontSize: 9, fontFamily: 'monospace' },
          style: { stroke: 'var(--mantine-color-blue-4)', strokeWidth: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          animated: true,
        })
      }
    }

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading routes...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        {Object.entries(data.summary.byMethod).map(([m, c]) => (
          <Badge key={m} size="sm" variant="light" color={METHOD_COLORS[m] || 'gray'}>{m}: {c}</Badge>
        ))}
        <Text size="xs" c="dimmed">|</Text>
        {Object.entries(data.summary.byAuth).map(([a, c]) => (
          <Badge key={a} size="sm" variant="dot" color={AUTH_COLORS[a] || 'gray'}>{a}: {c}</Badge>
        ))}
        <LayoutSelector layoutKey={storageKey('api-routes')} onLayout={flow.relayout} />
        <Tooltip label="Reload routes">
          <ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'routes'] })}>
            <TbRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          onNodesChange={flow.handleNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onMoveEnd={flow.handleMoveEnd}
          nodeTypes={projectNodeTypes}
          defaultViewport={flow.savedVp ?? undefined}
          fitView={!flow.savedVp}
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── File Structure Flow ──────────────────────
function FileStructureFlow() {
  return <ReactFlowProvider><FileStructureFlowInner /></ReactFlowProvider>
}

function FileStructureFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'project-structure'],
    queryFn: () => fetch('/api/admin/project-structure', { credentials: 'include' }).then(r => r.json()) as Promise<ProjectData>,
  })
  const [filter, setFilter] = useState('all')
  const flow = useFlowAutoSave(storageKey('file-structure'))

  useEffect(() => {
    if (!data?.files) return
    const filtered = filter === 'all' ? data.files : data.files.filter(f => f.category === filter || (filter === 'frontend' && ['route', 'hook', 'component', 'frontend'].includes(f.category)) || (filter === 'test' && f.category.startsWith('test')))
    const fileSet = new Set(filtered.map(f => f.path))
    const nodes: Node[] = []
    const edges: Edge[] = []
    const cols = Math.max(3, Math.ceil(Math.sqrt(filtered.length)))

    filtered.forEach((f, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const defaultPos = { x: col * 280, y: row * 120 }
      nodes.push({
        id: f.path,
        type: 'file',
        position: flow.loadPos?.[f.path] ?? defaultPos,
        data: f,
      })
    })

    // Import edges (only internal)
    for (const f of filtered) {
      for (const imp of f.imports) {
        if (fileSet.has(imp.from)) {
          edges.push({
            id: `imp_${f.path}_${imp.from}`,
            source: f.path,
            target: imp.from,
            label: imp.names.length <= 2 ? imp.names.join(', ') : `${imp.names.length} imports`,
            labelStyle: { fontSize: 8, fontFamily: 'monospace' },
            style: { stroke: 'var(--mantine-color-violet-4)', strokeWidth: 1 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
          })
        }
      }
    }

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data, filter])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading project...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <SegmentedControl size="xs" value={filter} onChange={setFilter} data={[
          { label: `All (${data.summary.totalFiles})`, value: 'all' },
          { label: 'Frontend', value: 'frontend' },
          { label: 'Backend', value: 'backend' },
          { label: 'Lib', value: 'lib' },
          { label: 'Tests', value: 'test' },
        ]} />
        <Text size="xs" c="dimmed">{data.summary.totalLines} lines | {data.summary.totalExports} exports | {data.summary.totalImports} imports</Text>
        <LayoutSelector layoutKey={storageKey('file-structure')} onLayout={flow.relayout} />
        <Tooltip label="Reload files">
          <ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'project-structure'] })}>
            <TbRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          onNodesChange={flow.handleNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onMoveEnd={flow.handleMoveEnd}
          nodeTypes={projectNodeTypes}
          defaultViewport={flow.savedVp ?? undefined}
          fitView={!flow.savedVp}
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── User Flow View ───────────────────────────
function UserFlowView() {
  return <ReactFlowProvider><UserFlowViewInner /></ReactFlowProvider>
}

function UserFlowViewInner() {
  const flow = useFlowAutoSave(storageKey('user-flow'))

  useEffect(() => {
    const p = flow.loadPos
    const n = (id: string, x: number, y: number, label: string, opts?: Partial<{ description: string; color: string; type: string }>) => ({
      id, type: 'flow' as const, position: p?.[id] ?? { x, y }, data: { label, ...opts },
    })
    const e = (from: string, to: string, label: string, color = 'blue', sourceHandle?: string) => ({
      id: `e_${from}_${to}_${label}`, source: from, target: to, sourceHandle, label,
      labelStyle: { fontSize: 9, fontFamily: 'monospace' } as const,
      style: { stroke: `var(--mantine-color-${color}-4)`, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed as const, width: 12, height: 12 },
      animated: true,
    })

    flow.setNodes([
      n('visit', 300, 0, 'User visits app', { color: 'gray' }),
      n('landing', 300, 80, '/ Landing Page', { color: 'cyan', description: 'Public' }),
      n('login', 300, 170, '/login', { color: 'cyan', description: 'Email + Google OAuth' }),
      n('auth-check', 300, 270, 'Authenticated?', { color: 'yellow', type: 'decision' }),
      n('blocked-check', 300, 370, 'Blocked?', { color: 'orange', type: 'decision' }),
      n('role-check', 300, 470, 'Role Check', { color: 'red', type: 'decision' }),
      n('dev', 100, 580, '/dev', { color: 'red', description: 'SUPER_ADMIN' }),
      n('dashboard', 300, 580, '/dashboard', { color: 'orange', description: 'ADMIN+' }),
      n('profile', 500, 580, '/profile', { color: 'blue', description: 'All users' }),
      n('blocked', 550, 370, '/blocked', { color: 'red', description: 'Logout only' }),
      n('logout', 550, 270, 'POST /api/auth/logout', { color: 'gray' }),
    ])
    flow.setEdges([
      e('visit', 'landing', 'open'),
      e('landing', 'login', 'go to login'),
      e('login', 'auth-check', 'submit'),
      e('auth-check', 'login', 'no → stay', 'gray', 'left'),
      e('auth-check', 'blocked-check', 'yes'),
      e('blocked-check', 'blocked', 'yes → blocked', 'red', 'right'),
      e('blocked-check', 'role-check', 'no'),
      e('role-check', 'dev', 'SUPER_ADMIN', 'red', 'left'),
      e('role-check', 'dashboard', 'ADMIN', 'orange'),
      e('role-check', 'profile', 'USER', 'blue', 'right'),
      e('dev', 'dashboard', 'can access', 'gray'),
      e('dashboard', 'profile', 'can access', 'gray'),
      e('blocked', 'logout', 'logout only', 'gray'),
      e('logout', 'login', 'redirect', 'gray'),
    ])
  }, [])

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <Badge size="sm" color="red" variant="light">SUPER_ADMIN → /dev</Badge>
        <Badge size="sm" color="orange" variant="light">ADMIN → /dashboard</Badge>
        <Badge size="sm" color="blue" variant="light">USER → /profile</Badge>
        <Badge size="sm" color="gray" variant="light">Blocked → /blocked</Badge>
        <LayoutSelector layoutKey={storageKey('user-flow')} onLayout={flow.relayout} />
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          onNodesChange={flow.handleNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onMoveEnd={flow.handleMoveEnd}
          nodeTypes={projectNodeTypes}
          defaultViewport={flow.savedVp ?? undefined}
          fitView={!flow.savedVp}
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Data Flow View ───────────────────────────
function DataFlowView() {
  return <ReactFlowProvider><DataFlowViewInner /></ReactFlowProvider>
}

function DataFlowViewInner() {
  const flow = useFlowAutoSave(storageKey('data-flow'))

  useEffect(() => {
    const p = flow.loadPos
    const n = (id: string, x: number, y: number, label: string, opts?: Partial<{ description: string; color: string; type: string }>) => ({
      id, type: 'flow' as const, position: p?.[id] ?? { x, y }, data: { label, ...opts },
    })
    const e = (from: string, to: string, label: string, color = 'blue', sourceHandle?: string) => ({
      id: `e_${from}_${to}_${label}`, source: from, target: to, sourceHandle, label,
      labelStyle: { fontSize: 9, fontFamily: 'monospace' } as const,
      style: { stroke: `var(--mantine-color-${color}-4)`, strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed as const, width: 12, height: 12 },
      animated: true,
    })

    flow.setNodes([
      // HTTP Flow
      n('client', 250, 0, 'Client Browser', { color: 'cyan', description: 'HTTP Request' }),
      n('elysia', 250, 100, 'Elysia Server', { color: 'green', description: 'Route matching' }),
      n('log-hook', 500, 100, 'onAfterResponse', { color: 'gray', description: 'Request logging' }),
      n('app-log', 700, 100, 'App Log (Redis)', { color: 'red', description: 'Ring buffer, max 500' }),
      n('auth-mw', 250, 200, 'Auth Check', { color: 'yellow', type: 'decision', description: 'Session cookie → DB lookup' }),
      n('401', 500, 200, '401 Unauthorized', { color: 'red' }),
      n('role-guard', 250, 310, 'Role Guard', { color: 'orange', type: 'decision', description: 'SUPER_ADMIN / ADMIN / USER' }),
      n('403', 500, 310, '403 Forbidden', { color: 'red' }),
      n('handler', 250, 420, 'Route Handler', { color: 'green', description: 'Business logic' }),
      n('prisma', 100, 530, 'Prisma (PostgreSQL)', { color: 'orange', description: 'User, Session, AuditLog' }),
      n('redis', 400, 530, 'Redis', { color: 'red', description: 'App logs, cache' }),
      n('response', 250, 640, 'JSON Response', { color: 'cyan' }),

      // WS Flow
      n('ws-client', 700, 300, 'WS Client', { color: 'violet', description: 'ws://host/ws/presence' }),
      n('ws-auth', 700, 400, 'Cookie Auth', { color: 'yellow', type: 'decision' }),
      n('presence', 700, 500, 'Presence Tracker', { color: 'violet', description: 'In-memory Map' }),
      n('broadcast', 700, 600, 'Broadcast', { color: 'violet', description: 'Online users → admin subs' }),

      // Audit flow
      n('audit-event', 100, 640, 'Audit Event', { color: 'orange', description: 'LOGIN, LOGOUT, ROLE_CHANGED...' }),
      n('audit-db', 100, 740, 'AuditLog (DB)', { color: 'orange', description: 'Auto-rotate > 90 days' }),
    ])

    flow.setEdges([
      // HTTP
      e('client', 'elysia', 'request', 'cyan'),
      e('elysia', 'log-hook', 'after', 'gray', 'right'),
      e('log-hook', 'app-log', 'LPUSH + LTRIM', 'red'),
      e('elysia', 'auth-mw', 'route matched'),
      e('auth-mw', '401', 'no session', 'red', 'right'),
      e('auth-mw', 'role-guard', 'valid session'),
      e('role-guard', '403', 'insufficient', 'red', 'right'),
      e('role-guard', 'handler', 'authorized'),
      e('handler', 'prisma', 'query', 'orange', 'left'),
      e('handler', 'redis', 'cache/log', 'red', 'right'),
      e('prisma', 'response', 'data', 'orange'),
      e('redis', 'response', 'data', 'red'),
      e('response', 'client', 'JSON', 'cyan'),
      // WS
      e('ws-client', 'ws-auth', 'connect', 'violet'),
      e('ws-auth', 'presence', 'authenticated', 'violet'),
      e('presence', 'broadcast', 'on change', 'violet'),
      // Audit
      e('handler', 'audit-event', 'auth events', 'orange', 'left'),
      e('audit-event', 'audit-db', 'INSERT', 'orange'),
    ])
  }, [])

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <Badge size="sm" color="cyan" variant="light">Client</Badge>
        <Badge size="sm" color="green" variant="light">Server</Badge>
        <Badge size="sm" color="yellow" variant="light">Auth</Badge>
        <Badge size="sm" color="orange" variant="light">Database</Badge>
        <Badge size="sm" color="red" variant="light">Redis</Badge>
        <Badge size="sm" color="violet" variant="light">WebSocket</Badge>
        <LayoutSelector layoutKey={storageKey('data-flow')} onLayout={flow.relayout} />
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          onNodesChange={flow.handleNodesChange}
          onEdgesChange={flow.onEdgesChange}
          onMoveEnd={flow.handleMoveEnd}
          nodeTypes={projectNodeTypes}
          defaultViewport={flow.savedVp ?? undefined}
          fitView={!flow.savedVp}
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Env Map Flow ─────────────────────────────────
interface EnvVar {
  name: string; required: boolean; isSet: boolean; default: string | null
  category: string; description: string; usedBy: string[]
}
interface EnvMapData {
  variables: EnvVar[]
  summary: { total: number; set: number; unset: number; required: number; byCategory: Record<string, number> }
}

function EnvVarNode({ data }: { data: EnvVar }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, border: `2px solid var(--mantine-color-${data.isSet ? 'green' : 'red'}-6)`, background: 'var(--mantine-color-body)', minWidth: 200 }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--mantine-color-green-6)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--mantine-color-green-6)' }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={data.required ? 'red' : 'gray'} variant="filled">{data.required ? 'required' : 'optional'}</Badge>
        <Badge size="xs" color={CATEGORY_COLORS[data.category] || 'gray'} variant="light">{data.category}</Badge>
      </Group>
      <Text size="xs" fw={700} ff="monospace">{data.name}</Text>
      <Text size="xs" c="dimmed">{data.description}</Text>
      <Group gap={6} mt={4}>
        <Badge size="xs" color={data.isSet ? 'green' : 'red'} variant="dot">{data.isSet ? 'set' : 'unset'}</Badge>
        {data.default && <Text size="xs" c="dimmed">default: {data.default}</Text>}
      </Group>
    </div>
  )
}

const envNodeTypes = { envVar: EnvVarNode, file: FileNode2 }

function EnvMapFlow() {
  return <ReactFlowProvider><EnvMapFlowInner /></ReactFlowProvider>
}

function EnvMapFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'env-map'],
    queryFn: () => fetch('/api/admin/env-map', { credentials: 'include' }).then(r => r.json()) as Promise<EnvMapData>,
  })
  const flow = useFlowAutoSave(storageKey('env-map'))

  useEffect(() => {
    if (!data?.variables) return
    const categories = ['database', 'cache', 'auth', 'app']
    const nodes: Node[] = []
    const edges: Edge[] = []
    const consumerFiles = new Set<string>()

    let colX = 0
    for (const cat of categories) {
      const vars = data.variables.filter(v => v.category === cat)
      vars.forEach((v, i) => {
        nodes.push({ id: `env_${v.name}`, type: 'envVar', position: flow.loadPos?.[`env_${v.name}`] ?? { x: colX, y: i * 120 }, data: v })
        for (const file of v.usedBy) consumerFiles.add(file)
      })
      colX += 300
    }

    // Add consumer file nodes
    const fileArr = Array.from(consumerFiles)
    fileArr.forEach((file, i) => {
      const id = `file_${file}`
      nodes.push({
        id, type: 'file',
        position: flow.loadPos?.[id] ?? { x: colX, y: i * 120 },
        data: { path: file, category: 'backend', lines: 0, exports: [], imports: [] },
      })
    })

    // Edges: env → file
    for (const v of data.variables) {
      for (const file of v.usedBy) {
        edges.push({
          id: `env_${v.name}_${file}`, source: `env_${v.name}`, target: `file_${file}`,
          style: { stroke: 'var(--mantine-color-green-4)', strokeWidth: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
        })
      }
    }

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading env map...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <Badge size="sm" color="green" variant="light">Set: {data.summary.set}</Badge>
        <Badge size="sm" color="red" variant="light">Unset: {data.summary.unset}</Badge>
        <Badge size="sm" color="orange" variant="light">Required: {data.summary.required}</Badge>
        <Text size="xs" c="dimmed">Total: {data.summary.total}</Text>
        <LayoutSelector layoutKey={storageKey('env-map')} onLayout={flow.relayout} />
        <Tooltip label="Reload"><ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'env-map'] })}><TbRefresh size={16} /></ActionIcon></Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} onNodesChange={flow.handleNodesChange} onEdgesChange={flow.onEdgesChange} onMoveEnd={flow.handleMoveEnd} nodeTypes={envNodeTypes} defaultViewport={flow.savedVp ?? undefined} fitView={!flow.savedVp} fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Test Coverage Flow ───────────────────────
interface TestCoverageData {
  sourceFiles: { path: string; lines: number; exports: string[]; testedBy: string[]; coverage: string }[]
  testFiles: { path: string; lines: number; type: string; targets: string[] }[]
  summary: { totalSource: number; totalTests: number; covered: number; partial: number; uncovered: number; coveragePercent: number }
}

const COVERAGE_COLORS: Record<string, string> = { covered: 'green', partial: 'yellow', uncovered: 'red' }

function SourceNode({ data }: { data: { path: string; lines: number; exports: string[]; coverage: string; testedBy: string[] } }) {
  const name = data.path.split('/').pop() || data.path
  return (
    <div
      style={{ padding: 8, borderRadius: 8, border: `2px solid var(--mantine-color-${COVERAGE_COLORS[data.coverage] || 'gray'}-6)`, background: 'var(--mantine-color-body)', minWidth: 180, cursor: 'pointer' }}
      onDoubleClick={() => openInEditor(data.path)}
      title="Double-click to open in editor"
    >
      <Handle type="target" position={Position.Right} style={{ background: 'var(--mantine-color-green-6)' }} />
      <Handle type="source" position={Position.Left} style={{ background: 'var(--mantine-color-green-6)' }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={COVERAGE_COLORS[data.coverage] || 'gray'} variant="filled">{data.coverage}</Badge>
        <Text size="xs" fw={700} ff="monospace">{name}</Text>
      </Group>
      <Text size="xs" c="dimmed" ff="monospace">{data.path}</Text>
      <Group gap={8} mt={4}>
        <Text size="xs" c="dimmed">{data.lines} lines</Text>
        <Badge size="xs" variant="light" color="green">{data.exports.length} exports</Badge>
      </Group>
    </div>
  )
}

function TestNodeComp({ data }: { data: { path: string; lines: number; type: string } }) {
  const name = data.path.split('/').pop() || data.path
  const typeColor = data.type === 'unit' ? 'blue' : data.type === 'integration' ? 'green' : 'violet'
  return (
    <div
      style={{ padding: 8, borderRadius: 8, border: `1px solid var(--mantine-color-${typeColor}-6)`, background: 'var(--mantine-color-body)', minWidth: 180, cursor: 'pointer' }}
      onDoubleClick={() => openInEditor(data.path)}
      title="Double-click to open in editor"
    >
      <Handle type="target" position={Position.Left} style={{ background: `var(--mantine-color-${typeColor}-6)` }} />
      <Handle type="source" position={Position.Right} style={{ background: `var(--mantine-color-${typeColor}-6)` }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={typeColor} variant="filled">{data.type}</Badge>
        <Text size="xs" fw={700} ff="monospace">{name}</Text>
      </Group>
      <Text size="xs" c="dimmed">{data.lines} lines</Text>
    </div>
  )
}

const testNodeTypes = { source: SourceNode, test: TestNodeComp }

function TestCoverageFlow() {
  return <ReactFlowProvider><TestCoverageFlowInner /></ReactFlowProvider>
}

function TestCoverageFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'test-coverage'],
    queryFn: () => fetch('/api/admin/test-coverage', { credentials: 'include' }).then(r => r.json()) as Promise<TestCoverageData>,
  })
  const [filter, setFilter] = useState('all')
  const flow = useFlowAutoSave(storageKey('test-coverage'))

  useEffect(() => {
    if (!data?.sourceFiles) return
    const filtered = filter === 'all' ? data.sourceFiles : data.sourceFiles.filter(f => f.coverage === filter)
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Source files on left
    filtered.forEach((f, i) => {
      nodes.push({ id: f.path, type: 'source', position: flow.loadPos?.[f.path] ?? { x: 0, y: i * 100 }, data: f })
    })

    // Test files on right
    const testSet = new Set<string>()
    for (const f of filtered) for (const t of f.testedBy) testSet.add(t)
    const tests = data.testFiles.filter(t => testSet.has(t.path))
    tests.forEach((t, i) => {
      nodes.push({ id: t.path, type: 'test', position: flow.loadPos?.[t.path] ?? { x: 500, y: i * 100 }, data: t })
    })

    // Edges: test → source
    for (const t of tests) {
      for (const target of t.targets) {
        if (filtered.some(f => f.path === target)) {
          edges.push({
            id: `test_${t.path}_${target}`, source: t.path, target,
            style: { stroke: 'var(--mantine-color-green-4)', strokeWidth: 1 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
            animated: true,
          })
        }
      }
    }

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data, filter])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading coverage...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <SegmentedControl size="xs" value={filter} onChange={setFilter} data={[
          { label: `All (${data.summary.totalSource})`, value: 'all' },
          { label: `Covered (${data.summary.covered})`, value: 'covered' },
          { label: `Partial (${data.summary.partial})`, value: 'partial' },
          { label: `Uncovered (${data.summary.uncovered})`, value: 'uncovered' },
        ]} />
        <Badge size="sm" color={data.summary.coveragePercent >= 70 ? 'green' : data.summary.coveragePercent >= 40 ? 'yellow' : 'red'} variant="light">
          {data.summary.coveragePercent}% coverage
        </Badge>
        <Text size="xs" c="dimmed">{data.summary.totalTests} test files</Text>
        <LayoutSelector layoutKey={storageKey('test-coverage')} onLayout={flow.relayout} />
        <Tooltip label="Reload"><ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'test-coverage'] })}><TbRefresh size={16} /></ActionIcon></Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} onNodesChange={flow.handleNodesChange} onEdgesChange={flow.onEdgesChange} onMoveEnd={flow.handleMoveEnd} nodeTypes={testNodeTypes} defaultViewport={flow.savedVp ?? undefined} fitView={!flow.savedVp} fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Dependencies Flow ────────────────────────
interface DepData {
  packages: { name: string; version: string; type: string; category: string; usedBy: string[] }[]
  summary: { total: number; runtime: number; dev: number; byCategory: Record<string, number> }
}

function PackageNode({ data }: { data: { name: string; version: string; type: string; category: string; usedBy: string[] } }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, border: `1px solid var(--mantine-color-${data.type === 'runtime' ? 'green' : 'orange'}-6)`, background: 'var(--mantine-color-body)', minWidth: 180 }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--mantine-color-blue-6)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--mantine-color-blue-6)' }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={data.type === 'runtime' ? 'green' : 'orange'} variant="filled">{data.type}</Badge>
        <Badge size="xs" color={CATEGORY_COLORS[data.category] || 'gray'} variant="light">{data.category}</Badge>
      </Group>
      <Text size="xs" fw={700} ff="monospace">{data.name}</Text>
      <Text size="xs" c="dimmed">{data.version}</Text>
      {data.usedBy.length > 0 && <Badge size="xs" variant="light" mt={4}>{data.usedBy.length} files</Badge>}
    </div>
  )
}

const depNodeTypes = { package: PackageNode, file: FileNode2 }

function DependenciesFlow() {
  return <ReactFlowProvider><DependenciesFlowInner /></ReactFlowProvider>
}

function DependenciesFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'dependencies'],
    queryFn: () => fetch('/api/admin/dependencies', { credentials: 'include' }).then(r => r.json()) as Promise<DepData>,
  })
  const [filter, setFilter] = useState('all')
  const flow = useFlowAutoSave(storageKey('dependencies'))

  useEffect(() => {
    if (!data?.packages) return
    const filtered = filter === 'all' ? data.packages : data.packages.filter(p => p.type === filter)
    const nodes: Node[] = []
    const edges: Edge[] = []
    const categories = [...new Set(filtered.map(p => p.category))]
    let colX = 0

    for (const cat of categories) {
      const pkgs = filtered.filter(p => p.category === cat)
      pkgs.forEach((p, i) => {
        const id = `pkg_${p.name}`
        nodes.push({ id, type: 'package', position: flow.loadPos?.[id] ?? { x: colX, y: i * 110 }, data: p })
      })
      colX += 280
    }

    // Add consumer files
    const consumerFiles = new Set<string>()
    for (const p of filtered) for (const f of p.usedBy) consumerFiles.add(f)
    const files = Array.from(consumerFiles)
    files.forEach((f, i) => {
      const id = `file_${f}`
      nodes.push({ id, type: 'file', position: flow.loadPos?.[id] ?? { x: colX, y: i * 110 }, data: { path: f, category: 'backend', lines: 0, exports: [], imports: [] } })
    })

    // Edges
    for (const p of filtered) {
      for (const f of p.usedBy) {
        edges.push({
          id: `dep_${p.name}_${f}`, source: `pkg_${p.name}`, target: `file_${f}`,
          style: { stroke: 'var(--mantine-color-blue-4)', strokeWidth: 1 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
        })
      }
    }

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data, filter])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading dependencies...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <SegmentedControl size="xs" value={filter} onChange={setFilter} data={[
          { label: `All (${data.summary.total})`, value: 'all' },
          { label: `Runtime (${data.summary.runtime})`, value: 'runtime' },
          { label: `Dev (${data.summary.dev})`, value: 'dev' },
        ]} />
        {Object.entries(data.summary.byCategory).map(([c, n]) => (
          <Badge key={c} size="sm" variant="light" color={CATEGORY_COLORS[c] || 'gray'}>{c}: {n}</Badge>
        ))}
        <LayoutSelector layoutKey={storageKey('dependencies')} onLayout={flow.relayout} />
        <Tooltip label="Reload"><ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'dependencies'] })}><TbRefresh size={16} /></ActionIcon></Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} onNodesChange={flow.handleNodesChange} onEdgesChange={flow.onEdgesChange} onMoveEnd={flow.handleMoveEnd} nodeTypes={depNodeTypes} defaultViewport={flow.savedVp ?? undefined} fitView={!flow.savedVp} fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Migrations Flow ──────────────────────────
interface MigrationData {
  migrations: { name: string; folder: string; createdAt: string; changes: string[]; sql: string }[]
  summary: { totalMigrations: number; firstMigration: string | null; lastMigration: string | null; totalChanges: number }
}

function MigrationNode({ data }: { data: { name: string; createdAt: string; changes: string[]; sql: string } }) {
  const [showSql, setShowSql] = useState(false)
  const date = new Date(data.createdAt).toLocaleDateString()
  return (
    <div style={{ padding: 10, borderRadius: 8, border: '1px solid var(--mantine-color-default-border)', background: 'var(--mantine-color-body)', minWidth: 220, maxWidth: 260 }}>
      <Handle type="target" position={Position.Left} style={{ background: 'var(--mantine-color-orange-6)' }} />
      <Handle type="source" position={Position.Right} style={{ background: 'var(--mantine-color-orange-6)' }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color="orange" variant="filled">{date}</Badge>
      </Group>
      <Text size="xs" fw={700} ff="monospace" lineClamp={1}>{data.name}</Text>
      <Stack gap={2} mt={4}>
        {data.changes.map((c, i) => {
          const color = c.startsWith('CREATE') ? 'green' : c.startsWith('ALTER') ? 'yellow' : c.startsWith('DROP') ? 'red' : 'gray'
          return <Badge key={i} size="xs" variant="light" color={color} ff="monospace">{c}</Badge>
        })}
      </Stack>
      {data.sql && (
        <Text size="xs" c="blue" mt={4} style={{ cursor: 'pointer' }} onClick={() => setShowSql(!showSql)}>{showSql ? 'Hide SQL' : 'Show SQL'}</Text>
      )}
      {showSql && <Text size="xs" ff="monospace" c="dimmed" mt={4} style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto' }}>{data.sql}</Text>}
    </div>
  )
}

const migrationNodeTypes = { migration: MigrationNode }

function MigrationsFlow() {
  return <ReactFlowProvider><MigrationsFlowInner /></ReactFlowProvider>
}

function MigrationsFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'migrations'],
    queryFn: () => fetch('/api/admin/migrations', { credentials: 'include' }).then(r => r.json()) as Promise<MigrationData>,
  })
  const flow = useFlowAutoSave(storageKey('migrations'))

  useEffect(() => {
    if (!data?.migrations) return
    const nodes: Node[] = []
    const edges: Edge[] = []

    data.migrations.forEach((m, i) => {
      const id = `mig_${m.folder}`
      nodes.push({ id, type: 'migration', position: flow.loadPos?.[id] ?? { x: i * 320, y: 0 }, data: m })
      if (i > 0) {
        const prevId = `mig_${data.migrations[i - 1].folder}`
        edges.push({
          id: `mig_e_${i}`, source: prevId, target: id,
          label: `#${i + 1}`,
          labelStyle: { fontSize: 9 },
          style: { stroke: 'var(--mantine-color-orange-4)', strokeWidth: 2 },
          markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
          animated: true,
        })
      }
    })

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading migrations...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <Badge size="sm" color="orange" variant="light">{data.summary.totalMigrations} migrations</Badge>
        <Badge size="sm" variant="light">{data.summary.totalChanges} changes</Badge>
        {data.summary.firstMigration && <Text size="xs" c="dimmed">From {new Date(data.summary.firstMigration).toLocaleDateString()} → {new Date(data.summary.lastMigration!).toLocaleDateString()}</Text>}
        <LayoutSelector layoutKey={storageKey('migrations')} onLayout={flow.relayout} />
        <Tooltip label="Reload"><ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'migrations'] })}><TbRefresh size={16} /></ActionIcon></Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} onNodesChange={flow.handleNodesChange} onEdgesChange={flow.onEdgesChange} onMoveEnd={flow.handleMoveEnd} nodeTypes={migrationNodeTypes} defaultViewport={flow.savedVp ?? undefined} fitView={!flow.savedVp} fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Sessions Flow ────────────────────────────
interface SessionData {
  sessions: { id: string; userId: string; userName: string; userEmail: string; userRole: string; userBlocked: boolean; isOnline: boolean; createdAt: string; expiresAt: string; isExpired: boolean }[]
  summary: { totalSessions: number; activeSessions: number; expiredSessions: number; onlineUsers: number; byRole: Record<string, number> }
}

function SessionUserNode({ data }: { data: { userName: string; userEmail: string; userRole: string; userBlocked: boolean; isOnline: boolean; sessionCount: number; isExpired: boolean } }) {
  const roleColor = data.userRole === 'SUPER_ADMIN' ? 'red' : data.userRole === 'ADMIN' ? 'orange' : 'blue'
  return (
    <div style={{ padding: 8, borderRadius: 8, border: `2px solid var(--mantine-color-${data.userBlocked ? 'red' : roleColor}-6)`, background: 'var(--mantine-color-body)', minWidth: 180 }}>
      <Handle type="source" position={Position.Right} style={{ background: `var(--mantine-color-${roleColor}-6)` }} />
      <Group gap={6} mb={4}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: `var(--mantine-color-${data.isOnline ? 'green' : 'gray'}-6)` }} />
        <Text size="xs" fw={700}>{data.userName}</Text>
      </Group>
      <Text size="xs" c="dimmed">{data.userEmail}</Text>
      <Group gap={4} mt={4}>
        <Badge size="xs" color={roleColor} variant="filled">{data.userRole}</Badge>
        {data.userBlocked && <Badge size="xs" color="red" variant="filled">BLOCKED</Badge>}
        <Badge size="xs" variant="light">{data.sessionCount} sessions</Badge>
      </Group>
    </div>
  )
}

function RoleAccessNode({ data }: { data: { label: string; routes: string[]; color: string; count: number } }) {
  return (
    <div style={{ padding: 8, borderRadius: 8, border: `2px solid var(--mantine-color-${data.color}-6)`, background: 'var(--mantine-color-body)', minWidth: 150 }}>
      <Handle type="target" position={Position.Left} style={{ background: `var(--mantine-color-${data.color}-6)` }} />
      <Handle type="source" position={Position.Right} style={{ background: `var(--mantine-color-${data.color}-6)` }} />
      <Text size="xs" fw={700}>{data.label}</Text>
      <Badge size="xs" variant="light" color={data.color} mt={4}>{data.count} users</Badge>
      <Stack gap={2} mt={4}>
        {data.routes.map(r => <Text key={r} size="xs" c="dimmed" ff="monospace">{r}</Text>)}
      </Stack>
    </div>
  )
}

const sessionNodeTypes = { sessionUser: SessionUserNode, roleAccess: RoleAccessNode }

function SessionsFlow() {
  return <ReactFlowProvider><SessionsFlowInner /></ReactFlowProvider>
}

function SessionsFlowInner() {
  const qc = useQueryClient()
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin', 'sessions'],
    queryFn: () => fetch('/api/admin/sessions', { credentials: 'include' }).then(r => r.json()) as Promise<SessionData>,
    refetchInterval: 10000,
  })
  const flow = useFlowAutoSave(storageKey('sessions'))

  useEffect(() => {
    if (!data?.sessions) return
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Group sessions by user
    const userMap = new Map<string, typeof data.sessions>()
    for (const s of data.sessions) {
      if (!userMap.has(s.userId)) userMap.set(s.userId, [])
      userMap.get(s.userId)!.push(s)
    }

    let userY = 0
    for (const [userId, sessions] of userMap) {
      const first = sessions[0]
      const id = `user_${userId}`
      nodes.push({
        id, type: 'sessionUser',
        position: flow.loadPos?.[id] ?? { x: 0, y: userY },
        data: { ...first, sessionCount: sessions.length, isExpired: sessions.every(s => s.isExpired) },
      })
      userY += 100
    }

    // Role nodes
    const roles: { role: string; color: string; routes: string[] }[] = [
      { role: 'SUPER_ADMIN', color: 'red', routes: ['/dev', '/dashboard', '/profile'] },
      { role: 'ADMIN', color: 'orange', routes: ['/dashboard', '/profile'] },
      { role: 'USER', color: 'blue', routes: ['/profile'] },
    ]

    roles.forEach((r, i) => {
      const id = `role_${r.role}`
      nodes.push({
        id, type: 'roleAccess',
        position: flow.loadPos?.[id] ?? { x: 350, y: i * 150 },
        data: { label: r.role, routes: r.routes, color: r.color, count: data.summary.byRole[r.role] || 0 },
      })
    })

    // Edges: user → role
    for (const [userId, sessions] of userMap) {
      const role = sessions[0].userRole
      edges.push({
        id: `sess_${userId}_${role}`, source: `user_${userId}`, target: `role_${role}`,
        style: { stroke: `var(--mantine-color-${role === 'SUPER_ADMIN' ? 'red' : role === 'ADMIN' ? 'orange' : 'blue'}-4)`, strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
        animated: sessions.some(s => s.isOnline),
      })
    }

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [data])

  if (isLoading) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">Loading sessions...</Text></Stack>
  if (!data) return <Stack align="center" justify="center" mih={400}><Text c="dimmed">No data</Text></Stack>

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <Badge size="sm" color="green" variant="light">Active: {data.summary.activeSessions}</Badge>
        <Badge size="sm" color="gray" variant="light">Expired: {data.summary.expiredSessions}</Badge>
        <Badge size="sm" color="teal" variant="light">Online: {data.summary.onlineUsers}</Badge>
        <Text size="xs" c="dimmed">Auto-refresh 10s</Text>
        <LayoutSelector layoutKey={storageKey('sessions')} onLayout={flow.relayout} />
        <Tooltip label="Reload"><ActionIcon variant="subtle" size="sm" loading={isFetching} onClick={() => qc.invalidateQueries({ queryKey: ['admin', 'sessions'] })}><TbRefresh size={16} /></ActionIcon></Tooltip>
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} onNodesChange={flow.handleNodesChange} onEdgesChange={flow.onEdgesChange} onMoveEnd={flow.handleMoveEnd} nodeTypes={sessionNodeTypes} defaultViewport={flow.savedVp ?? undefined} fitView={!flow.savedVp} fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls />
        </ReactFlow>
      </div>
    </>
  )
}

// ─── Live Requests Flow ───────────────────────
interface RequestEvent { method: string; path: string; status: number; duration: number; timestamp: string }

function EndpointHitNode({ data }: { data: { method: string; path: string; hits: number; lastStatus: number; avgDuration: number } }) {
  const statusColor = data.lastStatus >= 500 ? 'red' : data.lastStatus >= 400 ? 'yellow' : 'green'
  return (
    <div style={{ padding: 8, borderRadius: 8, border: `2px solid var(--mantine-color-${statusColor}-6)`, background: 'var(--mantine-color-body)', minWidth: 200, boxShadow: data.hits > 0 ? `0 0 ${Math.min(data.hits * 2, 20)}px var(--mantine-color-${statusColor}-3)` : undefined }}>
      <Handle type="target" position={Position.Left} style={{ background: `var(--mantine-color-${statusColor}-6)` }} />
      <Group gap={6} mb={4}>
        <Badge size="xs" color={METHOD_COLORS[data.method] || 'gray'} variant="filled">{data.method}</Badge>
        <Text size="xs" fw={700} ff="monospace">{data.path}</Text>
      </Group>
      <Group gap={8}>
        <Badge size="xs" variant="light" color={statusColor}>{data.lastStatus || '—'}</Badge>
        <Text size="xs" c="dimmed">{data.hits} hits</Text>
        {data.avgDuration > 0 && <Text size="xs" c="dimmed">{data.avgDuration}ms avg</Text>}
      </Group>
    </div>
  )
}

const liveNodeTypes = { endpoint: EndpointHitNode, flow: FlowNode }

function LiveRequestsFlow() {
  return <ReactFlowProvider><LiveRequestsFlowInner /></ReactFlowProvider>
}

function LiveRequestsFlowInner() {
  const flow = useFlowAutoSave(storageKey('live-requests'))
  const [events, setEvents] = useState<RequestEvent[]>([])
  const [paused, setPaused] = useState(false)
  const statsRef = useRef<Map<string, { hits: number; totalDuration: number; lastStatus: number }>>(new Map())
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  // Subscribe to WS for request events
  useEffect(() => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/presence`)

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'request' && !pausedRef.current) {
          const evt: RequestEvent = msg
          setEvents(prev => [...prev.slice(-99), evt])

          // Update stats
          const key = `${evt.method}_${evt.path}`
          const stat = statsRef.current.get(key) || { hits: 0, totalDuration: 0, lastStatus: 200 }
          stat.hits++
          stat.totalDuration += evt.duration
          stat.lastStatus = evt.status
          statsRef.current.set(key, stat)
        }
      } catch {}
    }

    return () => ws.close()
  }, [])

  // Build nodes from accumulated stats
  useEffect(() => {
    const nodes: Node[] = []
    const edges: Edge[] = []

    // Server node
    nodes.push({
      id: 'server', type: 'flow',
      position: flow.loadPos?.['server'] ?? { x: 0, y: 200 },
      data: { label: 'Elysia Server', color: 'green', description: `${events.length} requests captured` },
    })

    const entries = Array.from(statsRef.current.entries())
    entries.forEach(([key, stat], i) => {
      const [method, ...pathParts] = key.split('_')
      const path = pathParts.join('_')
      nodes.push({
        id: key, type: 'endpoint',
        position: flow.loadPos?.[key] ?? { x: 350, y: i * 80 },
        data: { method, path, hits: stat.hits, lastStatus: stat.lastStatus, avgDuration: Math.round(stat.totalDuration / stat.hits) },
      })
      edges.push({
        id: `live_${key}`, source: 'server', target: key,
        style: { stroke: `var(--mantine-color-${stat.lastStatus >= 500 ? 'red' : stat.lastStatus >= 400 ? 'yellow' : 'green'}-4)`, strokeWidth: Math.min(1 + stat.hits * 0.3, 5) },
        markerEnd: { type: MarkerType.ArrowClosed, width: 10, height: 10 },
        animated: true,
      })
    })

    flow.setNodes(nodes)
    flow.setEdges(edges)
  }, [events])

  const totalHits = Array.from(statsRef.current.values()).reduce((s, v) => s + v.hits, 0)
  const errorCount = Array.from(statsRef.current.values()).filter(v => v.lastStatus >= 400).length

  return (
    <>
      <Group px="md" pb="xs" gap="sm">
        <Badge size="sm" color="green" variant="light">{totalHits} requests</Badge>
        <Badge size="sm" color="blue" variant="light">{statsRef.current.size} endpoints</Badge>
        {errorCount > 0 && <Badge size="sm" color="red" variant="light">{errorCount} errors</Badge>}
        <ActionIcon variant={paused ? 'filled' : 'subtle'} size="sm" color={paused ? 'red' : 'green'} onClick={() => setPaused(!paused)}>
          {paused ? <TbCircleFilled size={12} /> : <TbWifi size={16} />}
        </ActionIcon>
        <Text size="xs" c="dimmed">{paused ? 'Paused' : 'Live'}</Text>
        <ActionIcon variant="subtle" size="sm" onClick={() => { statsRef.current.clear(); setEvents([]) }}>
          <TbTrash size={16} />
        </ActionIcon>
        <LayoutSelector layoutKey={storageKey('live-requests')} onLayout={flow.relayout} />
      </Group>
      <div style={{ flex: 1 }}>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} onNodesChange={flow.handleNodesChange} onEdgesChange={flow.onEdgesChange} onMoveEnd={flow.handleMoveEnd} nodeTypes={liveNodeTypes} defaultViewport={flow.savedVp ?? undefined} fitView={!flow.savedVp} fitViewOptions={{ padding: 0.2 }} proOptions={{ hideAttribution: true }}>
          <Background gap={20} size={1} /><Controls />
        </ReactFlow>
      </div>
    </>
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
