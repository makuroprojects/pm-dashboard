import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Modal,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { EChartsOption } from 'echarts'
import { useMemo, useState } from 'react'
import {
  TbAlertTriangle,
  TbArrowsSort,
  TbCalendarEvent,
  TbCalendarPlus,
  TbChecks,
  TbClock,
  TbFilterX,
  TbFlag,
  TbFolder,
  TbHistory,
  TbPencil,
  TbPlus,
  TbRefresh,
  TbSearch,
  TbTrash,
  TbUser,
  TbUsers,
  TbX,
} from 'react-icons/tb'
import { useSession } from '../hooks/useAuth'
import { EChart } from './charts/EChart'

export type MemberRole = 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'
export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED'
export type ProjectPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface ProjectUser {
  id: string
  name: string
  email: string
}

interface TaskStats {
  open: number
  inProgress: number
  readyForQc: number
  reopened: number
  closed: number
  total: number
}

export interface ProjectListItem {
  id: string
  name: string
  description: string | null
  ownerId: string
  status: ProjectStatus
  priority: ProjectPriority
  startsAt: string | null
  endsAt: string | null
  originalEndAt: string | null
  archivedAt: string | null
  githubRepo: string | null
  createdAt: string
  updatedAt: string
  owner: ProjectUser
  _count: { members: number; tasks: number; milestones: number }
  myRole: MemberRole | null
  joinedAt: string | null
  taskStats?: TaskStats
  milestoneStats?: { done: number; total: number }
}

interface ProjectMember {
  id: string
  userId: string
  role: MemberRole
  joinedAt: string
  user: ProjectUser & { role: string }
}

export interface ProjectDetail extends ProjectListItem {
  members: ProjectMember[]
}

interface UserOption {
  id: string
  name: string
  email: string
  role: string
}

interface ProjectExtension {
  id: string
  previousEndAt: string | null
  newEndAt: string
  reason: string | null
  createdAt: string
  extendedBy: ProjectUser | null
}

interface ProjectMilestone {
  id: string
  projectId: string
  title: string
  description: string | null
  dueAt: string | null
  completedAt: string | null
  order: number
  createdAt: string
  updatedAt: string
}

const ROLE_COLOR: Record<MemberRole, string> = {
  OWNER: 'red',
  PM: 'violet',
  MEMBER: 'blue',
  VIEWER: 'gray',
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  DRAFT: 'gray',
  ACTIVE: 'blue',
  ON_HOLD: 'yellow',
  COMPLETED: 'green',
  CANCELLED: 'dark',
}

const PRIORITY_COLOR: Record<ProjectPriority, string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const PRIORITY_OPTIONS: Array<{ value: ProjectPriority; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
]

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (24 * 3600 * 1000))
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function computeOverdue(p: ProjectListItem): { overdue: boolean; daysOver: number } {
  if (!p.endsAt) return { overdue: false, daysOver: 0 }
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED') return { overdue: false, daysOver: 0 }
  const end = new Date(p.endsAt)
  const now = new Date()
  if (end.getTime() >= now.getTime()) return { overdue: false, daysOver: 0 }
  return { overdue: true, daysOver: daysBetween(end, now) }
}

function computeTimeProgress(p: ProjectListItem): number | null {
  if (!p.startsAt || !p.endsAt) return null
  const start = new Date(p.startsAt).getTime()
  const end = new Date(p.endsAt).getTime()
  const now = Date.now()
  if (end <= start) return null
  if (now <= start) return 0
  if (now >= end) return 100
  return Math.round(((now - start) / (end - start)) * 100)
}

function computeTaskProgress(p: ProjectListItem): number | null {
  if (!p.taskStats || p.taskStats.total === 0) return null
  return Math.round((p.taskStats.closed / p.taskStats.total) * 100)
}

type HealthLevel = 'on-track' | 'at-risk' | 'delayed'

function computeHealth(p: ProjectListItem): { level: HealthLevel; label: string; color: string } | null {
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED' || p.status === 'DRAFT') return null
  const tp = computeTimeProgress(p)
  const xp = computeTaskProgress(p)
  if (tp === null || xp === null) return null
  const delta = xp - tp
  if (delta >= -10) return { level: 'on-track', label: 'On track', color: 'green' }
  if (delta >= -25) return { level: 'at-risk', label: 'At risk', color: 'yellow' }
  return { level: 'delayed', label: 'Delayed', color: 'red' }
}

type SortKey = 'updated' | 'created' | 'deadline' | 'priority' | 'progress' | 'name'

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'created', label: 'Recently created' },
  { value: 'deadline', label: 'Deadline (soonest)' },
  { value: 'priority', label: 'Priority (high→low)' },
  { value: 'progress', label: 'Progress (high→low)' },
  { value: 'name', label: 'Name (A→Z)' },
]

const ROLE_FILTER_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'PM', label: 'PM' },
  { value: 'MEMBER', label: 'Member' },
  { value: 'VIEWER', label: 'Viewer' },
]

const PRIORITY_RANK: Record<ProjectPriority, number> = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

function sortProjects(list: ProjectListItem[], key: SortKey): ProjectListItem[] {
  const out = [...list]
  switch (key) {
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name))
    case 'deadline':
      return out.sort((a, b) => {
        const ae = a.endsAt ? new Date(a.endsAt).getTime() : Number.POSITIVE_INFINITY
        const be = b.endsAt ? new Date(b.endsAt).getTime() : Number.POSITIVE_INFINITY
        return ae - be
      })
    case 'progress':
      return out.sort((a, b) => (computeTaskProgress(b) ?? -1) - (computeTaskProgress(a) ?? -1))
    case 'priority':
      return out.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority])
    case 'created':
      return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    default:
      return out.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }
}

