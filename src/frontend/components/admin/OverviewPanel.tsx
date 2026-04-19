import { ActionIcon, Badge, Card, Group, SimpleGrid, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  TbActivity,
  TbAlertTriangle,
  TbListCheck,
  TbPlugConnected,
  TbRefresh,
  TbTarget,
  type TbUsers,
  TbUsersGroup,
} from 'react-icons/tb'
import type { Role } from '@/frontend/hooks/useAuth'

interface AdminUser {
  id: string
  role: Role
  blocked: boolean
}

interface AgentRow {
  id: string
  status: 'PENDING' | 'APPROVED' | 'REVOKED'
  lastSeenAt: string | null
}

interface ProjectRow {
  id: string
  status: 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
}

interface TaskRow {
  id: string
  status: 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
  dueAt: string | null
}

interface AuditLogEntry {
  id: string
  userId: string | null
  action: string
  detail: string | null
  createdAt: string
  user: { name: string; email: string } | null
}

const LIVE_THRESHOLD_MS = 5 * 60 * 1000

const ACTION_COLOR: Record<string, string> = {
  LOGIN: 'green',
  LOGOUT: 'gray',
  LOGIN_FAILED: 'orange',
  LOGIN_BLOCKED: 'red',
  ROLE_CHANGED: 'violet',
  BLOCKED: 'red',
  UNBLOCKED: 'teal',
  PROJECT_MEMBER_ROLE_CHANGED: 'grape',
  TASK_CREATED: 'blue',
  AGENT_APPROVED: 'teal',
  AGENT_REVOKED: 'red',
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (mins > 0) return `${mins}m ago`
  return 'just now'
}

