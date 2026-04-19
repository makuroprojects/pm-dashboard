import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Divider,
  Group,
  Indicator,
  List,
  Menu,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import {
  TbActivity,
  TbAlertTriangle,
  TbArrowRight,
  TbCheck,
  TbCopy,
  TbDeviceDesktop,
  TbDots,
  TbPlugConnectedX,
  TbRefresh,
  TbShieldCheck,
  TbShieldOff,
  TbUserCheck,
} from 'react-icons/tb'
import { EmptyState } from '@/frontend/components/shared/EmptyState'
import { LoadingBlock } from '@/frontend/components/shared/LoadingState'
import { notifyError, notifySuccess } from '@/frontend/lib/notify'

const PAGE_SIZE = 25

type AgentStatus = 'PENDING' | 'APPROVED' | 'REVOKED'
type Filter = 'all' | AgentStatus

interface AgentUser {
  id: string
  name: string
  email: string
  role: string
}

interface AgentRow {
  id: string
  agentId: string
  hostname: string
  osUser: string
  status: AgentStatus
  claimedBy: AgentUser | null
  lastSeenAt: string | null
  createdAt: string
  _count: { events: number }
}

interface UserOption {
  id: string
  name: string
  email: string
  role: string
  blocked: boolean
}

const STATUS_COLOR: Record<AgentStatus, string> = {
  PENDING: 'yellow',
  APPROVED: 'green',
  REVOKED: 'red',
}

const LIVE_THRESHOLD_MS = 5 * 60 * 1000
const STALE_THRESHOLD_MS = 60 * 60 * 1000

interface Liveness {
  color: string
  label: string
  processing: boolean
}