export function ProjectsPanel() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const session = useSession()
  const role = session.data?.user?.role
  const canCreateProject = role === 'ADMIN' || role === 'SUPER_ADMIN'
  const [createOpen, setCreateOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<ProjectPriority | null>(null)
  const [roleFilter, setRoleFilter] = useState<MemberRole | null>(null)
  const [derivedFilter, setDerivedFilter] = useState<'overdue' | 'atRisk' | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<'cards' | 'timeline'>('cards')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')

  const openProject = (id: string, detailTab: 'overview' | 'settings' = 'overview') => {
    navigate({
      to: '/pm',
      search:
        detailTab === 'overview' ? { tab: 'projects', projectId: id } : { tab: 'projects', projectId: id, detailTab },
    })
  }

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: ProjectListItem[] }>('/api/projects'),
    refetchInterval: 30_000,
  })

  const create = useMutation({
    mutationFn: (body: {
      name: string
      description?: string
      status?: ProjectStatus
      priority?: ProjectPriority
      startsAt?: string | null
      endsAt?: string | null
    }) =>
      api<{ project: ProjectListItem }>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      setCreateOpen(false)
    },
  })

  const projects = projectsQ.data?.projects ?? []
  const statusCounts = useMemo(() => {
    const counts: Record<ProjectStatus, number> = {
      DRAFT: 0,
      ACTIVE: 0,
      ON_HOLD: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    }
    for (const p of projects) counts[p.status]++
    return counts
  }, [projects])

  const overdueCount = useMemo(() => projects.filter((p) => computeOverdue(p).overdue).length, [projects])
  const atRiskCount = useMemo(
    () =>
      projects.filter((p) => {
        const h = computeHealth(p)
        return h?.level === 'at-risk' || h?.level === 'delayed'
      }).length,
    [projects],
  )

  const filtered = useMemo(() => {
    let list = projects
    if (statusFilter) list = list.filter((p) => p.status === statusFilter)
    if (priorityFilter) list = list.filter((p) => p.priority === priorityFilter)
    if (roleFilter) list = list.filter((p) => p.myRole === roleFilter)
    if (derivedFilter === 'overdue') {
      list = list.filter((p) => computeOverdue(p).overdue)
    } else if (derivedFilter === 'atRisk') {
      list = list.filter((p) => {
        const h = computeHealth(p)
        return h?.level === 'at-risk' || h?.level === 'delayed'
      })
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q) ?? false))
    }
    return sortProjects(list, sort)
  }, [projects, statusFilter, priorityFilter, roleFilter, derivedFilter, search, sort])

  const hasActiveFilters = !!(statusFilter || priorityFilter || roleFilter || derivedFilter || search.trim())
  const clearFilters = () => {
    setStatusFilter(null)
    setPriorityFilter(null)
    setRoleFilter(null)
    setDerivedFilter(null)
    setSearch('')
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <div style={{ flex: '1 1 280px' }}>
          <Title order={3}>Projects</Title>
          <Text c="dimmed" size="sm">
            Projects you're a member of. Create one to start tracking tasks + AW activity.
          </Text>
        </div>
        <Group gap="xs" wrap="nowrap">
          <TextInput
            size="sm"
            placeholder="Search name or description…"
            leftSection={<TbSearch size={14} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            rightSection={
              search ? (
                <ActionIcon variant="subtle" size="xs" color="gray" onClick={() => setSearch('')}>
                  <TbX size={12} />
                </ActionIcon>
              ) : null
            }
            w={260}
          />
          <Tooltip label="Refresh">
            <ActionIcon variant="light" size="lg" onClick={() => projectsQ.refetch()} loading={projectsQ.isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          {canCreateProject && (
            <Button leftSection={<TbPlus size={16} />} onClick={() => setCreateOpen(true)}>
              New Project
            </Button>
          )}
        </Group>
      </Group>

      {projects.length > 0 && (
        <Group gap="md" wrap="wrap" align="stretch">
          <Stack gap={4} style={{ minWidth: 110 }}>
            <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
              Quick
            </Text>
            <PortfolioStat
              label="All"
              value={projects.length}
              color="blue"
              active={!hasActiveFilters}
              onClick={clearFilters}
            />
          </Stack>
          <Divider orientation="vertical" />
          <Stack gap={4} style={{ flex: 2, minWidth: 260 }}>
            <Group gap={6} align="baseline">
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                Status
              </Text>
              <Text size="10px" c="dimmed">
                (pick one)
              </Text>
            </Group>
            <SimpleGrid cols={{ base: 3 }} spacing="xs">
              <PortfolioStat
                label="Active"
                value={statusCounts.ACTIVE}
                color="blue"
                active={statusFilter === 'ACTIVE'}
                onClick={() => setStatusFilter(statusFilter === 'ACTIVE' ? null : 'ACTIVE')}
              />
              <PortfolioStat
                label="On hold"
                value={statusCounts.ON_HOLD}
                color="yellow"
                active={statusFilter === 'ON_HOLD'}
                onClick={() => setStatusFilter(statusFilter === 'ON_HOLD' ? null : 'ON_HOLD')}
              />
              <PortfolioStat
                label="Completed"
                value={statusCounts.COMPLETED}
                color="green"
                active={statusFilter === 'COMPLETED'}
                onClick={() => setStatusFilter(statusFilter === 'COMPLETED' ? null : 'COMPLETED')}
              />
            </SimpleGrid>
          </Stack>
          <Divider orientation="vertical" />
          <Stack gap={4} style={{ flex: 1.5, minWidth: 200 }}>
            <Group gap={6} align="baseline">
              <Text size="10px" c="dimmed" tt="uppercase" fw={700}>
                Health
              </Text>
              <Text size="10px" c="dimmed">
                (pick one)
              </Text>
            </Group>
            <SimpleGrid cols={{ base: 2 }} spacing="xs">
              <PortfolioStat
                label="Overdue"
                value={overdueCount}
                color="red"
                icon={<TbAlertTriangle size={14} />}
                active={derivedFilter === 'overdue'}
                muted={overdueCount === 0 && derivedFilter !== 'overdue'}
                onClick={
                  overdueCount > 0 ? () => setDerivedFilter(derivedFilter === 'overdue' ? null : 'overdue') : undefined
                }
              />
              <PortfolioStat
                label="At risk"
                value={atRiskCount}
                color="yellow"
                active={derivedFilter === 'atRisk'}
                muted={atRiskCount === 0 && derivedFilter !== 'atRisk'}
                onClick={
                  atRiskCount > 0 ? () => setDerivedFilter(derivedFilter === 'atRisk' ? null : 'atRisk') : undefined
                }
              />
            </SimpleGrid>
          </Stack>
        </Group>
      )}

      {projects.length > 0 && (
        <Card withBorder padding="sm" radius="md">
          <Stack gap="xs">
            <Group gap="xs" wrap="wrap" justify="flex-end">
              <Select
                size="xs"
                w={150}
                placeholder="Any status"
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as ProjectStatus | null)}
                data={STATUS_OPTIONS.map((s) => ({
                  value: s.value,
                  label: `${s.label} · ${statusCounts[s.value]}`,
                }))}
                clearable
              />
              <Select
                size="xs"
                w={140}
                placeholder="Any priority"
                value={priorityFilter}
                onChange={(v) => setPriorityFilter(v as ProjectPriority | null)}
                data={PRIORITY_OPTIONS}
                clearable
              />
              <Select
                size="xs"
                w={130}
                placeholder="Any role"
                value={roleFilter}
                onChange={(v) => setRoleFilter(v as MemberRole | null)}
                data={ROLE_FILTER_OPTIONS}
                clearable
              />
              <Select
                size="xs"
                w={190}
                value={sort}
                onChange={(v) => v && setSort(v as SortKey)}
                data={SORT_OPTIONS}
                leftSection={<TbArrowsSort size={12} />}
                allowDeselect={false}
              />
              <SegmentedControl
                size="xs"
                value={density}
                onChange={(v) => setDensity(v as 'comfortable' | 'compact')}
                data={[
                  { value: 'comfortable', label: 'Comfy' },
                  { value: 'compact', label: 'Dense' },
                ]}
              />
              <SegmentedControl
                size="xs"
                value={view}
                onChange={(v) => setView(v as 'cards' | 'timeline')}
                data={[
                  { value: 'cards', label: 'Cards' },
                  { value: 'timeline', label: 'Timeline' },
                ]}
              />
            </Group>
            {hasActiveFilters && (
              <Group justify="space-between" gap="xs">
                <Text size="xs" c="dimmed">
                  Showing <b>{filtered.length}</b> of {projects.length}
                </Text>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<TbFilterX size={12} />}
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              </Group>
            )}
          </Stack>
        </Card>
      )}

      {filtered.length === 0 && !projectsQ.isLoading ? (
        <Card withBorder p="xl" radius="md">
          <Stack align="center" gap="sm">
            <TbFolder size={40} />
            <Text fw={500}>
              {projects.length === 0
                ? 'No projects yet'
                : hasActiveFilters
                  ? 'No projects match your filters'
                  : 'Nothing to show'}
            </Text>
            <Text size="sm" c="dimmed" ta="center" maw={360}>
              {projects.length === 0
                ? canCreateProject
                  ? 'Create your first project to start organizing tasks and tracking ActivityWatch focus.'
                  : 'You have not been added to any project yet. Ask an admin to invite you.'
                : hasActiveFilters
                  ? 'Try clearing filters or searching by a different keyword.'
                  : 'Pick a different view or create a new project.'}
            </Text>
            {projects.length === 0 && canCreateProject ? (
              <Button leftSection={<TbPlus size={16} />} onClick={() => setCreateOpen(true)}>
                Create Project
              </Button>
            ) : hasActiveFilters ? (
              <Button variant="light" leftSection={<TbFilterX size={16} />} onClick={clearFilters}>
                Clear filters
              </Button>
            ) : null}
          </Stack>
        </Card>
      ) : view === 'timeline' ? (
        <ProjectsGanttView projects={filtered} onSelect={(p) => openProject(p.id)} />
      ) : (
        <SimpleGrid
          cols={density === 'compact' ? { base: 1, sm: 2, md: 3, lg: 4 } : { base: 1, sm: 2, md: 3 }}
          spacing="md"
        >
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              density={density}
              isSystemAdmin={canCreateProject}
              onOpen={() => openProject(p.id)}
              onEdit={() => openProject(p.id, 'settings')}
            />
          ))}
        </SimpleGrid>
      )}

      <CreateProjectModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(body) => create.mutate(body)}
        loading={create.isPending}
        error={create.error?.message}
      />
    </Stack>
  )
}

