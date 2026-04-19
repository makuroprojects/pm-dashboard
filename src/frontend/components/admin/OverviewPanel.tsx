import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Group,
  Progress,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import {
  TbActivity,
  TbAlertTriangle,
  TbFlame,
  TbHeartbeat,
  TbListCheck,
  TbPlugConnected,
  TbRefresh,
  TbShieldCheck,
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

type RiskSeverity = 'none' | 'low' | 'medium' | 'high'

interface RiskReport {
  severity: RiskSeverity
  summary: {
    overdueTasks: number
    staleTasks: number
    pastDueProjects: number
    pendingAgents: number
    offlineAgents: number
    missingEnv: number
  }
  overdueTasks: Array<{
    id: string
    title: string
    priority: string
    daysOverdue: number | null
    assignee: string | null
    project: string
    projectId: string
  }>
  staleTasks: Array<{
    id: string
    title: string
    priority: string
    daysStale: number
    assignee: string | null
    project: string
    projectId: string
  }>
  pastDueProjects: Array<{ id: string; name: string; priority: string; owner: string; daysOverdue: number | null }>
  pendingAgents: Array<{ id: string; agentId: string; hostname: string; osUser: string }>
  offlineAgents: Array<{ id: string; agentId: string; hostname: string; lastSeenAt: string }>
  missingEnv: string[]
}

interface HealthRow {
  id: string
  name: string
  status: string
  priority: string
  owner: string
  endsAt: string | null
  daysUntilDue: number | null
  pastDue: boolean
  openTasks: number
  overdueTasks: number
  blockedTasks: number
  closed7d: number
  extensions: number
  score: number
  grade: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
}

interface LoadRow {
  userId: string | null
  email: string | null
  name: string
  role: string | null
  open: number
  estimateHours: number
  highPriority: number
  overdue: number
  closed7d: number
  overloaded: boolean
}

const LIVE_THRESHOLD_MS = 5 * 60 * 1000

const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  none: 'teal',
  low: 'blue',
  medium: 'orange',
  high: 'red',
}

const GRADE_COLOR: Record<string, string> = {
  A: 'teal',
  B: 'green',
  C: 'yellow',
  D: 'orange',
  E: 'red',
  F: 'red',
}

