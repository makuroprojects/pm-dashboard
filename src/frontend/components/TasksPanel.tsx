import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Progress,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
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
  TbArrowLeft,
  TbChartBar,
  TbChevronRight,
  TbClock,
  TbFilter,
  TbListCheck,
  TbPlus,
  TbRefresh,
  TbTag,
  TbX,
} from 'react-icons/tb'
import { EChart } from './charts/EChart'

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
type TaskKind = 'TASK' | 'BUG' | 'QC'

interface TaskUser {
  id: string
  name: string
  email: string
  role: string
}

interface TaskTag {
  tagId: string
  tag: { id: string; name: string; color: string; projectId: string }
}

interface TaskListItem {
  id: string
  projectId: string
  kind: TaskKind
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  route: string | null
  reporter: TaskUser
  assignee: TaskUser | null
  startsAt: string | null
  dueAt: string | null
  estimateHours: number | null
  actualHours: number | null
  progressPercent: number | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  project: { id: string; name: string }
  tags: TaskTag[]
  _count: { comments: number; evidence: number; blockedBy: number; blocks: number }
}

interface TagListItem {
  id: string
  projectId: string
  name: string
  color: string
}

interface ProjectOption {
  id: string
  name: string
  myRole: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER'
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  OPEN: 'blue',
  IN_PROGRESS: 'violet',
  READY_FOR_QC: 'yellow',
  REOPENED: 'orange',
  CLOSED: 'green',
}

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