export function OverviewPanel() {
  const navigate = useNavigate()

  const usersQ = useQuery({
    queryKey: ['admin', 'overview', 'users'],
    queryFn: () =>
      fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()) as Promise<{ users: AdminUser[] }>,
    refetchInterval: 30_000,
  })

  const projectsQ = useQuery({
    queryKey: ['admin', 'overview', 'projects'],
    queryFn: () =>
      fetch('/api/projects', { credentials: 'include' }).then((r) => r.json()) as Promise<{ projects: ProjectRow[] }>,
    refetchInterval: 30_000,
  })

  const tasksQ = useQuery({
    queryKey: ['admin', 'overview', 'tasks'],
    queryFn: () =>
      fetch('/api/tasks?limit=500', { credentials: 'include' }).then((r) => r.json()) as Promise<{ tasks: TaskRow[] }>,
    refetchInterval: 30_000,
  })

  const agentsQ = useQuery({
    queryKey: ['admin', 'overview', 'agents'],
    queryFn: () =>
      fetch('/api/admin/agents', { credentials: 'include' }).then((r) => r.json()) as Promise<{ agents: AgentRow[] }>,
    refetchInterval: 30_000,
  })

  const auditQ = useQuery({
    queryKey: ['admin', 'overview', 'audit'],
    queryFn: () =>
      fetch('/api/admin/logs/audit?limit=8', { credentials: 'include' }).then((r) => r.json()) as Promise<{
        logs: AuditLogEntry[]
      }>,
    refetchInterval: 30_000,
  })

  const loading = usersQ.isLoading || projectsQ.isLoading || tasksQ.isLoading || agentsQ.isLoading || auditQ.isLoading
  const fetching =
    usersQ.isFetching || projectsQ.isFetching || tasksQ.isFetching || agentsQ.isFetching || auditQ.isFetching

  const stats = useMemo(() => {
    const users = usersQ.data?.users ?? []
    const projects = projectsQ.data?.projects ?? []
    const tasks = tasksQ.data?.tasks ?? []
    const agents = agentsQ.data?.agents ?? []
    const now = Date.now()

    const blocked = users.filter((u) => u.blocked).length
    const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length
    const openTasks = tasks.filter((t) => t.status !== 'CLOSED').length
    const overdueTasks = tasks.filter(
      (t) => t.status !== 'CLOSED' && t.dueAt && new Date(t.dueAt).getTime() < now,
    ).length
    const liveAgents = agents.filter(
      (a) => a.status === 'APPROVED' && a.lastSeenAt && now - new Date(a.lastSeenAt).getTime() < LIVE_THRESHOLD_MS,
    ).length
    const pendingAgents = agents.filter((a) => a.status === 'PENDING').length

    return {
      totalUsers: users.length,
      blocked,
      activeProjects,
      totalProjects: projects.length,
      openTasks,
      overdueTasks,
      liveAgents,
      pendingAgents,
    }
  }, [usersQ.data, projectsQ.data, tasksQ.data, agentsQ.data])

  const refetchAll = () => {
    usersQ.refetch()
    projectsQ.refetch()
    tasksQ.refetch()
    agentsQ.refetch()
    auditQ.refetch()
  }

  const logs = auditQ.data?.logs ?? []

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Admin Overview</Title>
          <Text c="dimmed" size="sm">
            Ringkasan sistem real-time. Auto-refresh 30 detik.
          </Text>
        </div>
        <Tooltip label="Refresh all">
          <ActionIcon variant="subtle" onClick={refetchAll} loading={fetching}>
            <TbRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
        <KpiCard
          label="Total Users"
          value={loading ? '—' : stats.totalUsers}
          sub={stats.blocked > 0 ? `${stats.blocked} blocked` : 'none blocked'}
          subColor={stats.blocked > 0 ? 'red' : undefined}
          icon={TbUsersGroup}
          color="violet"
          onClick={() => navigate({ to: '/admin', search: { tab: 'users' } })}
        />
        <KpiCard
          label="Active Projects"
          value={loading ? '—' : stats.activeProjects}
          sub={`of ${stats.totalProjects} total`}
          icon={TbTarget}
          color="blue"
          onClick={() => navigate({ to: '/admin', search: { tab: 'projects' } })}
        />
        <KpiCard
          label="Open Tasks"
          value={loading ? '—' : stats.openTasks}
          sub={stats.overdueTasks > 0 ? `${stats.overdueTasks} overdue` : 'none overdue'}
          subColor={stats.overdueTasks > 0 ? 'red' : undefined}
          icon={TbListCheck}
          color="red"
          onClick={() => navigate({ to: '/admin', search: { tab: 'tasks' } })}
        />
        <KpiCard
          label="Live Agents"
          value={loading ? '—' : stats.liveAgents}
          sub={stats.pendingAgents > 0 ? `${stats.pendingAgents} pending approval` : 'all approved'}
          subColor={stats.pendingAgents > 0 ? 'orange' : undefined}
          icon={TbPlugConnected}
          color="teal"
        />
      </SimpleGrid>

      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Group gap="xs" justify="space-between">
            <Group gap="xs">
              <TbActivity size={16} />
              <Title order={5}>Recent Activity</Title>
            </Group>
            <Text size="xs" c="dimmed">
              last 8 entries
            </Text>
          </Group>
          {logs.length === 0 && !auditQ.isLoading && (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Belum ada aktivitas.
            </Text>
          )}
          {logs.map((log) => (
            <Group key={log.id} gap="sm" wrap="nowrap" align="flex-start">
              <Badge color={ACTION_COLOR[log.action] ?? 'gray'} variant="light" size="sm">
                {log.action}
              </Badge>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" lineClamp={1}>
                  <Text component="span" fw={500}>
                    {log.user?.name ?? 'system'}
                  </Text>
                  {log.detail ? (
                    <Text component="span" c="dimmed">
                      {' '}
                      — {log.detail}
                    </Text>
                  ) : null}
                </Text>
              </div>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {formatRelative(log.createdAt)}
              </Text>
            </Group>
          ))}
        </Stack>
      </Card>

      {stats.pendingAgents > 0 && (
        <Card withBorder padding="md" radius="md">
          <Group gap="sm">
            <ThemeIcon variant="light" color="orange" size="lg" radius="md">
              <TbAlertTriangle size={18} />
            </ThemeIcon>
            <div style={{ flex: 1 }}>
              <Text size="sm" fw={500}>
                {stats.pendingAgents} agent{stats.pendingAgents > 1 ? 's' : ''} menunggu persetujuan
              </Text>
              <Text size="xs" c="dimmed">
                Approve di Dev Console → Agents panel (SUPER_ADMIN only).
              </Text>
            </div>
          </Group>
        </Card>
      )}
    </Stack>
  )
}

function KpiCard({
  label,
  value,
  sub,
  subColor,
  icon: Icon,
  color,
  onClick,
}: {
  label: string
  value: string | number
  sub?: string
  subColor?: string
  icon: typeof TbUsers
  color: string
  onClick?: () => void
}) {
  return (
    <Card withBorder padding="lg" radius="md" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={2} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            {label}
          </Text>
          <Text fw={700} size="xl">
            {value}
          </Text>
          {sub && (
            <Text size="xs" c={subColor ?? 'dimmed'}>
              {sub}
            </Text>
          )}
        </Stack>
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          <Icon size={20} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}
