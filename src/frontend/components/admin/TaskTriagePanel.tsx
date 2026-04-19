import {
  ActionIcon,
  Badge,
  Card,
  Container,
  Group,
  Pagination,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { TbAlertTriangle, TbBan, TbClock, TbListCheck, TbRefresh, TbSearch, TbUserQuestion } from 'react-icons/tb'
import { EmptyRow } from '@/frontend/components/shared/EmptyState'

type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
type TaskKind = 'TASK' | 'BUG' | 'QC'

interface TriageTask {
  id: string
  projectId: string
  kind: TaskKind
  title: string
  status: TaskStatus
  priority: TaskPriority
  assignee: { id: string; name: string; email: string } | null
  startsAt: string | null
  dueAt: string | null
  createdAt: string
  updatedAt: string
  closedAt: string | null
  project: { id: string; name: string }
  _count: { comments: number; evidence: number; blockedBy: number; blocks: number }
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

const STALE_DAYS = 7
const PAGE_SIZE = 25

function isOpen(t: TriageTask) {
  return t.status !== 'CLOSED'
}

function isOverdue(t: TriageTask) {
  if (!t.dueAt || !isOpen(t)) return false
  return new Date(t.dueAt).getTime() < Date.now()
}

function isStale(t: TriageTask) {
  if (!isOpen(t)) return false
  const ms = Date.now() - new Date(t.updatedAt).getTime()
  return ms > STALE_DAYS * 24 * 60 * 60 * 1000
}

function ageDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000))
}