function PortfolioStat({
  label,
  value,
  color,
  icon,
  active,
  muted,
  onClick,
}: {
  label: string
  value: number
  color: string
  icon?: React.ReactNode
  active?: boolean
  muted?: boolean
  onClick?: () => void
}) {
  const clickable = !!onClick
  return (
    <Card
      withBorder
      padding="xs"
      radius="md"
      onClick={onClick}
      style={{
        cursor: clickable ? 'pointer' : 'default',
        borderColor: active ? `var(--mantine-color-${color}-6)` : undefined,
        backgroundColor: active ? `var(--mantine-color-${color}-0)` : undefined,
        opacity: muted ? 0.55 : 1,
        transition: 'all 120ms ease',
      }}
    >
      <Group gap={6} wrap="nowrap" justify="space-between">
        <Text size="xs" c="dimmed" fw={500} tt="uppercase" style={{ minWidth: 0 }} truncate>
          {icon ? <span style={{ marginRight: 4, verticalAlign: 'middle' }}>{icon}</span> : null}
          {label}
        </Text>
        <Text fw={700} size="lg" c={value > 0 ? color : 'dimmed'}>
          {value}
        </Text>
      </Group>
    </Card>
  )
}

function ProjectCard({
  project: p,
  density,
  isSystemAdmin: isAdmin,
  onOpen,
  onEdit,
}: {
  project: ProjectListItem
  density: 'comfortable' | 'compact'
  isSystemAdmin: boolean
  onOpen?: () => void
  onEdit: () => void
}) {
  const { overdue, daysOver } = computeOverdue(p)
  const timeProgress = computeTimeProgress(p)
  const health = computeHealth(p)
  const extended = p.originalEndAt && p.endsAt && new Date(p.endsAt).getTime() !== new Date(p.originalEndAt).getTime()
  const canEdit = isAdmin || p.myRole === 'OWNER' || p.myRole === 'PM'
  const compact = density === 'compact'
  const [hover, setHover] = useState(false)

  return (
    <Card
      withBorder
      padding={compact ? 'sm' : 'lg'}
      radius="md"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        cursor: onOpen ? 'pointer' : 'default',
        borderColor: overdue
          ? 'var(--mantine-color-red-6)'
          : hover && onOpen
            ? 'var(--mantine-color-blue-5)'
            : undefined,
        transform: hover && onOpen ? 'translateY(-1px)' : undefined,
        boxShadow: hover && onOpen ? '0 4px 12px rgba(0,0,0,0.08)' : undefined,
        transition: 'all 120ms ease',
      }}
      onClick={onOpen}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Text fw={600} size={compact ? 'sm' : 'md'} lineClamp={1} style={{ flex: 1 }}>
            {p.name}
          </Text>
          {canEdit && (
            <Tooltip label="Edit project">
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
              >
                <TbPencil size={14} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        <Group gap={4} wrap="wrap">
          <Badge color={STATUS_COLOR[p.status]} variant="light" size="xs">
            {p.status.replace('_', ' ')}
          </Badge>
          <Badge color={PRIORITY_COLOR[p.priority]} variant="dot" size="xs">
            {p.priority}
          </Badge>
          {p.myRole ? (
            <Badge color={ROLE_COLOR[p.myRole]} variant="light" size="xs">
              {p.myRole}
            </Badge>
          ) : isAdmin ? (
            <Badge color="gray" variant="outline" size="xs">
              ADMIN VIEW
            </Badge>
          ) : null}
          {overdue && (
            <Badge color="red" variant="filled" size="xs" leftSection={<TbAlertTriangle size={10} />}>
              Overdue {daysOver}d
            </Badge>
          )}
          {health && (
            <Tooltip label="Derived from task-completion pace vs. time elapsed">
              <Badge color={health.color} variant="dot" size="xs">
                {health.label}
              </Badge>
            </Tooltip>
          )}
          {extended && (
            <Tooltip label={`Original deadline: ${formatDate(p.originalEndAt)}`}>
              <Badge color="grape" variant="light" size="xs">
                Extended
              </Badge>
            </Tooltip>
          )}
        </Group>

        {!compact && (
          <Text size="xs" c="dimmed" lineClamp={2} mih={32}>
            {p.description || 'No description'}
          </Text>
        )}

        {(p.startsAt || p.endsAt) && (
          <Group gap={4}>
            <TbCalendarEvent size={12} />
            <Text size="xs" c="dimmed">
              {formatDate(p.startsAt)} → {formatDate(p.endsAt)}
            </Text>
          </Group>
        )}

        {timeProgress !== null && (
          <div>
            <Group justify="space-between" gap={4}>
              <Text size="xs" c="dimmed">
                Timeline
              </Text>
              <Text size="xs" c={overdue ? 'red' : 'dimmed'}>
                {timeProgress}%
              </Text>
            </Group>
            <Progress
              value={timeProgress}
              size="xs"
              mt={2}
              color={overdue ? 'red' : timeProgress > 80 ? 'orange' : 'blue'}
            />
          </div>
        )}

        {p.taskStats && p.taskStats.total > 0 && (
          <div>
            <Group justify="space-between" gap={4}>
              <Group gap={4}>
                <TbChecks size={12} />
                <Text size="xs" c="dimmed">
                  Tasks
                </Text>
              </Group>
              <Tooltip
                label={`${p.taskStats.closed} closed · ${p.taskStats.inProgress} in progress · ${p.taskStats.readyForQc} QC · ${p.taskStats.open + p.taskStats.reopened} open`}
              >
                <Text size="xs" c="dimmed">
                  {p.taskStats.closed}/{p.taskStats.total} ·{' '}
                  {Math.round((p.taskStats.closed / p.taskStats.total) * 100)}%
                </Text>
              </Tooltip>
            </Group>
            <Progress.Root size="xs" mt={2}>
              <Progress.Section value={(p.taskStats.closed / p.taskStats.total) * 100} color="green" />
              <Progress.Section value={(p.taskStats.readyForQc / p.taskStats.total) * 100} color="teal" />
              <Progress.Section value={(p.taskStats.inProgress / p.taskStats.total) * 100} color="blue" />
              <Progress.Section
                value={((p.taskStats.open + p.taskStats.reopened) / p.taskStats.total) * 100}
                color="gray"
              />
            </Progress.Root>
          </div>
        )}

        {p.milestoneStats && p.milestoneStats.total > 0 && (
          <div>
            <Group justify="space-between" gap={4}>
              <Group gap={4}>
                <TbFlag size={12} />
                <Text size="xs" c="dimmed">
                  Milestones
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {p.milestoneStats.done}/{p.milestoneStats.total}
              </Text>
            </Group>
            <Progress value={(p.milestoneStats.done / p.milestoneStats.total) * 100} size="xs" mt={2} color="grape" />
          </div>
        )}

        <Group gap="md" mt={compact ? 0 : 'xs'} justify="space-between" wrap="nowrap">
          <Group gap={10} wrap="nowrap">
            <Tooltip label={`${p._count.members} members`}>
              <Group gap={3} wrap="nowrap">
                <TbUsers size={12} />
                <Text size="xs" c="dimmed">
                  {p._count.members}
                </Text>
              </Group>
            </Tooltip>
            <Tooltip label={`${p._count.tasks} tasks`}>
              <Group gap={3} wrap="nowrap">
                <TbFolder size={12} />
                <Text size="xs" c="dimmed">
                  {p._count.tasks}
                </Text>
              </Group>
            </Tooltip>
          </Group>
          <Tooltip label={`Owner: ${p.owner.name}`}>
            <Group gap={3} wrap="nowrap" style={{ minWidth: 0 }}>
              <TbUser size={12} />
              <Text size="xs" c="dimmed" truncate>
                {p.owner.name}
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </Stack>
    </Card>
  )
}

