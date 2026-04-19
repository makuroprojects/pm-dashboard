import {
  ActionIcon,
  Badge,
  Card,
  Group,
  Pagination,
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
import { modals } from '@mantine/modals'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EChartsOption } from 'echarts'
import { useEffect, useMemo, useState } from 'react'
import {
  TbCircleCheck,
  TbCircleX,
  TbDownload,
  TbFileText,
  TbLock,
  TbRefresh,
  TbTrash,
  TbUser,
  TbUsers,
} from 'react-icons/tb'
import { EChart } from '@/frontend/components/charts/EChart'
import { EmptyRow } from '@/frontend/components/shared/EmptyState'
import { InfoTip } from '@/frontend/components/shared/InfoTip'
import { type Role, useSession } from '@/frontend/hooks/useAuth'
import { notifyError, notifySuccess } from '@/frontend/lib/notify'

interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  blocked: boolean
  createdAt: string
}

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
  PROJECT_MEMBER_ROLE_CHANGED: { color: 'grape', label: 'Member Role Changed' },
  TASK_CREATED: { color: 'blue', label: 'Task Created' },
}

const PAGE_SIZE = 25
const WINDOW_OPTIONS = [
  { label: '24 jam', value: '1' },
  { label: '7 hari', value: '7' },
  { label: '30 hari', value: '30' },
  { label: 'Semua', value: 'all' },
]

