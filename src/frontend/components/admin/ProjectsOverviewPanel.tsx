import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Pagination,
  Progress,
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
import {
  TbAlertTriangle,
  TbCheck,
  TbClock,
  TbExternalLink,
  TbRefresh,
  TbSearch,
  TbTarget,
  TbUsers,
} from 'react-icons/tb'
import { EmptyRow } from '@/frontend/components/shared/EmptyState'
import { InfoTip } from '@/frontend/components/shared/InfoTip'
import type { ProjectListItem, ProjectPriority, ProjectStatus } from '../ProjectsPanel'

const PAGE_SIZE = 25

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

function isOverdue(p: Pick<ProjectListItem, 'endsAt' | 'status'>): boolean {
  if (!p.endsAt) return false
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED') return false
  return new Date(p.endsAt).getTime() < Date.now()
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ProjectsOverviewPanel() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null)
  const [healthFilter, setHealthFilter] = useState<'all' | 'overdue' | 'extended'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'projects-overview'],
    queryFn: () =>
      fetch('/api/projects', { credentials: 'include' }).then((r) => r.json()) as Promise<{
        projects: ProjectListItem[]
      }>,
  })

  const projects = data?.projects ?? []

  const ownerOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of projects) map.set(p.owner.id, `${p.owner.name} (${p.owner.email})`)
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }))
  }, [projects])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return projects.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false
      if (priorityFilter && p.priority !== priorityFilter) return false
      if (ownerFilter && p.owner.id !== ownerFilter) return false
      if (healthFilter === 'overdue' && !isOverdue(p)) return false
      if (healthFilter === 'extended') {
        const extended =
          p.originalEndAt && p.endsAt && new Date(p.endsAt).getTime() !== new Date(p.originalEndAt).getTime()
        if (!extended) return false
      }
      if (q) {
        const hay = `${p.name} ${p.description ?? ''} ${p.owner.name} ${p.owner.email}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [projects, statusFilter, priorityFilter, ownerFilter, healthFilter, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedFiltered = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [statusFilter, priorityFilter, ownerFilter, healthFilter, search])

  const stats = useMemo(() => {
    const total = projects.length
    const active = projects.filter((p) => p.status === 'ACTIVE').length
    const overdue = projects.filter(isOverdue).length
    const completed = projects.filter((p) => p.status === 'COMPLETED').length
    return { total, active, overdue, completed }
  }, [projects])

  const openProject = (id: string) => {
    navigate({ to: '/pm', search: { tab: 'projects', projectId: id } })
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Title order={3}>Projects Overview</Title>
            <InfoTip
              width={340}
              label="Daftar seluruh project di sistem (admin view). Berbeda dengan /pm yang hanya menampilkan project yang user-nya owner atau member. Klik baris untuk buka detail."
            />
          </Group>
          <Text size="sm" c="dimmed">
            Semua project lintas user. Klik baris untuk membuka detail.
          </Text>
        </div>
        <Tooltip label="Refresh">
          <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
            <TbRefresh size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatCard
          label="Total"
          value={stats.total}
          icon={TbTarget}
          color="blue"
          tip="Jumlah seluruh project termasuk DRAFT / ACTIVE / ON_HOLD / COMPLETED / CANCELLED."
        />
        <StatCard
          label="Active"
          value={stats.active}
          icon={TbClock}
          color="teal"
          tip="Project dengan status ACTIVE (sedang dikerjakan). DRAFT = belum mulai, ON_HOLD = paused sementara."
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          icon={TbAlertTriangle}
          color="red"
          tip="Project dengan endsAt < hari ini, status bukan COMPLETED/CANCELLED. Perlu ekstension deadline atau review scope."
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={TbCheck}
          color="green"
          tip="Project dengan status COMPLETED. Delivered dan closed."
        />
      </SimpleGrid>

      <Card withBorder padding="sm" radius="md">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Cari nama, deskripsi, atau owner"
            leftSection={<TbSearch size={12} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            size="xs"
            w={280}
          />
          <Select
            placeholder="All statuses"
            data={['DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']}
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
            placeholder="All owners"
            data={ownerOptions}
            value={ownerFilter}
            onChange={setOwnerFilter}
            clearable
            searchable
            size="xs"
            w={240}
            leftSection={<TbUsers size={12} />}
          />
          <Tooltip
            multiline
            w={300}
            withArrow
            label="Filter kondisi project: Overdue = endsAt sudah lewat. Extended = endsAt sudah digeser dari originalEndAt (ada ProjectExtension). Semua status dihitung, tidak hanya ACTIVE."
          >
            <Select
              data={[
                { value: 'all', label: 'All health' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'extended', label: 'Extended' },
              ]}
              value={healthFilter}
              onChange={(v) => setHealthFilter((v as 'all' | 'overdue' | 'extended') ?? 'all')}
              size="xs"
              w={140}
            />
          </Tooltip>
          <Badge variant="light" size="sm" ml="auto">
            {filtered.length} of {projects.length}
          </Badge>
        </Group>
      </Card>

      <Card withBorder padding={0} radius="md">
        <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Project</Table.Th>
              <Table.Th>Owner</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th>
                <Tooltip label="Jumlah task CLOSED / total task + bar progress. 100% bar berubah hijau.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Tasks</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Milestone = sub-deadline dalam project. Format done / total. '—' = project belum punya milestone.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Milestones</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>Members</Table.Th>
              <Table.Th>Deadline</Table.Th>
              <Table.Th style={{ width: 40 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && (
              <Table.Tr>
                <Table.Td colSpan={9}>
                  <EmptyRow icon={TbTarget} title="Memuat project…" />
                </Table.Td>
              </Table.Tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={9}>
                  <EmptyRow
                    icon={TbSearch}
                    title="Tidak ada project yang cocok"
                    message="Coba ubah filter status/prioritas atau reset pencarian."
                  />
                </Table.Td>
              </Table.Tr>
            )}
            {pagedFiltered.map((p) => {
              const overdue = isOverdue(p)
              const taskTotal = p.taskStats?.total ?? 0
              const taskDone = p.taskStats?.closed ?? 0
              const taskPct = taskTotal > 0 ? Math.round((taskDone / taskTotal) * 100) : 0
              const msDone = p.milestoneStats?.done ?? 0
              const msTotal = p.milestoneStats?.total ?? 0
              const extended =
                p.originalEndAt && p.endsAt && new Date(p.endsAt).getTime() !== new Date(p.originalEndAt).getTime()
              return (
                <Table.Tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => openProject(p.id)}>
                  <Table.Td>
                    <Stack gap={2}>
                      <Text size="sm" fw={500} lineClamp={1}>
                        {p.name}
                      </Text>
                      {p.description && (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {p.description}
                        </Text>
                      )}
                    </Stack>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{p.owner.name}</Text>
                    <Text size="xs" c="dimmed">
                      {p.owner.email}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[p.status]} variant="light" size="sm">
                      {p.status.replace('_', ' ')}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Badge color={PRIORITY_COLOR[p.priority]} variant="dot" size="sm">
                      {p.priority}
                    </Badge>
                  </Table.Td>
                  <Table.Td style={{ minWidth: 120 }}>
                    {taskTotal > 0 ? (
                      <Stack gap={2}>
                        <Text size="xs" c="dimmed">
                          {taskDone} / {taskTotal} · {taskPct}%
                        </Text>
                        <Progress value={taskPct} size="xs" color={taskPct === 100 ? 'green' : 'blue'} />
                      </Stack>
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {msTotal > 0 ? `${msDone} / ${msTotal}` : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {p._count.members}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <Text size="xs" c={overdue ? 'red' : 'dimmed'} fw={overdue ? 600 : undefined}>
                        {formatDate(p.endsAt)}
                      </Text>
                      {extended && (
                        <Tooltip
                          multiline
                          w={260}
                          label={`Deadline diperpanjang dari rencana awal. Original: ${formatDate(p.originalEndAt)}. Indikator schedule slip atau scope creep.`}
                        >
                          <Badge color="grape" variant="light" size="xs">
                            ext
                          </Badge>
                        </Tooltip>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        openProject(p.id)
                      }}
                      aria-label="Open project"
                    >
                      <TbExternalLink size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
        {filtered.length > PAGE_SIZE && (
          <Group justify="space-between" p="md">
            <Text size="xs" c="dimmed">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} dari {filtered.length}
            </Text>
            <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
          </Group>
        )}
      </Card>
    </Stack>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  tip,
}: {
  label: string
  value: number
  icon: typeof TbTarget
  color: string
  tip?: string
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start">
        <div style={{ flex: 1 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" fw={500} tt="uppercase">
              {label}
            </Text>
            {tip && <InfoTip label={tip} size={12} />}
          </Group>
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