function CreateProjectModal({
  opened,
  onClose,
  onSubmit,
  loading,
  error,
}: {
  opened: boolean
  onClose: () => void
  onSubmit: (body: {
    name: string
    description?: string
    status?: ProjectStatus
    priority?: ProjectPriority
    startsAt?: string | null
    endsAt?: string | null
  }) => void
  loading: boolean
  error?: string
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<ProjectStatus>('ACTIVE')
  const [priority, setPriority] = useState<ProjectPriority>('MEDIUM')
  const [startsAt, setStartsAt] = useState<Date | null>(null)
  const [endsAt, setEndsAt] = useState<Date | null>(null)

  const reset = () => {
    setName('')
    setDescription('')
    setStatus('ACTIVE')
    setPriority('MEDIUM')
    setStartsAt(null)
    setEndsAt(null)
  }

  const invalidRange = startsAt && endsAt && endsAt < startsAt

  return (
    <Modal
      opened={opened}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Create Project"
      size="md"
    >
      <Stack gap="sm">
        <TextInput
          label="Name"
          placeholder="e.g. Acme Website Redesign"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          required
        />
        <Textarea
          label="Description"
          placeholder="What's this project about?"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={5}
        />
        <Group grow>
          <Select
            label="Status"
            data={STATUS_OPTIONS}
            value={status}
            onChange={(v) => v && setStatus(v as ProjectStatus)}
          />
          <Select
            label="Priority"
            data={PRIORITY_OPTIONS}
            value={priority}
            onChange={(v) => v && setPriority(v as ProjectPriority)}
          />
        </Group>
        <Group grow>
          <DateInput
            label="Start date"
            placeholder="Optional"
            value={startsAt}
            onChange={(v) => setStartsAt(v ? new Date(v as unknown as string) : null)}
            clearable
            leftSection={<TbClock size={14} />}
          />
          <DateInput
            label="End date"
            placeholder="Optional"
            value={endsAt}
            onChange={(v) => setEndsAt(v ? new Date(v as unknown as string) : null)}
            clearable
            leftSection={<TbCalendarEvent size={14} />}
            error={invalidRange ? 'End must be after start' : undefined}
          />
        </Group>
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}
        <Group justify="flex-end">
          <Button
            variant="subtle"
            onClick={() => {
              reset()
              onClose()
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit({
                name: name.trim(),
                description: description.trim() || undefined,
                status,
                priority,
                startsAt: startsAt ? startsAt.toISOString() : null,
                endsAt: endsAt ? endsAt.toISOString() : null,
              })
            }
            disabled={!name.trim() || Boolean(invalidRange) || loading}
            loading={loading}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

const MEMBER_ROLE_OPTIONS: Array<{ value: MemberRole; label: string }> = [
  { value: 'OWNER', label: 'Owner' },
  { value: 'PM', label: 'PM' },
  { value: 'MEMBER', label: 'Member' },
  { value: 'VIEWER', label: 'Viewer' },
]

export function MembersSection({
  projectId,
  myRole,
  systemRole,
  ownerId,
}: {
  projectId: string
  myRole: MemberRole | null
  systemRole?: string | null
  ownerId: string
}) {
  const qc = useQueryClient()
  const [addUserId, setAddUserId] = useState<string | null>(null)
  const [addRole, setAddRole] = useState<MemberRole>('MEMBER')

  const detailQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<{ project: ProjectDetail; myRole: MemberRole | null }>(`/api/projects/${projectId}`),
  })
  const usersQ = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: UserOption[] }>('/api/users'),
  })

  const addMember = useMutation({
    mutationFn: (body: { userId: string; role: MemberRole }) =>
      api(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setAddUserId(null)
      setAddRole('MEMBER')
    },
  })

  const changeRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: MemberRole }) =>
      api(`/api/projects/${projectId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => api(`/api/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const isSysAdmin = systemRole === 'ADMIN' || systemRole === 'SUPER_ADMIN'
  const canManage = isSysAdmin || myRole === 'OWNER' || myRole === 'PM'
  const canRemove = canManage
  const canGrantOwner = systemRole === 'SUPER_ADMIN' || myRole === 'OWNER'

  const members = detailQ.data?.project.members ?? []
  const memberUserIds = new Set(members.map((m) => m.userId))
  const userOptions = useMemo(
    () =>
      (usersQ.data?.users ?? [])
        .filter((u) => !memberUserIds.has(u.id))
        .map((u) => ({ value: u.id, label: `${u.name} · ${u.email}` })),
    [usersQ.data, memberUserIds],
  )
  const roleOptions = canGrantOwner ? MEMBER_ROLE_OPTIONS : MEMBER_ROLE_OPTIONS.filter((r) => r.value !== 'OWNER')

  return (
    <Stack gap="xs">
      {detailQ.isLoading ? (
        <Text size="xs" c="dimmed">
          Loading members…
        </Text>
      ) : (
        <Stack gap={6}>
          {members.map((m) => {
            const isOwner = m.userId === ownerId
            return (
              <Group key={m.id} justify="space-between" wrap="nowrap">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                  <TbUser size={14} />
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {m.user.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {m.user.email}
                    </Text>
                  </Stack>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  {canManage && !isOwner ? (
                    <Select
                      size="xs"
                      data={roleOptions}
                      value={m.role}
                      onChange={(v) => v && changeRole.mutate({ userId: m.userId, role: v as MemberRole })}
                      w={110}
                      allowDeselect={false}
                    />
                  ) : (
                    <Badge color={ROLE_COLOR[m.role]} variant="light" size="sm">
                      {m.role}
                    </Badge>
                  )}
                  {canRemove && !isOwner && (
                    <Tooltip label="Remove member">
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        size="sm"
                        onClick={() => {
                          if (confirm(`Remove ${m.user.name} from this project?`)) {
                            removeMember.mutate(m.userId)
                          }
                        }}
                      >
                        <TbTrash size={14} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Group>
              </Group>
            )
          })}
        </Stack>
      )}

      {canManage && (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <Select
            label="Add member"
            placeholder={userOptions.length === 0 ? 'All users added' : 'Select user'}
            data={userOptions}
            value={addUserId}
            onChange={setAddUserId}
            searchable
            disabled={userOptions.length === 0}
            style={{ flex: 1 }}
          />
          <Select
            label="Role"
            data={roleOptions}
            value={addRole}
            onChange={(v) => v && setAddRole(v as MemberRole)}
            w={110}
            allowDeselect={false}
          />
          <Button
            leftSection={<TbPlus size={14} />}
            disabled={!addUserId || addMember.isPending}
            loading={addMember.isPending}
            onClick={() => addUserId && addMember.mutate({ userId: addUserId, role: addRole })}
          >
            Add
          </Button>
        </Group>
      )}

      {(addMember.error || changeRole.error || removeMember.error) && (
        <Text size="xs" c="red">
          {(addMember.error as Error | null)?.message ??
            (changeRole.error as Error | null)?.message ??
            (removeMember.error as Error | null)?.message}
        </Text>
      )}
    </Stack>
  )
}

export function ExtensionsSection({
  projectId,
  currentEndAt,
  startsAt,
  canExtend,
}: {
  projectId: string
  currentEndAt: string | null
  startsAt: string | null
  canExtend: boolean
}) {
  const qc = useQueryClient()
  const [extendOpen, setExtendOpen] = useState(false)

  const historyQ = useQuery({
    queryKey: ['project-extensions', projectId],
    queryFn: () => api<{ extensions: ProjectExtension[] }>(`/api/projects/${projectId}/extensions`),
  })

  const extend = useMutation({
    mutationFn: (body: { newEndAt: string; reason: string | null }) =>
      api(`/api/projects/${projectId}/extend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-extensions', projectId] })
      qc.invalidateQueries({ queryKey: ['project', projectId] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setExtendOpen(false)
    },
  })

  const extensions = historyQ.data?.extensions ?? []

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Group gap="xs">
          <TbHistory size={14} />
          <Text size="sm" c="dimmed">
            {extensions.length === 0 ? 'No extensions recorded' : `${extensions.length} extension(s)`}
          </Text>
        </Group>
        {canExtend && (
          <Button
            size="xs"
            variant="light"
            leftSection={<TbCalendarPlus size={14} />}
            onClick={() => setExtendOpen(true)}
          >
            Extend deadline
          </Button>
        )}
      </Group>

      {extensions.length > 0 && (
        <Stack gap={6}>
          {extensions.map((e) => (
            <Card key={e.id} withBorder padding="xs" radius="sm">
              <Stack gap={2}>
                <Group gap="xs" wrap="wrap">
                  <Text size="xs" fw={500}>
                    {formatDate(e.previousEndAt)} → {formatDate(e.newEndAt)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    by {e.extendedBy?.name ?? 'system'} · {new Date(e.createdAt).toLocaleString()}
                  </Text>
                </Group>
                {e.reason && (
                  <Text size="xs" c="dimmed">
                    {e.reason}
                  </Text>
                )}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <ExtendDeadlineModal
        opened={extendOpen}
        onClose={() => setExtendOpen(false)}
        currentEndAt={currentEndAt}
        startsAt={startsAt}
        onSubmit={(body) => extend.mutate(body)}
        loading={extend.isPending}
        error={extend.error?.message}
      />
    </Stack>
  )
}

const STATUS_BAR_COLOR: Record<ProjectStatus, string> = {
  DRAFT: '#868e96',
  ACTIVE: '#228be6',
  ON_HOLD: '#fab005',
  COMPLETED: '#40c057',
  CANCELLED: '#495057',
}

function ProjectsGanttView({
  projects,
  onSelect,
}: {
  projects: ProjectListItem[]
  onSelect: (p: ProjectListItem) => void
}) {
  const withDates = useMemo(() => projects.filter((p) => p.startsAt && p.endsAt), [projects])

  const milestonesQ = useQuery({
    queryKey: ['milestones', 'all'],
    queryFn: () => api<{ milestones: ProjectMilestone[] }>('/api/milestones'),
  })

  const option = useMemo<EChartsOption>(() => {
    const now = Date.now()
    const categories = withDates.map((p) => p.name)
    const idxById = new Map<string, number>(withDates.map((p, i) => [p.id, i]))
    const milestonePoints = (milestonesQ.data?.milestones ?? [])
      .filter((m) => m.dueAt && idxById.has(m.projectId))
      .map((m) => ({
        name: m.title,
        value: [new Date(m.dueAt as string).getTime(), idxById.get(m.projectId) as number],
        milestone: m,
        itemStyle: { color: m.completedAt ? '#40c057' : '#7950f2' },
      }))
    const data = withDates.map((p, idx) => {
      const start = new Date(p.startsAt as string).getTime()
      const end = new Date(p.endsAt as string).getTime()
      const overdue = end < now && p.status !== 'COMPLETED' && p.status !== 'CANCELLED'
      const taskPct = computeTaskProgress(p)
      const timePct = computeTimeProgress(p)
      const color = overdue ? '#fa5252' : STATUS_BAR_COLOR[p.status]
      return {
        name: p.name,
        value: [idx, start, end],
        projectId: p.id,
        status: p.status,
        priority: p.priority,
        overdue,
        taskPct,
        timePct,
        itemStyle: { color },
      }
    })

    type BarData = (typeof data)[number]

    return {
      grid: { left: 160, right: 24, top: 12, bottom: 48, containLabel: false },
      xAxis: {
        type: 'time',
        position: 'bottom',
        splitLine: { show: true },
      },
      yAxis: {
        type: 'category',
        data: categories,
        inverse: true,
        axisLabel: { width: 140, overflow: 'truncate', fontSize: 11 },
      },
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { data: BarData }
          const d = p.data
          const start = new Date(d.value[1]).toLocaleDateString()
          const end = new Date(d.value[2]).toLocaleDateString()
          const parts = [
            `<b>${d.name}</b>`,
            `${start} → ${end}`,
            `Status: ${d.status.replace('_', ' ')} · Priority: ${d.priority}`,
          ]
          if (d.taskPct !== null) parts.push(`Tasks: ${d.taskPct}%`)
          if (d.timePct !== null) parts.push(`Time: ${d.timePct}%`)
          if (d.overdue) parts.push('<span style="color:#fa5252">Overdue</span>')
          return parts.join('<br/>')
        },
      },
      series: [
        {
          type: 'scatter',
          name: 'Milestones',
          data: milestonePoints,
          symbol: 'diamond',
          symbolSize: 12,
          z: 10,
          tooltip: {
            formatter: (params: unknown) => {
              const p = params as { data: { milestone: ProjectMilestone } }
              const m = p.data.milestone
              const done = !!m.completedAt
              return [
                `<b>${m.title}</b>`,
                `Due: ${m.dueAt ? new Date(m.dueAt).toLocaleDateString() : '—'}`,
                done ? '<span style="color:#40c057">Completed</span>' : 'Pending',
              ].join('<br/>')
            },
          },
        },
        {
          type: 'custom',
          encode: { x: [1, 2], y: 0 },
          data,
          renderItem: (_params: unknown, apiRef: unknown) => {
            const api = apiRef as {
              value: (i: number) => number
              coord: (pt: [number, number]) => [number, number]
              size: (v: [number, number]) => [number, number]
              style: (opts?: Record<string, unknown>) => Record<string, unknown>
              visual: (key: string) => string
            }
            const yIdx = api.value(0)
            const start = api.coord([api.value(1), yIdx])
            const end = api.coord([api.value(2), yIdx])
            const height = api.size([0, 1])[1] * 0.5
            const width = Math.max(2, end[0] - start[0])
            const color = api.visual('color') || '#228be6'
            return {
              type: 'rect',
              shape: { x: start[0], y: start[1] - height / 2, width, height },
              style: { fill: color, opacity: 0.9 },
            }
          },
          markLine: {
            symbol: 'none',
            silent: true,
            label: { formatter: 'Today', position: 'insideEndTop', color: '#fa5252' },
            lineStyle: { color: '#fa5252', type: 'dashed', width: 1 },
            data: [{ xAxis: now }],
          },
        },
      ],
      dataZoom: [
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 8, filterMode: 'weakFilter' },
        { type: 'inside', xAxisIndex: 0, filterMode: 'weakFilter' },
      ],
    } as unknown as EChartsOption
  }, [withDates, milestonesQ.data])

  if (withDates.length === 0) {
    return (
      <Card withBorder p="xl" radius="md">
        <Stack align="center" gap="xs">
          <TbCalendarEvent size={32} />
          <Text fw={500}>No projects with start + end dates</Text>
          <Text size="sm" c="dimmed">
            Add dates in a project's settings to see it on the timeline.
          </Text>
        </Stack>
      </Card>
    )
  }

  const height = Math.max(240, withDates.length * 36 + 80)

  return (
    <Card withBorder padding="sm" radius="md">
      <EChart
        option={option}
        height={height}
        onEvents={{
          click: (params: unknown) => {
            const p = params as { data?: { projectId?: string } }
            const id = p?.data?.projectId
            if (!id) return
            const proj = projects.find((x) => x.id === id)
            if (proj) onSelect(proj)
          },
        }}
      />
    </Card>
  )
}

export function MilestonesSection({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [dueAt, setDueAt] = useState<Date | null>(null)

  const milestonesQ = useQuery({
    queryKey: ['milestones', projectId],
    queryFn: () => api<{ milestones: ProjectMilestone[] }>(`/api/projects/${projectId}/milestones`),
  })

  const create = useMutation({
    mutationFn: (body: { title: string; dueAt: string | null }) =>
      api(`/api/projects/${projectId}/milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
      qc.invalidateQueries({ queryKey: ['milestones', 'all'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setTitle('')
      setDueAt(null)
    },
  })

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api(`/api/milestones/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
      qc.invalidateQueries({ queryKey: ['milestones', 'all'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/milestones/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['milestones', projectId] })
      qc.invalidateQueries({ queryKey: ['milestones', 'all'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const milestones = milestonesQ.data?.milestones ?? []
  const now = Date.now()

  return (
    <Stack gap="xs">
      {milestonesQ.isLoading ? (
        <Text size="xs" c="dimmed">
          Loading…
        </Text>
      ) : milestones.length === 0 ? (
        <Text size="xs" c="dimmed">
          No milestones yet.
        </Text>
      ) : (
        <Stack gap={6}>
          {milestones.map((m) => {
            const done = !!m.completedAt
            const overdue = !done && m.dueAt && new Date(m.dueAt).getTime() < now
            return (
              <Group key={m.id} justify="space-between" wrap="nowrap" gap="xs">
                <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
                  <Checkbox
                    checked={done}
                    disabled={!canManage || update.isPending}
                    onChange={(e) => update.mutate({ id: m.id, body: { completed: e.currentTarget.checked } })}
                  />
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text
                      size="sm"
                      fw={500}
                      truncate
                      td={done ? 'line-through' : undefined}
                      c={done ? 'dimmed' : undefined}
                    >
                      {m.title}
                    </Text>
                    <Group gap={4}>
                      {m.dueAt && (
                        <Text size="xs" c={overdue ? 'red' : 'dimmed'}>
                          Due {formatDate(m.dueAt)}
                        </Text>
                      )}
                      {overdue && (
                        <Badge size="xs" color="red" variant="light">
                          Overdue
                        </Badge>
                      )}
                      {done && (
                        <Text size="xs" c="dimmed">
                          · Done {formatDate(m.completedAt)}
                        </Text>
                      )}
                    </Group>
                  </Stack>
                </Group>
                {canManage && (
                  <Tooltip label="Delete">
                    <ActionIcon
                      variant="subtle"
                      color="red"
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete milestone "${m.title}"?`)) remove.mutate(m.id)
                      }}
                    >
                      <TbTrash size={14} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            )
          })}
        </Stack>
      )}

      {canManage && (
        <Group gap="xs" align="flex-end" wrap="nowrap">
          <TextInput
            label="Add milestone"
            placeholder="e.g. MVP launch"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <DateInput
            label="Due"
            value={dueAt}
            onChange={(v) => setDueAt(v ? new Date(v as unknown as string) : null)}
            clearable
            w={160}
          />
          <Button
            leftSection={<TbPlus size={14} />}
            disabled={!title.trim() || create.isPending}
            loading={create.isPending}
            onClick={() => create.mutate({ title: title.trim(), dueAt: dueAt ? dueAt.toISOString() : null })}
          >
            Add
          </Button>
        </Group>
      )}

      {(create.error || update.error || remove.error) && (
        <Text size="xs" c="red">
          {(create.error as Error | null)?.message ??
            (update.error as Error | null)?.message ??
            (remove.error as Error | null)?.message}
        </Text>
      )}
    </Stack>
  )
}

