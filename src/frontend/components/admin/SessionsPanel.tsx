import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Pagination,
  SegmentedControl,
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
import { useEffect, useMemo, useState } from 'react'
import { TbActivity, TbClock, TbDevices, TbRefresh, TbSearch, type TbUsers, TbWifi } from 'react-icons/tb'
import { EmptyRow } from '@/frontend/components/shared/EmptyState'
import { InfoTip } from '@/frontend/components/shared/InfoTip'

const PAGE_SIZE = 25

interface SessionRow {
  id: string
  userId: string
  userName: string
  userEmail: string
  userRole: string
  userBlocked: boolean
  isOnline: boolean
  createdAt: string
  expiresAt: string
  isExpired: boolean
}

interface SessionsResponse {
  sessions: SessionRow[]
  summary: {
    totalSessions: number
    activeSessions: number
    expiredSessions: number
    onlineUsers: number
    byRole: Record<string, number>
  }
}

type StatusFilter = 'all' | 'active' | 'online' | 'expired'

const ROLE_COLOR: Record<string, string> = {
  USER: 'blue',
  QC: 'teal',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
}

function formatRelative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.floor(abs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const suffix = diff < 0 ? 'ago' : 'from now'
  if (days > 0) return `${days}d ${suffix}`
  if (hours > 0) return `${hours}h ${suffix}`
  if (mins > 0) return `${mins}m ${suffix}`
  return `just now`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SessionsPanel() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'sessions'],
    queryFn: () =>
      fetch('/api/admin/sessions', { credentials: 'include' }).then((r) => r.json()) as Promise<SessionsResponse>,
    refetchInterval: 15_000,
  })

  const sessions = data?.sessions ?? []
  const summary = data?.summary

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sessions.filter((s) => {
      if (statusFilter === 'active' && s.isExpired) return false
      if (statusFilter === 'online' && !s.isOnline) return false
      if (statusFilter === 'expired' && !s.isExpired) return false
      if (roleFilter && s.userRole !== roleFilter) return false
      if (q) {
        const hay = `${s.userName} ${s.userEmail}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [sessions, statusFilter, roleFilter, search])

  const roleOptions = useMemo(() => {
    const set = new Set<string>()
    for (const s of sessions) set.add(s.userRole)
    return Array.from(set).sort()
  }, [sessions])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedFiltered = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset page when filters change
  useEffect(() => {
    setPage(1)
  }, [search, statusFilter, roleFilter])

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Title order={3}>Active Sessions</Title>
            <InfoTip
              width={360}
              label="Login session dari tabel Session. Satu user bisa punya banyak session (mis. browser + hape). Session auto-expired sesuai expiresAt; user harus login ulang. Polling 15 detik."
            />
          </Group>
          <Text size="sm" c="dimmed">
            Login sessions aktif lintas user. Auto-refresh 15 detik.
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
          label="Total Sessions"
          value={summary?.totalSessions ?? 0}
          icon={TbDevices}
          color="blue"
          tip="Jumlah seluruh row Session di DB (active + expired yang belum di-cleanup)."
        />
        <StatCard
          label="Active"
          value={summary?.activeSessions ?? 0}
          icon={TbActivity}
          color="teal"
          tip="Session dengan expiresAt > sekarang. User masih logged-in — bisa refresh page tanpa login ulang."
        />
        <StatCard
          label="Online Users"
          value={summary?.onlineUsers ?? 0}
          icon={TbWifi}
          color="green"
          tip="User unik yang sedang terhubung via WebSocket /ws/presence. Real-time indicator — lagi aktif buka app."
        />
        <StatCard
          label="Expired"
          value={summary?.expiredSessions ?? 0}
          icon={TbClock}
          color="gray"
          tip="Session dengan expiresAt ≤ sekarang. User perlu login ulang. Row akan dihapus otomatis saat user coba pakai sessionnya."
        />
      </SimpleGrid>

      <Card withBorder padding="sm" radius="md">
        <Group gap="sm" wrap="wrap">
          <TextInput
            placeholder="Cari nama atau email"
            leftSection={<TbSearch size={12} />}
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            size="xs"
            w={260}
          />
          <Tooltip
            multiline
            w={300}
            withArrow
            label="Active = belum expired. Online = terkoneksi WebSocket (subset Active). Expired = sudah lewat expiresAt."
          >
            <SegmentedControl
              size="xs"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              data={[
                { label: 'All', value: 'all' },
                { label: 'Active', value: 'active' },
                { label: 'Online', value: 'online' },
                { label: 'Expired', value: 'expired' },
              ]}
            />
          </Tooltip>
          <Group gap="xs">
            <Text size="xs" c="dimmed">
              Role:
            </Text>
            <Badge
              variant={roleFilter === null ? 'filled' : 'light'}
              color="gray"
              size="sm"
              style={{ cursor: 'pointer' }}
              onClick={() => setRoleFilter(null)}
            >
              All
            </Badge>
            {roleOptions.map((r) => (
              <Badge
                key={r}
                variant={roleFilter === r ? 'filled' : 'light'}
                color={ROLE_COLOR[r] ?? 'gray'}
                size="sm"
                style={{ cursor: 'pointer' }}
                onClick={() => setRoleFilter(roleFilter === r ? null : r)}
              >
                {r} ({summary?.byRole[r] ?? 0})
              </Badge>
            ))}
          </Group>
          <Badge variant="light" size="sm" ml="auto">
            {filtered.length} of {sessions.length}
          </Badge>
        </Group>
      </Card>

      <Card withBorder padding={0} radius="md">
        <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>User</Table.Th>
              <Table.Th>Role</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Started</Table.Th>
              <Table.Th>Expires</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <EmptyRow icon={TbDevices} title="Memuat session…" />
                </Table.Td>
              </Table.Tr>
            )}
            {!isLoading && filtered.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <EmptyRow
                    icon={TbSearch}
                    title="Tidak ada session yang cocok"
                    message="Coba ubah filter atau reset pencarian."
                  />
                </Table.Td>
              </Table.Tr>
            )}
            {pagedFiltered.map((s) => (
              <Table.Tr key={s.id} opacity={s.isExpired ? 0.5 : 1}>
                <Table.Td>
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {s.userName}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {s.userEmail}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Badge color={ROLE_COLOR[s.userRole] ?? 'gray'} variant="light" size="sm">
                    {s.userRole}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={6} wrap="nowrap">
                    {s.userBlocked && (
                      <Badge color="red" variant="filled" size="xs">
                        Blocked
                      </Badge>
                    )}
                    {s.isExpired ? (
                      <Badge color="gray" variant="light" size="xs">
                        Expired
                      </Badge>
                    ) : s.isOnline ? (
                      <Badge color="green" variant="filled" size="xs">
                        Online
                      </Badge>
                    ) : (
                      <Badge color="blue" variant="light" size="xs">
                        Active
                      </Badge>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={formatDateTime(s.createdAt)}>
                    <Text size="xs" c="dimmed">
                      {formatRelative(s.createdAt)}
                    </Text>
                  </Tooltip>
                </Table.Td>
                <Table.Td>
                  <Tooltip label={formatDateTime(s.expiresAt)}>
                    <Text size="xs" c={s.isExpired ? 'red' : 'dimmed'}>
                      {formatRelative(s.expiresAt)}
                    </Text>
                  </Tooltip>
                </Table.Td>
              </Table.Tr>
            ))}
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
  icon: typeof TbUsers
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