function csvEscape(v: string | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(rows: AuditLogEntry[]) {
  const header = ['createdAt', 'userName', 'userEmail', 'action', 'detail', 'ip'].join(',')
  const body = rows
    .map((r) =>
      [r.createdAt, r.user?.name ?? '', r.user?.email ?? '', r.action, r.detail ?? '', r.ip ?? '']
        .map(csvEscape)
        .join(','),
    )
    .join('\n')
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function AuditLogsPanel() {
  const [actionFilter, setActionFilter] = useState<string | null>(null)
  const [userFilter, setUserFilter] = useState<string | null>(null)
  const [windowFilter, setWindowFilter] = useState<string>('7')
  const [page, setPage] = useState(1)
  const queryClient = useQueryClient()
  const { data: sessionData } = useSession()
  const canClear = sessionData?.user?.role === 'SUPER_ADMIN'

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () =>
      fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()) as Promise<{ users: AdminUser[] }>,
  })

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'logs', 'audit', actionFilter, userFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: '500' })
      if (actionFilter) params.set('action', actionFilter)
      if (userFilter) params.set('userId', userFilter)
      return fetch(`/api/admin/logs/audit?${params}`, { credentials: 'include' }).then((r) => r.json()) as Promise<{
        logs: AuditLogEntry[]
      }>
    },
  })

  const clearLogs = useMutation({
    mutationFn: () =>
      fetch('/api/admin/logs/audit', { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'logs', 'audit'] })
      notifySuccess({ message: 'Audit log dikosongkan.' })
    },
    onError: (err) => notifyError(err),
  })

  const allLogs = data?.logs ?? []

  const filteredLogs = useMemo(() => {
    if (windowFilter === 'all') return allLogs
    const days = Number(windowFilter)
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return allLogs.filter((l) => new Date(l.createdAt).getTime() >= cutoff)
  }, [allLogs, windowFilter])

  const stats = useMemo(() => {
    const now = Date.now()
    const cutoff24 = now - 24 * 60 * 60 * 1000
    const last24 = allLogs.filter((l) => new Date(l.createdAt).getTime() >= cutoff24)
    const loginOk = last24.filter((l) => l.action === 'LOGIN').length
    const loginFail = last24.filter((l) => l.action === 'LOGIN_FAILED').length
    const loginBlocked = last24.filter((l) => l.action === 'LOGIN_BLOCKED').length
    const uniqueUsers = new Set(last24.map((l) => l.userId).filter(Boolean)).size
    return { loginOk, loginFail, loginBlocked, uniqueUsers }
  }, [allLogs])

  const trendOption = useMemo<EChartsOption>(() => {
    const days: Array<{ key: string; label: string; ok: number; fail: number; blocked: number }> = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      days.push({ key: d.toISOString().slice(0, 10), label: d.toISOString().slice(5, 10), ok: 0, fail: 0, blocked: 0 })
    }
    const index = new Map(days.map((d, i) => [d.key, i]))
    for (const l of allLogs) {
      const d = new Date(l.createdAt)
      d.setHours(0, 0, 0, 0)
      const i = index.get(d.toISOString().slice(0, 10))
      if (i === undefined) continue
      if (l.action === 'LOGIN') days[i].ok++
      else if (l.action === 'LOGIN_FAILED') days[i].fail++
      else if (l.action === 'LOGIN_BLOCKED') days[i].blocked++
    }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Sukses', 'Gagal', 'Diblokir'], top: 0, itemWidth: 10, itemHeight: 10 },
      grid: { left: 32, right: 12, top: 28, bottom: 24 },
      xAxis: { type: 'category', data: days.map((d) => d.label), axisLabel: { fontSize: 9 } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { fontSize: 9 } },
      series: [
        {
          name: 'Sukses',
          type: 'line',
          smooth: true,
          data: days.map((d) => d.ok),
          itemStyle: { color: '#40c057' },
          areaStyle: { opacity: 0.1 },
        },
        {
          name: 'Gagal',
          type: 'line',
          smooth: true,
          data: days.map((d) => d.fail),
          itemStyle: { color: '#fd7e14' },
          areaStyle: { opacity: 0.1 },
        },
        {
          name: 'Diblokir',
          type: 'line',
          smooth: true,
          data: days.map((d) => d.blocked),
          itemStyle: { color: '#fa5252' },
          areaStyle: { opacity: 0.1 },
        },
      ],
    }
  }, [allLogs])

  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedLogs = filteredLogs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  useEffect(() => {
    setPage(1)
  }, [])

  const userOptions = (usersData?.users ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.email})` }))
  const actionOptions = Object.entries(actionBadge).map(([key, val]) => ({ value: key, label: val.label }))

  const confirmClear = () =>
    modals.openConfirmModal({
      title: 'Clear audit logs',
      children: <Text size="sm">Hapus semua audit logs? Tindakan ini tidak bisa dibatalkan.</Text>,
      labels: { confirm: 'Clear all', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => clearLogs.mutate(),
    })

  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap">
        <Group gap="sm">
          <Title order={3}>Audit Logs</Title>
          <Badge variant="light" color="gray" size="sm">
            jejak aktivitas
          </Badge>
          <InfoTip
            width={360}
            label={`Jejak aktivitas user yang persisted di DB: LOGIN / LOGOUT / LOGIN_FAILED / LOGIN_BLOCKED / ROLE_CHANGED / BLOCKED / UNBLOCKED / TASK_CREATED / perubahan role member proyek. Retensi default ${90} hari (AUDIT_LOG_RETENTION_DAYS).`}
          />
        </Group>
        <Group gap="sm">
          <Tooltip label="Ekspor CSV">
            <ActionIcon variant="subtle" color="blue" onClick={() => downloadCsv(filteredLogs)}>
              <TbDownload size={16} />
            </ActionIcon>
          </Tooltip>
          {canClear && (
            <Tooltip label="Kosongkan semua">
              <ActionIcon variant="subtle" color="red" onClick={confirmClear} loading={clearLogs.isPending}>
                <TbTrash size={16} />
              </ActionIcon>
            </Tooltip>
          )}
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" color="gray" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
        <StatCard
          label="Login Sukses · 24j"
          value={stats.loginOk.toString()}
          icon={TbCircleCheck}
          color="green"
          tip="Jumlah login sukses (action LOGIN) dalam 24 jam terakhir. Baseline aktivitas harian."
        />
        <StatCard
          label="Login Gagal · 24j"
          value={stats.loginFail.toString()}
          icon={TbCircleX}
          color="orange"
          tip="Jumlah login gagal (password salah atau email tidak ditemukan) dalam 24 jam. Lonjakan = indikasi brute-force."
        />
        <StatCard
          label="Diblokir · 24j"
          value={stats.loginBlocked.toString()}
          icon={TbLock}
          color="red"
          tip="Jumlah percobaan login dari akun yang sudah di-block. Jika tinggi, user mungkin masih butuh akses — pertimbangkan unblock."
        />
        <StatCard
          label="User Unik · 24j"
          value={stats.uniqueUsers.toString()}
          icon={TbUsers}
          color="blue"
          tip="Jumlah user distinct yang muncul di audit log 24 jam terakhir (semua action). Proxy untuk active users per hari."
        />
      </SimpleGrid>

      <Card withBorder padding="md" radius="md">
        <Group gap={4} mb="xs">
          <Stack gap={4} style={{ flex: 1 }}>
            <Text fw={600} size="sm">
              Tren Login 14 Hari
            </Text>
            <Text size="xs" c="dimmed">
              Sukses vs gagal vs diblokir per hari
            </Text>
          </Stack>
          <InfoTip
            width={340}
            label="Grafik 14 hari terakhir: hijau = login sukses, oranye = gagal (credential salah), merah = diblokir. Pola oranye + merah meningkat tajam = kemungkinan serangan bruteforce."
          />
        </Group>
        <EChart option={trendOption} height={180} />
      </Card>

      <Group gap="sm" wrap="wrap">
        <Tooltip label="Filter rentang waktu data yang ditampilkan di tabel di bawah. Stat cards & tren chart tetap pakai window 24j / 14 hari.">
          <SegmentedControl
            size="xs"
            value={windowFilter}
            onChange={(v) => {
              setWindowFilter(v)
              setPage(1)
            }}
            data={WINDOW_OPTIONS}
          />
        </Tooltip>
        <Select
          placeholder="Filter user"
          data={userOptions}
          value={userFilter}
          onChange={(v) => {
            setUserFilter(v)
            setPage(1)
          }}
          clearable
          searchable
          size="xs"
          w={250}
          leftSection={<TbUser size={14} />}
        />
        <Select
          placeholder="Filter action"
          data={actionOptions}
          value={actionFilter}
          onChange={(v) => {
            setActionFilter(v)
            setPage(1)
          }}
          clearable
          size="xs"
          w={220}
          leftSection={<TbFileText size={14} />}
        />
        <Text size="xs" c="dimmed" ml="auto">
          {filteredLogs.length} entri
        </Text>
      </Group>

      <Card withBorder radius="md" p={0}>
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={180}>Waktu</Table.Th>
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
                  <EmptyRow icon={TbFileText} title="Memuat audit log…" />
                </Table.Td>
              </Table.Tr>
            )}
            {filteredLogs.length === 0 && !isLoading && (
              <Table.Tr>
                <Table.Td colSpan={5}>
                  <EmptyRow
                    icon={TbFileText}
                    title="Belum ada audit log"
                    message={
                      actionFilter || userFilter || windowFilter !== 'all'
                        ? 'Tidak ada log yang cocok dengan filter. Perluas window atau reset filter.'
                        : 'Audit log akan muncul saat ada aktivitas login, role change, atau block/unblock.'
                    }
                  />
                </Table.Td>
              </Table.Tr>
            )}
            {pagedLogs.map((log) => {
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
                        <Text size="sm" fw={500}>
                          {log.user.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {log.user.email}
                        </Text>
                      </div>
                    ) : (
                      <Text size="sm" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Badge color={badge.color} variant="light" size="sm">
                      {badge.label}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed" ff="monospace">
                      {log.detail ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="dimmed">
                      {log.ip ?? '—'}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Card>

      {filteredLogs.length > PAGE_SIZE && (
        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filteredLogs.length)} dari{' '}
            {filteredLogs.length}
          </Text>
          <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
        </Group>
      )}
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
  value: string
  icon: typeof TbUser
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