function ExtendDeadlineModal({
  opened,
  onClose,
  currentEndAt,
  startsAt,
  onSubmit,
  loading,
  error,
}: {
  opened: boolean
  onClose: () => void
  currentEndAt: string | null
  startsAt: string | null
  onSubmit: (body: { newEndAt: string; reason: string | null }) => void
  loading: boolean
  error?: string
}) {
  const [newEnd, setNewEnd] = useState<Date | null>(currentEndAt ? new Date(currentEndAt) : null)
  const [reason, setReason] = useState('')
  const [initKey, setInitKey] = useState<string | null>(null)

  const key = currentEndAt ?? '__null__'
  if (opened && key !== initKey) {
    setInitKey(key)
    setNewEnd(currentEndAt ? new Date(currentEndAt) : null)
    setReason('')
  }
  if (!opened && initKey !== null) setInitKey(null)

  const startDate = startsAt ? new Date(startsAt) : null
  const sameAsCurrent = newEnd && currentEndAt && newEnd.getTime() === new Date(currentEndAt).getTime()
  const beforeStart = newEnd && startDate && newEnd < startDate
  const invalid = !newEnd || sameAsCurrent || beforeStart

  return (
    <Modal opened={opened} onClose={onClose} title="Extend deadline" size="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Current deadline: <b>{formatDate(currentEndAt)}</b>
        </Text>
        <DateInput
          label="New deadline"
          value={newEnd}
          onChange={(v) => setNewEnd(v ? new Date(v as unknown as string) : null)}
          clearable
          leftSection={<TbCalendarEvent size={14} />}
          error={beforeStart ? 'Must be after project start' : sameAsCurrent ? 'Same as current deadline' : undefined}
        />
        <Textarea
          label="Reason (optional)"
          placeholder="e.g. Scope expanded to include payment gateway integration"
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={5}
        />
        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(invalid) || loading}
            loading={loading}
            onClick={() => newEnd && onSubmit({ newEndAt: newEnd.toISOString(), reason: reason.trim() || null })}
          >
            Save extension
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