const PRIORITY_COLOR: Record<string, string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

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

  const risksQ = useQuery({
    queryKey: ['admin', 'overview', 'risks'],
    queryFn: () =>
      fetch('/api/admin/overview/risks', { credentials: 'include' }).then((r) => r.json()) as Promise<RiskReport>,
    refetchInterval: 30_000,
  })

  const healthQ = useQuery({
    queryKey: ['admin', 'overview', 'health'],
    queryFn: () =>
      fetch('/api/admin/overview/health?limit=12', { credentials: 'include' }).then((r) => r.json()) as Promise<{
        count: number
        projects: HealthRow[]
      }>,
    refetchInterval: 60_000,
  })

  const loadQ = useQuery({
    queryKey: ['admin', 'overview', 'load'],
    queryFn: () =>
      fetch('/api/admin/overview/load?includeUnassigned=false&limit=12', { credentials: 'include' }).then((r) =>
        r.json(),
      ) as Promise<{ count: number; rows: LoadRow[] }>,
    refetchInterval: 60_000,
  })

  const loading = usersQ.isLoading || projectsQ.isLoading || tasksQ.isLoading || agentsQ.isLoading || auditQ.isLoading
  const fetching =
    usersQ.isFetching ||
    projectsQ.isFetching ||
    tasksQ.isFetching ||
    agentsQ.isFetching ||
    auditQ.isFetching ||
    risksQ.isFetching ||
    healthQ.isFetching ||
    loadQ.isFetching

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
    risksQ.refetch()
    healthQ.refetch()
    loadQ.refetch()
  }

  const logs = auditQ.data?.logs ?? []

  const lastFetchedAt = useMemo(() => {
    const updates = [
      usersQ.dataUpdatedAt,
      projectsQ.dataUpdatedAt,
      tasksQ.dataUpdatedAt,
      agentsQ.dataUpdatedAt,
      auditQ.dataUpdatedAt,
      risksQ.dataUpdatedAt,
      healthQ.dataUpdatedAt,
      loadQ.dataUpdatedAt,
    ].filter((t) => t > 0)
    return updates.length ? Math.min(...updates) : 0
  }, [
    usersQ.dataUpdatedAt,
    projectsQ.dataUpdatedAt,
    tasksQ.dataUpdatedAt,
    agentsQ.dataUpdatedAt,
    auditQ.dataUpdatedAt,
    risksQ.dataUpdatedAt,
    healthQ.dataUpdatedAt,
    loadQ.dataUpdatedAt,
  ])

  const freshness = useFreshness(lastFetchedAt)

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Title order={2}>Admin Overview</Title>
          <Text c="dimmed" size="sm">
            Ringkasan sistem real-time. Auto-refresh 30 detik.
          </Text>
        </div>
        <Group gap="xs">
          {freshness && (
            <Text size="xs" c="dimmed">
              updated {freshness}
            </Text>
          )}
          <Tooltip label="Refresh all">
            <ActionIcon variant="subtle" onClick={refetchAll} loading={fetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
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

      {risksQ.isLoading ? (
        <SectionSkeleton height={220} />
      ) : (
        risksQ.data && <RedFlagsSection risks={risksQ.data} navigate={navigate} />
      )}

      {healthQ.isLoading ? (
        <SectionSkeleton height={180} />
      ) : (
        healthQ.data &&
        healthQ.data.projects.length > 0 && <PortfolioHealthSection rows={healthQ.data.projects} navigate={navigate} />
      )}

      {loadQ.isLoading ? (
        <SectionSkeleton height={160} />
      ) : (
        loadQ.data && loadQ.data.rows.length > 0 && <TeamLoadSection rows={loadQ.data.rows} />
      )}

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

function RedFlagsSection({ risks, navigate }: { risks: RiskReport; navigate: ReturnType<typeof useNavigate> }) {
  const s = risks.summary
  const nothing =
    s.overdueTasks + s.staleTasks + s.pastDueProjects + s.pendingAgents + s.offlineAgents + s.missingEnv === 0

  if (nothing) {
    return (
      <Alert color="teal" icon={<TbShieldCheck size={18} />} variant="light">
        <Text size="sm" fw={500}>
          Semua sistem hijau — tidak ada red flag saat ini.
        </Text>
      </Alert>
    )
  }

  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" justify="space-between" mb="sm">
        <Group gap="xs">
          <ThemeIcon variant="light" color={SEVERITY_COLOR[risks.severity]} size="md" radius="md">
            <TbFlame size={16} />
          </ThemeIcon>
          <Title order={5}>Red flags</Title>
          <Badge color={SEVERITY_COLOR[risks.severity]} variant="light" size="sm">
            {risks.severity.toUpperCase()}
          </Badge>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }} spacing="xs" mb="md">
        <RiskStat label="Overdue tasks" value={s.overdueTasks} color={s.overdueTasks > 0 ? 'red' : 'gray'} />
        <RiskStat label="Stale IN_PROGRESS" value={s.staleTasks} color={s.staleTasks > 0 ? 'orange' : 'gray'} />
        <RiskStat label="Past-due projects" value={s.pastDueProjects} color={s.pastDueProjects > 0 ? 'red' : 'gray'} />
        <RiskStat label="Pending agents" value={s.pendingAgents} color={s.pendingAgents > 0 ? 'orange' : 'gray'} />
        <RiskStat label="Offline agents" value={s.offlineAgents} color={s.offlineAgents > 0 ? 'yellow' : 'gray'} />
        <RiskStat label="Missing env" value={s.missingEnv} color={s.missingEnv > 0 ? 'red' : 'gray'} />
      </SimpleGrid>

      {risks.missingEnv.length > 0 && (
        <Alert color="red" variant="light" mb="xs">
          <Text size="xs" fw={500}>
            Missing env: {risks.missingEnv.join(', ')}
          </Text>
        </Alert>
      )}

      {risks.overdueTasks.length > 0 && (
        <Stack gap={4} mb="sm">
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            Overdue — top 5
          </Text>
          {risks.overdueTasks.slice(0, 5).map((t) => (
            <Group key={t.id} gap="xs" wrap="nowrap">
              <Badge size="xs" color={PRIORITY_COLOR[t.priority] ?? 'gray'} variant="outline">
                {t.priority}
              </Badge>
              <Text
                size="sm"
                style={{ flex: 1, cursor: 'pointer' }}
                truncate
                onClick={() => navigate({ to: '/admin', search: { tab: 'projects' } })}
              >
                {t.title}
              </Text>
              <Text size="xs" c="red">
                {t.daysOverdue ?? 0}d overdue
              </Text>
              <Text size="xs" c="dimmed" style={{ minWidth: 120, textAlign: 'right' }} truncate>
                {t.assignee ?? 'unassigned'}
              </Text>
            </Group>
          ))}
        </Stack>
      )}

      {risks.pastDueProjects.length > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            Past-due projects
          </Text>
          {risks.pastDueProjects.slice(0, 3).map((p) => (
            <Group key={p.id} gap="xs" wrap="nowrap">
              <Badge size="xs" color={PRIORITY_COLOR[p.priority] ?? 'gray'} variant="outline">
                {p.priority}
              </Badge>
              <Text size="sm" style={{ flex: 1 }} truncate>
                {p.name}
              </Text>
              <Text size="xs" c="red">
                {p.daysOverdue ?? 0}d past
              </Text>
              <Text size="xs" c="dimmed" style={{ minWidth: 120, textAlign: 'right' }} truncate>
                {p.owner}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  )
}

function RiskStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={500} tt="uppercase">
        {label}
      </Text>
      <Text fw={700} size="lg" c={value > 0 ? color : undefined}>
        {value}
      </Text>
    </div>
  )
}