function getLiveness(status: AgentStatus, lastSeenAt: string | null): Liveness {
  if (status === 'REVOKED') return { color: 'red', label: 'revoked', processing: false }
  if (!lastSeenAt) return { color: 'gray', label: 'never seen', processing: false }
  const diff = Date.now() - new Date(lastSeenAt).getTime()
  if (diff < LIVE_THRESHOLD_MS) return { color: 'teal', label: 'live', processing: true }
  if (diff < STALE_THRESHOLD_MS) return { color: 'green', label: formatRelative(lastSeenAt), processing: false }
  return { color: 'gray', label: `stale · ${formatRelative(lastSeenAt)}`, processing: false }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

type GroupMode = 'flat' | 'user'

export function AgentsPanel() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<Filter>('all')
  const [groupMode, setGroupMode] = useState<GroupMode>('flat')
  const [page, setPage] = useState(1)

  const {
    data: list,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['admin', 'agents'],
    queryFn: () => api<{ agents: AgentRow[] }>('/api/admin/agents'),
    refetchInterval: 15_000,
  })

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api<{ users: UserOption[] }>('/api/admin/users'),
  })

  const approve = useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) =>
      api(`/api/admin/agents/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'agents'] })
      notifySuccess({ message: 'Agent disetujui.' })
    },
    onError: (err) => notifyError(err),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => api(`/api/admin/agents/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'agents'] })
      notifySuccess({ message: 'Agent di-revoke. Event baru akan ditolak.' })
    },
    onError: (err) => notifyError(err),
  })

  const allAgents = list?.agents ?? []
  const agents = allAgents.filter((a) => (statusFilter === 'all' ? true : a.status === statusFilter))
  const totalPages = Math.max(1, Math.ceil(agents.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedAgents = agents.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page when filter changes
  useEffect(() => {
    setPage(1)
  }, [statusFilter, groupMode])

  const groups = useMemo(() => {
    if (groupMode !== 'user') return []
    const now = Date.now()
    const byUser = new Map<string, { user: AgentUser | null; agents: AgentRow[]; events: number; live: number }>()
    const unassignedKey = '__unassigned__'
    for (const a of agents) {
      const key = a.claimedBy?.id ?? unassignedKey
      let bucket = byUser.get(key)
      if (!bucket) {
        bucket = { user: a.claimedBy, agents: [], events: 0, live: 0 }
        byUser.set(key, bucket)
      }
      bucket.agents.push(a)
      bucket.events += a._count.events
      if (a.lastSeenAt && now - new Date(a.lastSeenAt).getTime() < LIVE_THRESHOLD_MS) bucket.live += 1
    }
    return Array.from(byUser.entries())
      .map(([key, val]) => ({ key, ...val }))
      .sort((a, b) => {
        if (a.key === unassignedKey) return 1
        if (b.key === unassignedKey) return -1
        return b.agents.length - a.agents.length
      })
  }, [agents, groupMode])

  const stats = useMemo(() => {
    const now = Date.now()
    let pending = 0
    let approved = 0
    let live = 0
    let offline = 0
    let revoked = 0
    let totalEvents = 0
    for (const a of allAgents) {
      totalEvents += a._count.events
      if (a.status === 'PENDING') pending++
      if (a.status === 'REVOKED') revoked++
      if (a.status === 'APPROVED') {
        approved++
        const diff = a.lastSeenAt ? now - new Date(a.lastSeenAt).getTime() : Infinity
        if (diff < LIVE_THRESHOLD_MS) live++
        else if (diff >= STALE_THRESHOLD_MS) offline++
      }
    }
    return { pending, approved, live, offline, revoked, totalEvents }
  }, [allAgents])

  const users = (usersData?.users ?? []).filter((u) => !u.blocked)

  const openApprove = (agent: AgentRow) => {
    const isReassign = agent.status === 'APPROVED'
    const modalId = modals.open({
      title: isReassign ? `Reassign agent · ${agent.hostname}` : `Approve agent · ${agent.hostname}`,
      size: 'md',
      children: (
        <ApproveModalBody
          agent={agent}
          users={users}
          isReassign={isReassign}
          onCancel={() => modals.close(modalId)}
          onConfirm={(userId) => {
            modals.close(modalId)
            approve.mutate({ id: agent.id, userId })
          }}
        />
      ),
    })
  }

  const openRevoke = (agent: AgentRow) => {
    modals.openConfirmModal({
      title: `Revoke agent · ${agent.hostname}`,
      size: 'md',
      children: (
        <Stack gap="sm">
          <Alert color="red" icon={<TbAlertTriangle size={16} />} variant="light">
            Agent akan segera diblokir dari webhook.
          </Alert>
          <List size="sm" spacing={4}>
            <List.Item>
              Request berikutnya ke <Code>/webhooks/aw</Code> dari agent ini ditolak dengan HTTP 403.
            </List.Item>
            <List.Item>Event yang sudah masuk ke database tetap tersimpan.</List.Item>
            <List.Item>Agent bisa di-approve ulang kapan saja — revoke bersifat reversible.</List.Item>
          </List>
          <Paper withBorder p="xs" radius="sm">
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">
                Agent ID
              </Text>
              <Code style={{ fontSize: 11 }}>{agent.agentId}</Code>
            </Group>
          </Paper>
        </Stack>
      ),
      labels: { confirm: 'Revoke agent', cancel: 'Cancel' },
      confirmProps: { color: 'red', leftSection: <TbShieldOff size={16} /> },
      onConfirm: () => revoke.mutate(agent.id),
    })
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Group gap="sm">
          <TbDeviceDesktop size={24} />
          <Stack gap={0}>
            <Title order={3}>pm-watch Agents</Title>
            <Text size="xs" c="dimmed">
              Manage ActivityWatch ingestion agents · auto-refresh every 15s
            </Text>
          </Stack>
        </Group>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={groupMode}
            onChange={(v) => setGroupMode(v as GroupMode)}
            data={[
              { value: 'flat', label: 'Flat' },
              { value: 'user', label: 'By user' },
            ]}
          />
          <Select
            size="xs"
            value={statusFilter}
            onChange={(v) => setStatusFilter((v || 'all') as Filter)}
            data={[
              { value: 'all', label: `All (${allAgents.length})` },
              { value: 'PENDING', label: `Pending (${stats.pending})` },
              { value: 'APPROVED', label: `Approved (${stats.approved})` },
              { value: 'REVOKED', label: `Revoked (${stats.revoked})` },
            ]}
            w={170}
          />
          <Tooltip label="Refresh now">
            <ActionIcon variant="light" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbShieldCheck />
            <Text size="xs" c="dimmed">
              Pending approval
            </Text>
          </Group>
          <Text fw={700} size="xl" c={stats.pending > 0 ? 'yellow' : undefined}>
            {stats.pending}
          </Text>
          <Text size="xs" c="dimmed">
            {stats.pending === 0 ? 'all caught up' : 'need review'}
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbActivity />
            <Text size="xs" c="dimmed">
              Live now
            </Text>
          </Group>
          <Text fw={700} size="xl" c={stats.live > 0 ? 'teal' : undefined}>
            {stats.live}
            <Text span size="sm" c="dimmed">
              {' '}
              / {stats.approved}
            </Text>
          </Text>
          <Text size="xs" c="dimmed">
            seen within 5 min
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbPlugConnectedX />
            <Text size="xs" c="dimmed">
              Offline
            </Text>
          </Group>
          <Text fw={700} size="xl" c={stats.offline > 0 ? 'orange' : undefined}>
            {stats.offline}
          </Text>
          <Text size="xs" c="dimmed">
            silent ≥ 1h
          </Text>
        </Card>
        <Card withBorder padding="sm">
          <Group gap="xs">
            <TbActivity />
            <Text size="xs" c="dimmed">
              Events ingested
            </Text>
          </Group>
          <Text fw={700} size="xl">
            {stats.totalEvents.toLocaleString()}
          </Text>
          <Text size="xs" c="dimmed">
            total across all agents
          </Text>
        </Card>
      </SimpleGrid>

      {stats.pending > 0 && statusFilter !== 'PENDING' && (
        <Alert color="yellow" icon={<TbShieldCheck size={18} />} withCloseButton={false}>
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">
              <strong>{stats.pending}</strong> agent{stats.pending > 1 ? 's' : ''} menunggu approval. Setiap agent perlu
              di-assign ke user yang menerima event-nya.
            </Text>
            <Button
              size="xs"
              variant="white"
              color="yellow"
              rightSection={<TbArrowRight size={14} />}
              onClick={() => setStatusFilter('PENDING')}
            >
              Review pending
            </Button>
          </Group>
        </Alert>
      )}

      {(approve.error || revoke.error) && (
        <Alert color="red" icon={<TbAlertTriangle size={16} />}>
          {approve.error?.message || revoke.error?.message}
        </Alert>
      )}

      {isLoading ? (
        <LoadingBlock message="Memuat daftar agent…" />
      ) : agents.length === 0 ? (
        statusFilter === 'all' ? (
          <EmptyState
            icon={TbDeviceDesktop}
            color="blue"
            title="Belum ada agent terdaftar"
            message={
              <>
                Install <Code>pmw</Code> di Mac, jalankan <Code>pmw init</Code>, lalu agent akan muncul di sini sebagai
                PENDING untuk kamu approve.
              </>
            }
          />
        ) : (
          <EmptyState
            icon={TbDeviceDesktop}
            title="Tidak ada agent"
            message={`Tidak ada agent berstatus ${statusFilter.toLowerCase()} saat ini.`}
          />
        )
      ) : groupMode === 'user' ? (
        <Stack gap="md">
          {groups.map((g) => (
            <Card key={g.key} withBorder padding={0} radius="md">
              <Group justify="space-between" p="sm" wrap="nowrap">
                <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                  <Avatar color={g.user ? 'blue' : 'gray'} radius="xl" size="sm">
                    {g.user ? g.user.name.charAt(0).toUpperCase() : '?'}
                  </Avatar>
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {g.user ? g.user.name : 'Unassigned'}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {g.user ? g.user.email : 'Not yet claimed by any user'}
                    </Text>
                  </Stack>
                </Group>
                <Group gap="xs" wrap="nowrap">
                  <Badge size="sm" variant="light" color="blue">
                    {g.agents.length} {g.agents.length === 1 ? 'device' : 'devices'}
                  </Badge>
                  {g.live > 0 && (
                    <Badge size="sm" variant="light" color="teal">
                      {g.live} live
                    </Badge>
                  )}
                  <Badge size="sm" variant="default">
                    {g.events.toLocaleString()} events
                  </Badge>
                </Group>
              </Group>
              <Divider />
              <Table striped highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ width: 140 }}>Status</Table.Th>
                    <Table.Th>Host</Table.Th>
                    <Table.Th style={{ width: 220 }}>Agent ID</Table.Th>
                    <Table.Th style={{ width: 90 }}>Events</Table.Th>
                    <Table.Th style={{ width: 150 }}>Last seen</Table.Th>
                    <Table.Th style={{ width: 180 }}></Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {g.agents.map((a) => (
                    <AgentRowTr
                      key={a.id}
                      agent={a}
                      showAssignee={false}
                      onApprove={openApprove}
                      onRevoke={openRevoke}
                    />
                  ))}
                </Table.Tbody>
              </Table>
            </Card>
          ))}
        </Stack>
      ) : (
        <Card withBorder padding={0} radius="md">
          <Table striped highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ width: 140 }}>Status</Table.Th>
                <Table.Th>Host</Table.Th>
                <Table.Th style={{ width: 220 }}>Agent ID</Table.Th>
                <Table.Th style={{ width: 200 }}>Assigned to</Table.Th>
                <Table.Th style={{ width: 90 }}>Events</Table.Th>
                <Table.Th style={{ width: 150 }}>Last seen</Table.Th>
                <Table.Th style={{ width: 180 }}></Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {pagedAgents.map((a) => (
                <AgentRowTr key={a.id} agent={a} showAssignee onApprove={openApprove} onRevoke={openRevoke} />
              ))}
            </Table.Tbody>
          </Table>
          {agents.length > PAGE_SIZE && (
            <Group justify="space-between" p="md">
              <Text size="xs" c="dimmed">
                {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, agents.length)} dari {agents.length}
              </Text>
              <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
            </Group>
          )}
        </Card>
      )}
    </Stack>
  )
}