function formatAge(iso: string): string {
  const d = ageDays(iso)
  if (d === 0) return 'today'
  if (d === 1) return '1d'
  return `${d}d`
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

type QuickFilter = 'all' | 'overdue' | 'unassigned' | 'blocked' | 'stale'

export function TaskTriagePanel() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null)
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null)
  const [quick, setQuick] = useState<QuickFilter>('all')
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'task-triage'],
    queryFn: () =>
      fetch('/api/tasks?limit=500', { credentials: 'include' }).then((r) => r.json()) as Promise<{
        tasks: TriageTask[]
      }>,
    refetchInterval: 30_000,
  })

  const tasks = data?.tasks ?? []

  const openTasks = useMemo(() => tasks.filter(isOpen), [tasks])

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tasks) map.set(t.project.id, t.project.name)
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  }, [tasks])

  const assigneeOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tasks) {
      if (t.assignee) map.set(t.assignee.id, `${t.assignee.name} (${t.assignee.email})`)
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  }, [tasks])

  const stats = useMemo(() => {
    const total = openTasks.length
    const overdue = openTasks.filter(isOverdue).length
    const unassigned = openTasks.filter((t) => !t.assignee).length
    const stale = openTasks.filter(isStale).length
    const blocked = openTasks.filter((t) => t._count.blockedBy > 0).length
    return { total, overdue, unassigned, stale, blocked }
  }, [openTasks])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((t) => {
      if (quick === 'overdue' && !isOverdue(t)) return false
      if (quick === 'unassigned' && (t.assignee || !isOpen(t))) return false
      if (quick === 'blocked' && (t._count.blockedBy === 0 || !isOpen(t))) return false
      if (quick === 'stale' && !isStale(t)) return false
      if (projectFilter && t.project.id !== projectFilter) return false
      if (statusFilter && t.status !== statusFilter) return false
      if (priorityFilter && t.priority !== priorityFilter) return false
      if (assigneeFilter === '__none__' && t.assignee) return false
      if (assigneeFilter && assigneeFilter !== '__none__' && t.assignee?.id !== assigneeFilter) return false
      if (q) {
        const hay = `${t.title} ${t.project.name} ${t.assignee?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, quick, projectFilter, statusFilter, priorityFilter, assigneeFilter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedFiltered = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [quick, projectFilter, statusFilter, priorityFilter, assigneeFilter, search])

  const openTask = (t: TriageTask) => {
    navigate({ to: '/pm', search: { tab: 'tasks', projectId: t.project.id, taskId: t.id } })
  }

  const clearFilters = () => {
    setSearch('')
    setProjectFilter(null)
    setStatusFilter(null)
    setPriorityFilter(null)
    setAssigneeFilter(null)
    setQuick('all')
  }

  const hasFilters =
    !!search || !!projectFilter || !!statusFilter || !!priorityFilter || !!assigneeFilter || quick !== 'all'

  return (
    <Container size="xl" px={0}>
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={3}>Task Triage</Title>
            <Text size="sm" c="dimmed">
              Fokus ke task yang butuh perhatian di seluruh project.
            </Text>
          </div>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        <SimpleGrid cols={{ base: 2, md: 5 }} spacing="md">
          <StatCard label="Open" value={stats.total} icon={TbListCheck} color="blue" />
          <StatCard label="Overdue" value={stats.overdue} icon={TbAlertTriangle} color="red" />
          <StatCard label="Unassigned" value={stats.unassigned} icon={TbUserQuestion} color="orange" />
          <StatCard label="Blocked" value={stats.blocked} icon={TbBan} color="grape" />
          <StatCard label={`Stale >${STALE_DAYS}d`} value={stats.stale} icon={TbClock} color="yellow" />
        </SimpleGrid>

        <Card withBorder padding="sm" radius="md">
          <Stack gap="xs">
            <Group gap="sm" wrap="wrap">
              <TextInput
                placeholder="Cari judul, project, atau assignee"
                leftSection={<TbSearch size={12} />}
                value={search}
                onChange={(e) => setSearch(e.currentTarget.value)}
                size="xs"
                w={280}
              />
              <Select
                placeholder="All projects"
                data={projectOptions}
                value={projectFilter}
                onChange={setProjectFilter}
                clearable
                searchable
                size="xs"
                w={200}
              />
              <Select
                placeholder="All statuses"
                data={['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'REOPENED', 'CLOSED']}
                value={statusFilter}
                onChange={setStatusFilter}
                clearable
                size="xs"
                w={160}
              />
              <Select
                placeholder="All priorities"
                data={['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']}
                value={priorityFilter}
                onChange={setPriorityFilter}
                clearable
                size="xs"
                w={140}
              />
              <Select
                placeholder="All assignees"
                data={[{ value: '__none__', label: '— Unassigned —' }, ...assigneeOptions]}
                value={assigneeFilter}
                onChange={setAssigneeFilter}
                clearable
                searchable
                size="xs"
                w={220}
              />
              <Badge variant="light" size="sm" ml="auto">
                {filtered.length} of {tasks.length}
              </Badge>
            </Group>
            <Group gap="sm" wrap="wrap">
              <Text size="xs" c="dimmed" fw={500} tt="uppercase">
                Attention
              </Text>
              <SegmentedControl
                size="xs"
                value={quick}
                onChange={(v) => setQuick(v as QuickFilter)}
                data={[
                  { label: 'All', value: 'all' },
                  { label: 'Overdue', value: 'overdue' },
                  { label: 'Unassigned', value: 'unassigned' },
                  { label: 'Blocked', value: 'blocked' },
                  { label: `Stale >${STALE_DAYS}d`, value: 'stale' },
                ]}
              />
              {hasFilters && (
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  onClick={clearFilters}
                >
                  Clear
                </Text>
              )}
            </Group>
          </Stack>
        </Card>

        <Card withBorder padding={0} radius="md">
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Task</Table.Th>
                <Table.Th>Project</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Priority</Table.Th>
                <Table.Th>Assignee</Table.Th>
                <Table.Th>Due</Table.Th>
                <Table.Th>Age</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <EmptyRow icon={TbListCheck} title="Memuat task…" />
                  </Table.Td>
                </Table.Tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <EmptyRow
                      icon={TbSearch}
                      title="Tidak ada task yang cocok"
                      message="Coba ubah filter atau reset pencarian."
                    />
                  </Table.Td>
                </Table.Tr>
              )}
              {pagedFiltered.map((t) => {
                const overdue = isOverdue(t)
                const stale = isStale(t)
                return (
                  <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => openTask(t)}>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Badge color={KIND_COLOR[t.kind]} variant="dot" size="xs">
                          {t.kind}
                        </Badge>
                        <Text size="sm" fw={500} lineClamp={1}>
                          {t.title}
                        </Text>
                        {t._count.blockedBy > 0 && (
                          <Tooltip label={`Blocked by ${t._count.blockedBy}`}>
                            <Badge color="grape" variant="light" size="xs" leftSection={<TbBan size={10} />}>
                              {t._count.blockedBy}
                            </Badge>
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {t.project.name}
                      </Text>
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
                      {t.assignee ? (
                        <Text size="xs">{t.assignee.name}</Text>
                      ) : (
                        <Badge color="orange" variant="light" size="xs">
                          Unassigned
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={overdue ? 'red' : 'dimmed'} fw={overdue ? 600 : undefined}>
                        {formatDate(t.dueAt)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={stale ? 'yellow.7' : 'dimmed'} fw={stale ? 600 : undefined}>
                        {formatAge(t.updatedAt)}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
          {filtered.length > PAGE_SIZE && (
            <Group justify="space-between" p="md">
              <Text size="xs" c="dimmed">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} dari{' '}
                {filtered.length}
              </Text>
              <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
            </Group>
          )}
        </Card>
      </Stack>
    </Container>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: number
  icon: typeof TbListCheck
  color: string
}) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            {label}
          </Text>
          <Text fw={700} size="xl">
            {value}
          </Text>
        </div>
        <ThemeIcon variant="light" color={color} size="md" radius="md">
          <Icon size={16} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}