function PortfolioHealthSection({ rows, navigate }: { rows: HealthRow[]; navigate: ReturnType<typeof useNavigate> }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="blue" size="md" radius="md">
          <TbHeartbeat size={16} />
        </ThemeIcon>
        <Title order={5}>Portfolio health</Title>
        <Text size="xs" c="dimmed">
          sorted by score (worst first)
        </Text>
      </Group>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="xs">
        {rows.map((r) => (
          <Card
            key={r.id}
            withBorder
            padding="sm"
            radius="md"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate({ to: '/admin', search: { tab: 'projects' } })}
          >
            <Group justify="space-between" wrap="nowrap" align="flex-start">
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} truncate>
                  {r.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {r.status} · {r.openTasks} open · {r.closed7d} closed/7d
                </Text>
                {(r.overdueTasks > 0 || r.blockedTasks > 0 || r.pastDue) && (
                  <Group gap={4} mt={4}>
                    {r.overdueTasks > 0 && (
                      <Badge size="xs" color="red" variant="light">
                        {r.overdueTasks} overdue
                      </Badge>
                    )}
                    {r.blockedTasks > 0 && (
                      <Badge size="xs" color="orange" variant="light">
                        {r.blockedTasks} blocked
                      </Badge>
                    )}
                    {r.pastDue && (
                      <Badge size="xs" color="red" variant="filled">
                        past-due
                      </Badge>
                    )}
                  </Group>
                )}
              </div>
              <Badge color={GRADE_COLOR[r.grade] ?? 'gray'} variant="filled" size="lg">
                {r.grade}
              </Badge>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Card>
  )
}

function TeamLoadSection({ rows }: { rows: LoadRow[] }) {
  const maxOpen = Math.max(1, ...rows.map((r) => r.open))
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <ThemeIcon variant="light" color="violet" size="md" radius="md">
          <TbUsersGroup size={16} />
        </ThemeIcon>
        <Title order={5}>Team load</Title>
        <Text size="xs" c="dimmed">
          sorted by open tasks
        </Text>
      </Group>
      <Stack gap={8}>
        {rows.map((r) => (
          <Group key={r.userId ?? 'none'} gap="sm" wrap="nowrap">
            <div style={{ minWidth: 160, flex: '0 0 160px' }}>
              <Text size="sm" fw={500} truncate>
                {r.name}
              </Text>
              <Text size="xs" c="dimmed" truncate>
                {r.role ?? '—'}
              </Text>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Progress
                value={(r.open / maxOpen) * 100}
                color={r.overloaded ? 'red' : r.open > maxOpen * 0.6 ? 'orange' : 'teal'}
                size="md"
              />
            </div>
            <Text size="xs" fw={500} style={{ minWidth: 64, textAlign: 'right' }}>
              {r.open} open
            </Text>
            <Text size="xs" c="dimmed" style={{ minWidth: 70, textAlign: 'right' }}>
              {r.estimateHours}h est
            </Text>
            {r.overdue > 0 && (
              <Badge size="xs" color="red" variant="light">
                {r.overdue} overdue
              </Badge>
            )}
            {r.overloaded && (
              <Badge size="xs" color="red" variant="filled">
                overloaded
              </Badge>
            )}
          </Group>
        ))}
      </Stack>
    </Card>
  )
}

function SectionSkeleton({ height }: { height: number }) {
  return <Skeleton height={height} radius="md" />
}

function useFreshness(timestamp: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(id)
  }, [])
  if (!timestamp) return null
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}