const KIND_COLOR: Record<TaskKind, string> = {
  TASK: 'blue',
  BUG: 'red',
  QC: 'teal',
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function TasksPanel({
  projectId,
  onProjectChange,
  onBackToProjects,
}: {
  projectId?: string
  onProjectChange?: (id: string | null) => void
  onBackToProjects?: () => void
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const openTask = (id: string) => {
    navigate({
      to: '/pm',
      search: projectId ? { tab: 'tasks', projectId, taskId: id } : { tab: 'tasks', taskId: id },
    })
  }
  const [createOpen, setCreateOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [mine, setMine] = useState(false)
  const [showCharts, setShowCharts] = useState(true)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'gantt' | 'kanban'>('table')

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () => api<{ projects: ProjectOption[] }>('/api/projects'),
  })

  const activeProjectId = projectId ?? null

  const changeProject = (id: string | null) => {
    setTagFilter(null)
    onProjectChange?.(id)
  }

  const tagsQ = useQuery({
    queryKey: ['tags', activeProjectId],
    queryFn: () => api<{ tags: TagListItem[] }>(`/api/projects/${activeProjectId}/tags`),
    enabled: !!activeProjectId,
  })

  const params = new URLSearchParams()
  if (activeProjectId) params.set('projectId', activeProjectId)
  if (status) params.set('status', status)
  if (kind) params.set('kind', kind)
  if (mine) params.set('mine', '1')
  if (tagFilter) params.set('tagId', tagFilter)
  const query = params.toString()

  const tasksQ = useQuery({
    queryKey: ['tasks', query],
    queryFn: () => api<{ tasks: TaskListItem[] }>(`/api/tasks${query ? `?${query}` : ''}`),
    refetchInterval: 30_000,
  })

  const create = useMutation({
    mutationFn: (body: {
      projectId: string
      title: string
      description: string
      kind: TaskKind
      priority: TaskPriority
      startsAt: string | null
      dueAt: string | null
      estimateHours: number | null
      tagIds: string[]
    }) =>
      api<{ task: TaskListItem }>('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setCreateOpen(false)
    },
  })

  const projects = projectsQ.data?.projects ?? []
  const writableProjects = projects.filter((p) => p.myRole !== 'VIEWER')
  const tasks = tasksQ.data?.tasks ?? []
  const activeProject = activeProjectId ? (projects.find((p) => p.id === activeProjectId) ?? null) : null

  return (
    <Stack gap="md">
      {activeProject ? (
        <Group gap={6} wrap="nowrap">
          {onBackToProjects ? (
            <Tooltip label="Back to projects">
              <ActionIcon variant="subtle" size="sm" onClick={onBackToProjects}>
                <TbArrowLeft size={14} />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Text
            size="xs"
            c="dimmed"
            style={{ cursor: onBackToProjects ? 'pointer' : undefined }}
            onClick={onBackToProjects}
          >
            Projects
          </Text>
          <TbChevronRight size={12} style={{ opacity: 0.5 }} />
          <Text size="xs" c="dimmed">
            {activeProject.name}
          </Text>
          <TbChevronRight size={12} style={{ opacity: 0.5 }} />
          <Text size="xs" fw={500}>
            Tasks
          </Text>
        </Group>
      ) : null}
      <Group justify="space-between">
        <div>
          <Title order={3}>{activeProject ? `${activeProject.name} · Tasks` : 'Tasks'}</Title>
          <Text c="dimmed" size="sm">
            {activeProject
              ? `All tasks, bugs, and QC items in ${activeProject.name}.`
              : 'Unified task + bug + QC view across your projects.'}
          </Text>
        </div>
        <Group gap="xs">
          <Tooltip label={showCharts ? 'Hide dashboard' : 'Show dashboard'}>
            <ActionIcon variant="light" onClick={() => setShowCharts((v) => !v)}>
              <TbChartBar size={16} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Refresh">
            <ActionIcon variant="light" onClick={() => tasksQ.refetch()} loading={tasksQ.isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <Button
            leftSection={<TbPlus size={16} />}
            onClick={() => setCreateOpen(true)}
            disabled={writableProjects.length === 0}
          >
            New Task
          </Button>
        </Group>
      </Group>

      {showCharts && tasks.length > 0 ? <TaskDashboardOverlay tasks={tasks} /> : null}

      <Card withBorder padding="sm" radius="md">
        <Group gap="sm" wrap="wrap">
          <TbFilter size={14} />
          {activeProject ? (
            <Badge
              color="blue"
              variant="light"
              size="lg"
              leftSection={<TbTag size={12} />}
              rightSection={
                <ActionIcon
                  size="xs"
                  variant="transparent"
                  color="blue"
                  onClick={() => changeProject(null)}
                  aria-label="Clear project filter"
                >
                  <TbX size={12} />
                </ActionIcon>
              }
            >
              {activeProject.name}
            </Badge>
          ) : (
            <Select
              placeholder="All projects"
              data={projects.map((p) => ({ value: p.id, label: p.name }))}
              value={activeProjectId}
              onChange={changeProject}
              clearable
              size="xs"
              w={220}
            />
          )}
          <Select
            placeholder="All kinds"
            data={['TASK', 'BUG', 'QC']}
            value={kind}
            onChange={setKind}
            clearable
            size="xs"
            w={140}
          />
          <Select
            placeholder="All statuses"
            data={['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED']}
            value={status}
            onChange={setStatus}
            clearable
            size="xs"
            w={160}
          />
          {activeProjectId && tagsQ.data?.tags.length ? (
            <Select
              placeholder="All tags"
              leftSection={<TbTag size={12} />}
              data={tagsQ.data.tags.map((t) => ({ value: t.id, label: t.name }))}
              value={tagFilter}
              onChange={setTagFilter}
              clearable
              size="xs"
              w={160}
            />
          ) : null}
          <Switch label="Assigned to me" checked={mine} onChange={(e) => setMine(e.currentTarget.checked)} size="sm" />
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => setView(v as 'table' | 'gantt' | 'kanban')}
            data={[
              { value: 'table', label: 'Table' },
              { value: 'kanban', label: 'Kanban' },
              { value: 'gantt', label: 'Gantt' },
            ]}
            ml="auto"
          />
        </Group>
      </Card>

      {tasks.length === 0 && !tasksQ.isLoading ? (
        <Card withBorder p="xl" radius="md">
          <Stack align="center" gap="sm">
            <TbListCheck size={40} />
            <Text fw={500}>{activeProject ? `No tasks in ${activeProject.name} yet` : 'No tasks found'}</Text>
            <Text size="sm" c="dimmed" ta="center">
              {writableProjects.length === 0
                ? 'Join a project to start creating tasks.'
                : activeProject
                  ? 'Kick things off by creating the first task for this project.'
                  : 'Try clearing filters or creating a new task.'}
            </Text>
            {writableProjects.length > 0 ? (
              <Group gap="xs">
                <Button leftSection={<TbPlus size={14} />} size="xs" onClick={() => setCreateOpen(true)}>
                  New Task
                </Button>
                {activeProject ? (
                  <Button variant="subtle" size="xs" onClick={() => changeProject(null)}>
                    View all tasks
                  </Button>
                ) : null}
              </Group>
            ) : null}
          </Stack>
        </Card>
      ) : view === 'gantt' ? (
        <TasksGanttView tasks={tasks} onSelect={(id) => openTask(id)} />
      ) : view === 'kanban' ? (
        <TasksKanbanView
          tasks={tasks}
          canWrite={writableProjects.length > 0}
          onSelect={(id) => openTask(id)}
          onMove={(id, status) =>
            api(`/api/tasks/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status }),
            })
              .then(() => qc.invalidateQueries({ queryKey: ['tasks'] }))
              .catch(() => qc.invalidateQueries({ queryKey: ['tasks'] }))
          }
        />
      ) : (
        <Card withBorder padding={0} radius="md">
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Title</Table.Th>
                {activeProject ? null : <Table.Th>Project</Table.Th>}
                <Table.Th>Kind</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Assignee</Table.Th>
                <Table.Th>Hours</Table.Th>
                <Table.Th>Progress</Table.Th>
                <Table.Th>Updated</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {tasks.map((t) => {
                const variance =
                  t.estimateHours != null && t.actualHours != null ? t.actualHours - t.estimateHours : null
                const blocked = t._count.blockedBy > 0 && t.status !== 'CLOSED'
                return (
                  <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openTask(t.id)}>
                    <Table.Td>
                      <Stack gap={2}>
                        <Group gap={6} wrap="nowrap">
                          <Text size="sm" fw={500} lineClamp={1}>
                            {t.title}
                          </Text>
                          {blocked ? (
                            <Tooltip label={`Blocked by ${t._count.blockedBy} task(s)`}>
                              <Badge size="xs" color="gray" variant="filled">
                                blocked
                              </Badge>
                            </Tooltip>
                          ) : null}
                        </Group>
                        {t.tags.length > 0 && (
                          <Group gap={4} wrap="wrap">
                            {t.tags.slice(0, 4).map((tt) => (
                              <Badge key={tt.tagId} size="xs" color={tt.tag.color} variant="light">
                                {tt.tag.name}
                              </Badge>
                            ))}
                            {t.tags.length > 4 && (
                              <Text size="xs" c="dimmed">
                                +{t.tags.length - 4}
                              </Text>
                            )}
                          </Group>
                        )}
                      </Stack>
                    </Table.Td>
                    {activeProject ? null : (
                      <Table.Td>
                        <Text size="xs" c="dimmed">
                          {t.project.name}
                        </Text>
                      </Table.Td>
                    )}
                    <Table.Td>
                      <Badge color={KIND_COLOR[t.kind]} variant="light" size="sm">
                        {t.kind}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={STATUS_COLOR[t.status]} variant="light" size="sm">
                        {t.status.replace('_', ' ')}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={PRIORITY_COLOR[t.priority]} variant="dot" size="sm">
                        {t.priority}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{t.assignee?.name ?? '—'}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip
                        label={
                          t.estimateHours != null || t.actualHours != null
                            ? `estimate: ${t.estimateHours ?? '—'}h · actual: ${t.actualHours ?? '—'}h${variance != null ? ` · ${variance > 0 ? '+' : ''}${variance.toFixed(1)}h` : ''}`
                            : 'No hours logged'
                        }
                      >
                        <Group gap={4} wrap="nowrap">
                          <TbClock size={12} />
                          <Text size="xs" c={variance != null && variance > 0 ? 'red' : 'dimmed'}>
                            {t.actualHours != null
                              ? `${t.actualHours}h`
                              : t.estimateHours != null
                                ? `~${t.estimateHours}h`
                                : '—'}
                          </Text>
                        </Group>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td style={{ minWidth: 90 }}>
                      {t.progressPercent != null ? (
                        <Stack gap={2}>
                          <Text size="xs" c="dimmed">
                            {t.progressPercent}%
                          </Text>
                          <Progress
                            value={t.progressPercent}
                            size="xs"
                            color={t.status === 'CLOSED' ? 'green' : 'blue'}
                          />
                        </Stack>
                      ) : (
                        <Text size="xs" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {new Date(t.updatedAt).toLocaleDateString()}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <CreateTaskModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={writableProjects}
        defaultProjectId={activeProjectId ?? writableProjects[0]?.id ?? null}
        onSubmit={(body) => create.mutate(body)}
        loading={create.isPending}
        error={create.error?.message}
        tagsByProject={tagsQ.data?.tags ?? []}
      />
    </Stack>
  )
}

const STATUS_HEX: Record<TaskStatus, string> = {
  OPEN: '#228be6',
  IN_PROGRESS: '#7950f2',
  READY_FOR_QC: '#f59f00',
  REOPENED: '#fd7e14',
  CLOSED: '#40c057',
}

function TaskDashboardOverlay({ tasks }: { tasks: TaskListItem[] }) {
  const { throughput, donut, assignees, stats } = useMemo(() => {
    const days = 14
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const buckets: { date: string; created: number; closed: number }[] = []
    const keyToIdx = new Map<string, number>()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(today.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      keyToIdx.set(key, buckets.length)
      buckets.push({ date: key, created: 0, closed: 0 })
    }
    const byStatus = new Map<TaskStatus, number>()
    const byAssignee = new Map<string, { name: string; count: number }>()

    for (const t of tasks) {
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1)
      const ck = t.createdAt.slice(0, 10)
      const ci = keyToIdx.get(ck)
      if (ci !== undefined) buckets[ci].created += 1
      if (t.closedAt) {
        const xk = t.closedAt.slice(0, 10)
        const xi = keyToIdx.get(xk)
        if (xi !== undefined) buckets[xi].closed += 1
      }
      if (t.status !== 'CLOSED' && t.assignee) {
        const existing = byAssignee.get(t.assignee.id)
        if (existing) existing.count += 1
        else byAssignee.set(t.assignee.id, { name: t.assignee.name, count: 1 })
      }
    }

    const throughputOpt: EChartsOption = {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Created', 'Closed'], top: 0, right: 8 },
      grid: { left: 36, right: 16, top: 36, bottom: 28 },
      xAxis: { type: 'category', data: buckets.map((b) => b.date.slice(5)), boundaryGap: false },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: 'Created',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: '#228be6' },
          data: buckets.map((b) => b.created),
        },
        {
          name: 'Closed',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          areaStyle: { opacity: 0.15 },
          itemStyle: { color: '#40c057' },
          data: buckets.map((b) => b.closed),
        },
      ],
    }

    const donutOpt: EChartsOption = {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, left: 'center', itemGap: 8 },
      series: [
        {
          type: 'pie',
          radius: ['55%', '78%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          data: (Array.from(byStatus.entries()) as [TaskStatus, number][]).map(([s, v]) => ({
            name: s.replace('_', ' '),
            value: v,
            itemStyle: { color: STATUS_HEX[s] },
          })),
        },
      ],
    }

    const topAssignees = Array.from(byAssignee.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8)
      .reverse()

    const assigneesOpt: EChartsOption = {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 90, right: 16, top: 12, bottom: 24 },
      xAxis: { type: 'value', minInterval: 1 },
      yAxis: { type: 'category', data: topAssignees.map((a) => a.name) },
      series: [
        {
          type: 'bar',
          data: topAssignees.map((a) => a.count),
          itemStyle: { color: '#7950f2', borderRadius: [0, 4, 4, 0] },
          barMaxWidth: 18,
          label: { show: true, position: 'right', fontSize: 11 },
        },
      ],
    }

    const openCount = tasks.filter((t) => t.status !== 'CLOSED').length
    const closedCount = tasks.length - openCount
    const overdueCount = tasks.filter(
      (t) => t.status !== 'CLOSED' && t.dueAt && new Date(t.dueAt).getTime() < today.getTime(),
    ).length

    return {
      throughput: throughputOpt,
      donut: donutOpt,
      assignees: assigneesOpt,
      stats: { total: tasks.length, open: openCount, closed: closedCount, overdue: overdueCount },
    }
  }, [tasks])

  return (
    <Stack gap="sm">
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Total
          </Text>
          <Text fw={700} size="xl">
            {stats.total}
          </Text>
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Open
          </Text>
          <Text fw={700} size="xl" c="blue">
            {stats.open}
          </Text>
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Closed
          </Text>
          <Text fw={700} size="xl" c="green">
            {stats.closed}
          </Text>
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="xs" c="dimmed">
            Overdue
          </Text>
          <Text fw={700} size="xl" c={stats.overdue > 0 ? 'red' : undefined}>
            {stats.overdue}
          </Text>
        </Card>
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
        <Card withBorder padding="sm" radius="md">
          <Text size="sm" fw={500} mb={4}>
            Throughput (last 14 days)
          </Text>
          <EChart option={throughput} height={200} />
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="sm" fw={500} mb={4}>
            Status breakdown
          </Text>
          <EChart option={donut} height={200} />
        </Card>
        <Card withBorder padding="sm" radius="md">
          <Text size="sm" fw={500} mb={4}>
            Top assignees (open)
          </Text>
          <EChart option={assignees} height={200} />
        </Card>
      </SimpleGrid>
    </Stack>
  )
}

function CreateTaskModal({
  opened,
  onClose,
  projects,
  defaultProjectId,
  onSubmit,
  loading,
  error,
  tagsByProject,
}: {
  opened: boolean
  onClose: () => void
  projects: ProjectOption[]
  defaultProjectId: string | null
  onSubmit: (body: {
    projectId: string
    title: string
    description: string
    kind: TaskKind
    priority: TaskPriority
    startsAt: string | null
    dueAt: string | null
    estimateHours: number | null
    tagIds: string[]
  }) => void
  loading: boolean
  error?: string
  tagsByProject: TagListItem[]
}) {
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<TaskKind>('TASK')
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [startsAt, setStartsAt] = useState<Date | null>(null)
  const [dueAt, setDueAt] = useState<Date | null>(null)
  const [estimateHours, setEstimateHours] = useState<number | string>('')
  const [tagIds, setTagIds] = useState<string[]>([])

  const invalidRange = startsAt && dueAt && dueAt < startsAt
  const availableTags = tagsByProject.filter((t) => t.projectId === projectId)

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setTitle('')
        setDescription('')
        setStartsAt(null)
        setDueAt(null)
        setEstimateHours('')
        setTagIds([])
        onClose()
      }}
      title="Create Task"
      size="md"
    >
      <Stack gap="sm">
        <Select
          label="Project"
          data={projects.map((p) => ({ value: p.id, label: p.name }))}
          value={projectId}
          onChange={setProjectId}
          required
        />
        <TextInput
          label="Title"
          placeholder="What needs to get done?"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          required
        />
        <Textarea
          label="Description"
          placeholder="Context, acceptance criteria, etc."
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
          autosize
          minRows={3}
          maxRows={8}
          required
        />
        <Group grow>
          <Select
            label="Kind"
            data={['TASK', 'BUG', 'QC']}
            value={kind}
            onChange={(v) => setKind((v as TaskKind) || 'TASK')}
          />
          <Select
            label="Priority"
            data={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']}
            value={priority}
            onChange={(v) => setPriority((v as TaskPriority) || 'MEDIUM')}
          />
        </Group>
        <Group grow>
          <DateInput
            label="Start date"
            placeholder="Optional"
            value={startsAt}
            onChange={(v) => setStartsAt(v ? new Date(v as unknown as string) : null)}
            clearable
          />
          <DateInput
            label="Due date"
            placeholder="Optional"
            value={dueAt}
            onChange={(v) => setDueAt(v ? new Date(v as unknown as string) : null)}
            clearable
            error={invalidRange ? 'Due must be after start' : undefined}
          />
          <NumberInput
            label="Estimate (hours)"
            placeholder="e.g. 2.5"
            value={estimateHours}
            onChange={setEstimateHours}
            min={0}
            step={0.5}
            decimalScale={2}
            leftSection={<TbClock size={14} />}
          />
        </Group>
        {availableTags.length > 0 && (
          <MultiSelect
            label="Tags"
            placeholder="Pick tags"
            data={availableTags.map((t) => ({ value: t.id, label: t.name }))}
            value={tagIds}
            onChange={setTagIds}
            leftSection={<TbTag size={14} />}
            searchable
            clearable
          />
        )}
        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              projectId &&
              onSubmit({
                projectId,
                title: title.trim(),
                description: description.trim(),
                kind,
                priority,
                startsAt: startsAt ? startsAt.toISOString() : null,
                dueAt: dueAt ? dueAt.toISOString() : null,
                estimateHours: typeof estimateHours === 'number' ? estimateHours : null,
                tagIds,
              })
            }
            disabled={!projectId || !title.trim() || !description.trim() || Boolean(invalidRange) || loading}
            loading={loading}
          >
            Create
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}

const GANTT_STATUS_HEX: Record<TaskStatus, string> = {
  OPEN: '#868e96',
  IN_PROGRESS: '#7950f2',
  READY_FOR_QC: '#f59f00',
  REOPENED: '#fd7e14',
  CLOSED: '#40c057',
}

const KANBAN_COLUMNS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'OPEN', label: 'Open' },
  { status: 'IN_PROGRESS', label: 'In Progress' },
  { status: 'READY_FOR_QC', label: 'Ready for QC' },
  { status: 'REOPENED', label: 'Reopened' },
  { status: 'CLOSED', label: 'Closed' },
]

function kanbanAllowed(current: TaskStatus, kind: TaskKind): TaskStatus[] {
  if (kind === 'TASK') {
    const m: Record<TaskStatus, TaskStatus[]> = {
      OPEN: ['IN_PROGRESS', 'CLOSED'],
      IN_PROGRESS: ['OPEN', 'CLOSED'],
      CLOSED: ['REOPENED'],
      REOPENED: ['IN_PROGRESS', 'CLOSED'],
      READY_FOR_QC: ['CLOSED', 'REOPENED'],
    }
    return m[current] ?? []
  }
  const m: Record<TaskStatus, TaskStatus[]> = {
    OPEN: ['IN_PROGRESS', 'CLOSED'],
    IN_PROGRESS: ['READY_FOR_QC', 'CLOSED'],
    READY_FOR_QC: ['CLOSED', 'REOPENED'],
    REOPENED: ['IN_PROGRESS', 'CLOSED'],
    CLOSED: ['REOPENED'],
  }
  return m[current] ?? []
}

function TasksKanbanView({
  tasks,
  canWrite,
  onSelect,
  onMove,
}: {
  tasks: TaskListItem[]
  canWrite: boolean
  onSelect: (id: string) => void
  onMove: (id: string, status: TaskStatus) => void
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<TaskStatus | null>(null)
  const draggingTask = draggingId ? tasks.find((t) => t.id === draggingId) : null
  const allowedForDrag = draggingTask ? kanbanAllowed(draggingTask.status, draggingTask.kind) : []

  const byStatus = useMemo(() => {
    const map: Record<TaskStatus, TaskListItem[]> = {
      OPEN: [],
      IN_PROGRESS: [],
      READY_FOR_QC: [],
      REOPENED: [],
      CLOSED: [],
    }
    for (const t of tasks) map[t.status].push(t)
    return map
  }, [tasks])

  const handleDrop = (status: TaskStatus) => {
    if (!draggingTask) return
    setOverStatus(null)
    setDraggingId(null)
    if (draggingTask.status === status) return
    if (!allowedForDrag.includes(status)) return
    onMove(draggingTask.id, status)
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${KANBAN_COLUMNS.length}, minmax(240px, 1fr))`,
        gap: 12,
        overflowX: 'auto',
      }}
    >
      {KANBAN_COLUMNS.map((col) => {
        const items = byStatus[col.status]
        const canDrop = !!draggingTask && draggingTask.status !== col.status && allowedForDrag.includes(col.status)
        const isOver = overStatus === col.status
        return (
          <Card
            key={col.status}
            withBorder
            padding="xs"
            radius="md"
            style={{
              background: isOver && canDrop ? 'var(--mantine-color-blue-light)' : undefined,
              borderColor: isOver && canDrop ? 'var(--mantine-color-blue-filled)' : undefined,
              borderStyle: draggingTask && !canDrop && draggingTask.status !== col.status ? 'dashed' : undefined,
              opacity: draggingTask && !canDrop && draggingTask.status !== col.status ? 0.55 : 1,
              minHeight: 240,
            }}
            onDragOver={(e) => {
              if (!canDrop) return
              e.preventDefault()
              if (overStatus !== col.status) setOverStatus(col.status)
            }}
            onDragLeave={() => {
              if (overStatus === col.status) setOverStatus(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              handleDrop(col.status)
            }}
          >
            <Group justify="space-between" mb={6}>
              <Group gap={6}>
                <Badge size="sm" color={STATUS_COLOR[col.status]} variant="light">
                  {col.label}
                </Badge>
                <Text size="xs" c="dimmed">
                  {items.length}
                </Text>
              </Group>
            </Group>
            <Stack gap={6}>
              {items.length === 0 ? (
                <Text size="xs" c="dimmed" ta="center" py="md">
                  {draggingTask && canDrop ? 'Drop here' : 'No tasks'}
                </Text>
              ) : (
                items.map((t) => (
                  <Card
                    key={t.id}
                    withBorder
                    padding="xs"
                    radius="sm"
                    draggable={canWrite}
                    onDragStart={() => setDraggingId(t.id)}
                    onDragEnd={() => {
                      setDraggingId(null)
                      setOverStatus(null)
                    }}
                    onClick={() => onSelect(t.id)}
                    style={{
                      cursor: canWrite ? 'grab' : 'pointer',
                      opacity: draggingId === t.id ? 0.5 : 1,
                    }}
                  >
                    <Stack gap={4}>
                      <Group gap={4} wrap="wrap">
                        <Badge size="xs" color={KIND_COLOR[t.kind]} variant="light">
                          {t.kind}
                        </Badge>
                        <Badge size="xs" color={PRIORITY_COLOR[t.priority]} variant="dot">
                          {t.priority}
                        </Badge>
                      </Group>
                      <Text size="sm" fw={500} lineClamp={2}>
                        {t.title}
                      </Text>
                      {t.tags.length > 0 && (
                        <Group gap={4} wrap="wrap">
                          {t.tags.slice(0, 3).map((tg) => (
                            <Badge key={tg.tagId} size="xs" variant="light" color={tg.tag.color}>
                              {tg.tag.name}
                            </Badge>
                          ))}
                        </Group>
                      )}
                      {t.progressPercent != null && t.progressPercent > 0 && (
                        <div
                          style={{
                            height: 4,
                            background: 'var(--mantine-color-gray-2)',
                            borderRadius: 2,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${t.progressPercent}%`,
                              height: '100%',
                              background:
                                t.status === 'CLOSED' ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-blue-6)',
                            }}
                          />
                        </div>
                      )}
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="xs" c="dimmed" truncate>
                          {t.assignee ? t.assignee.name : 'Unassigned'}
                        </Text>
                        {t.dueAt && (
                          <Text
                            size="xs"
                            c={new Date(t.dueAt) < new Date() && t.status !== 'CLOSED' ? 'red' : 'dimmed'}
                          >
                            {new Date(t.dueAt).toLocaleDateString()}
                          </Text>
                        )}
                      </Group>
                    </Stack>
                  </Card>
                ))
              )}
            </Stack>
          </Card>
        )
      })}
    </div>
  )
}

function TasksGanttView({ tasks, onSelect }: { tasks: TaskListItem[]; onSelect: (id: string) => void }) {
  const withDates = useMemo(() => tasks.filter((t) => (t.startsAt || t.createdAt) && t.dueAt), [tasks])

  const option = useMemo<EChartsOption>(() => {
    const now = Date.now()
    const categories = withDates.map((t) => t.title)
    const data = withDates.map((t, idx) => {
      const start = new Date(t.startsAt ?? t.createdAt).getTime()
      const end = new Date(t.dueAt as string).getTime()
      const overdue = end < now && t.status !== 'CLOSED'
      const color = overdue ? '#fa5252' : GANTT_STATUS_HEX[t.status]
      return {
        name: t.title,
        value: [idx, start, end],
        taskId: t.id,
        status: t.status,
        assignee: t.assignee?.name ?? 'Unassigned',
        progressPercent: t.progressPercent,
        overdue,
        itemStyle: { color },
      }
    })

    type BarData = (typeof data)[number]

    return {
      grid: { left: 200, right: 24, top: 12, bottom: 48, containLabel: false },
      xAxis: { type: 'time', position: 'bottom', splitLine: { show: true } },
      yAxis: {
        type: 'category',
        data: categories,
        inverse: true,
        axisLabel: { width: 180, overflow: 'truncate', fontSize: 11 },
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
            `Status: ${d.status.replace('_', ' ')} · Assignee: ${d.assignee}`,
          ]
          if (d.progressPercent != null) parts.push(`Progress: ${d.progressPercent}%`)
          if (d.overdue) parts.push('<span style="color:#fa5252">Overdue</span>')
          return parts.join('<br/>')
        },
      },
      series: [
        {
          type: 'custom',
          encode: { x: [1, 2], y: 0 },
          data,
          renderItem: (_params: unknown, apiRef: unknown) => {
            const api = apiRef as {
              value: (i: number) => number
              coord: (pt: [number, number]) => [number, number]
              size: (v: [number, number]) => [number, number]
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
        { type: 'slider', xAxisIndex: 0, height: 18, bottom: 8 },
        { type: 'inside', xAxisIndex: 0 },
      ],
    } as unknown as EChartsOption
  }, [withDates])

  if (withDates.length === 0) {
    return (
      <Card withBorder p="xl" radius="md">
        <Stack align="center" gap="xs">
          <TbListCheck size={32} />
          <Text fw={500}>No tasks with due date</Text>
          <Text size="sm" c="dimmed">
            Set a due date (and optionally a start date) on a task to see it here.
          </Text>
        </Stack>
      </Card>
    )
  }

  const height = Math.max(240, withDates.length * 32 + 80)

  return (
    <Card withBorder padding="sm" radius="md">
      <EChart
        option={option}
        height={height}
        onEvents={{
          click: (params: unknown) => {
            const p = params as { data?: { taskId?: string } }
            const id = p?.data?.taskId
            if (id) onSelect(id)
          },
        }}
      />
    </Card>
  )
}