function AgentRowTr({
  agent: a,
  showAssignee,
  onApprove,
  onRevoke,
}: {
  agent: AgentRow
  showAssignee: boolean
  onApprove: (a: AgentRow) => void
  onRevoke: (a: AgentRow) => void
}) {
  const live = getLiveness(a.status, a.lastSeenAt)
  return (
    <Table.Tr>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <Indicator inline processing={live.processing} color={live.color} size={8} position="middle-center">
            <span style={{ display: 'inline-block', width: 0 }} />
          </Indicator>
          <Badge size="sm" color={STATUS_COLOR[a.status]} variant="light">
            {a.status}
          </Badge>
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm" fw={500}>
          {a.hostname}
        </Text>
        <Text size="xs" c="dimmed">
          {a.osUser}
        </Text>
      </Table.Td>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          <Tooltip label={a.agentId} withArrow>
            <Code style={{ fontSize: 11, cursor: 'help' }}>{a.agentId.slice(0, 14)}…</Code>
          </Tooltip>
          <CopyButton value={a.agentId}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Copied!' : 'Copy full ID'}>
                <ActionIcon size="xs" variant="subtle" onClick={copy} color={copied ? 'teal' : 'gray'}>
                  {copied ? <TbCheck size={12} /> : <TbCopy size={12} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Group>
      </Table.Td>
      {showAssignee ? (
        <Table.Td>
          {a.claimedBy ? (
            <Stack gap={0}>
              <Text size="xs" fw={500}>
                {a.claimedBy.name}
              </Text>
              <Text size="xs" c="dimmed">
                {a.claimedBy.email}
              </Text>
            </Stack>
          ) : (
            <Text size="xs" c="dimmed" fs="italic">
              unassigned
            </Text>
          )}
        </Table.Td>
      ) : null}
      <Table.Td>
        <Badge size="sm" variant="default">
          {a._count.events.toLocaleString()}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Stack gap={0}>
          <Text size="xs">{formatRelative(a.lastSeenAt)}</Text>
          <Text size="xs" c={live.color} fw={500}>
            {live.label}
          </Text>
        </Stack>
      </Table.Td>
      <Table.Td>
        <Group gap={4} justify="flex-end" wrap="nowrap">
          {a.status === 'PENDING' && (
            <Button size="xs" color="green" leftSection={<TbShieldCheck size={14} />} onClick={() => onApprove(a)}>
              Approve
            </Button>
          )}
          <Menu position="bottom-end" shadow="md">
            <Menu.Target>
              <ActionIcon variant="subtle" size="sm" aria-label="Agent actions">
                <TbDots size={16} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {a.status === 'APPROVED' && (
                <Menu.Item leftSection={<TbUserCheck size={14} />} onClick={() => onApprove(a)}>
                  Reassign user
                </Menu.Item>
              )}
              {a.status === 'REVOKED' && (
                <Menu.Item leftSection={<TbShieldCheck size={14} />} color="green" onClick={() => onApprove(a)}>
                  Re-approve
                </Menu.Item>
              )}
              <CopyButton value={a.agentId}>
                {({ copied, copy }) => (
                  <Menu.Item leftSection={copied ? <TbCheck size={14} /> : <TbCopy size={14} />} onClick={copy}>
                    {copied ? 'Copied!' : 'Copy agent ID'}
                  </Menu.Item>
                )}
              </CopyButton>
              {a.status !== 'REVOKED' && (
                <>
                  <Menu.Divider />
                  <Menu.Item leftSection={<TbShieldOff size={14} />} color="red" onClick={() => onRevoke(a)}>
                    Revoke
                  </Menu.Item>
                </>
              )}
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Table.Td>
    </Table.Tr>
  )
}

interface ApproveModalBodyProps {
  agent: AgentRow
  users: AgentUser[]
  isReassign: boolean
  onCancel: () => void
  onConfirm: (userId: string) => void
}

function ApproveModalBody({ agent, users, isReassign, onCancel, onConfirm }: ApproveModalBodyProps) {
  const [selectedUserId, setSelectedUserId] = useState<string | null>(agent.claimedBy?.id ?? null)
  const currentAssignee = agent.claimedBy

  return (
    <Stack gap="md">
      <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-body)">
        <Stack gap={4}>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" w={72}>
              Host
            </Text>
            <Text size="sm" fw={500}>
              {agent.hostname}
            </Text>
            <Text size="xs" c="dimmed">
              ({agent.osUser})
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" w={72}>
              Agent ID
            </Text>
            <Code style={{ fontSize: 11 }}>{agent.agentId}</Code>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Text size="xs" c="dimmed" w={72}>
              Events
            </Text>
            <Text size="sm">{agent._count.events.toLocaleString()}</Text>
          </Group>
          {currentAssignee && (
            <Group gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed" w={72}>
                Current
              </Text>
              <Text size="sm">
                {currentAssignee.name}{' '}
                <Text span size="xs" c="dimmed">
                  ({currentAssignee.email})
                </Text>
              </Text>
            </Group>
          )}
        </Stack>
      </Paper>

      <Text size="sm" c="dimmed">
        {isReassign
          ? 'Event berikutnya akan di-attribute ke user yang dipilih. Event lama tetap tercatat di user sebelumnya.'
          : 'Setelah approve, event webhook dari agent ini akan di-attribute ke user yang kamu pilih.'}
      </Text>

      <Select
        label="Assign to user"
        placeholder="Cari nama atau email…"
        searchable
        nothingFoundMessage="User tidak ditemukan"
        value={selectedUserId}
        onChange={setSelectedUserId}
        data={users.map((u) => ({ value: u.id, label: `${u.name} · ${u.email} (${u.role})` }))}
      />

      <Group justify="flex-end" gap="xs">
        <Button variant="subtle" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          color={isReassign ? 'blue' : 'green'}
          leftSection={isReassign ? <TbUserCheck size={16} /> : <TbShieldCheck size={16} />}
          disabled={!selectedUserId}
          onClick={() => {
            if (!selectedUserId) return
            onConfirm(selectedUserId)
          }}
        >
          {isReassign ? 'Reassign' : 'Approve & activate'}
        </Button>
      </Group>
    </Stack>
  )
}
