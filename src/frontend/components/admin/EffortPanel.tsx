import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Group,
  Pagination,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { TbAlertTriangle, TbChartBar, TbClock, TbRefresh, TbUserExclamation } from 'react-icons/tb'
import { InfoTip } from '@/frontend/components/shared/InfoTip'

const VIEW_TIPS: Record<View, string> = {
  variance:
    'Variance = perbandingan estimasi jam vs actual jam (dihitung dari durasi ActivityWatch window events saat task aktif). Positif = over budget, negatif = under.',
  ghost:
    'Ghost tasks = task IN_PROGRESS yang tidak berubah ≥3 hari. Sinyal tugas stuck, forgotten, atau abandoned oleh assignee.',
  phantom:
    'Phantom work = jam aktivitas pm-watch yang tidak tercakup oleh window task manapun. Indikasi scope creep atau pekerjaan yang tidak punya ticket.',
}

const PAGE_SIZE = 25

type View = 'variance' | 'ghost' | 'phantom'

interface EffortRow {
  taskId: string
  title: string
  status: string
  priority: string
  projectId: string
  projectName: string
  assigneeEmail: string | null
  estimateHours: number | null
  actualHours: number
  variancePercent: number | null
  verdict: 'under' | 'on' | 'over' | 'missing-estimate' | 'no-assignee' | 'no-activity'
  startsAt: string | null
  closedAt: string | null
}

interface GhostRow {
  taskId: string
  title: string
  status: string
  priority: string
  projectName: string
  assigneeEmail: string | null
  daysStale: number
  assigneeOnlineLast24h: boolean
  actualHoursLast7d: number
}

interface PhantomRow {
  userId: string
  email: string
  totalHours: number
  trackedHours: number
  phantomHours: number
  phantomPercent: number | null
  openTaskCount: number
}

const verdictColor = {
  under: 'teal',
  on: 'blue',
  over: 'red',
  'missing-estimate': 'gray',
  'no-assignee': 'gray',
  'no-activity': 'yellow',
} as const

const priorityColor = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
} as const

export function EffortPanel() {
  const [view, setView] = useState<View>('variance')

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <div>
          <Group gap="xs">
            <Title order={3}>Effort Tracking</Title>
            <InfoTip
              width={360}
              label="Sumber data: ActivityWatch window-bucket events dari agent pm-watch, dikorelasikan dengan window aktif tiap task (startsAt → closedAt). Menjawab: estimasi akurat tidak, ada task stuck, ada jam yang tidak tercatat di task."
            />
          </Group>
          <Text size="sm" c="dimmed">
            Evidence-based from pm-watch activity events. Estimate vs actual, stalled tasks, untracked work.
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as View)}
            data={[
              { label: 'Variance', value: 'variance' },
              { label: 'Ghost tasks', value: 'ghost' },
              { label: 'Phantom work', value: 'phantom' },
            ]}
          />
          <InfoTip width={340} label={VIEW_TIPS[view]} />
        </Group>
      </Group>

      {view === 'variance' && <VarianceView />}
      {view === 'ghost' && <GhostView />}
      {view === 'phantom' && <PhantomView />}
    </Stack>
  )
}

function VarianceView() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'effort', 'variance'],
    queryFn: () =>
      fetch('/api/admin/effort?limit=200', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ count: number; rows: EffortRow[] }>,
      ),
    refetchInterval: 60_000,
  })
  const rows = data?.rows ?? []
  const counts = {
    over: rows.filter((r) => r.verdict === 'over').length,
    under: rows.filter((r) => r.verdict === 'under').length,
    onTrack: rows.filter((r) => r.verdict === 'on').length,
    noEstimate: rows.filter((r) => r.verdict === 'missing-estimate').length,
    noActivity: rows.filter((r) => r.verdict === 'no-activity').length,
  }
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
        <StatCard
          icon={<TbAlertTriangle />}
          label="Over budget"
          value={counts.over}
          color="red"
          tip="Actual > estimate ≥25%. Task menghabiskan jam lebih banyak dari yang direncanakan — review kompleksitas atau scope creep."
        />
        <StatCard
          icon={<TbClock />}
          label="Under budget"
          value={counts.under}
          color="teal"
          tip="Actual < estimate ≥25%. Task selesai lebih cepat dari estimasi — tim efisien, atau estimasi terlalu konservatif."
        />
        <StatCard
          icon={<TbChartBar />}
          label="On track"
          value={counts.onTrack}
          color="blue"
          tip="Selisih actual vs estimate berada dalam ±25%. Estimasi akurat."
        />
        <StatCard
          icon={<TbClock />}
          label="Missing estimate"
          value={counts.noEstimate}
          color="gray"
          tip="Task tidak punya estimateHours, jadi variance tidak bisa dihitung. Minta PM isi estimasi saat task dibuat."
        />
        <StatCard
          icon={<TbClock />}
          label="No activity"
          value={counts.noActivity}
          color="yellow"
          tip="Task tidak punya event ActivityWatch di window-nya. Tidak ada bukti pekerjaan — mungkin belum dimulai, tidak di-track, atau assignee belum pakai pm-watch."
        />
      </SimpleGrid>

      <Card withBorder padding={0} radius="md">
        <Group p="md" justify="space-between">
          <Group gap="xs">
            <Title order={5}>Tasks</Title>
            <InfoTip
              width={340}
              label="Semua task (OPEN/IN_PROGRESS/READY_FOR_QC/CLOSED) dengan data variance. Kolom Actual adalah jam ActivityWatch yang jatuh di window startsAt → closedAt (atau sekarang jika belum closed)."
            />
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Table highlightOnHover verticalSpacing="xs" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Task</Table.Th>
              <Table.Th>Project</Table.Th>
              <Table.Th>Assignee</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th>
                <Tooltip label="Estimasi jam dari field estimateHours. Diisi saat task dibuat.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Estimate</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Jumlah jam ActivityWatch window events assignee yang jatuh di window task aktif.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Actual</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="(Actual − Estimate) / Estimate × 100. Positif = over budget, negatif = under. Rentang ±25% = on track.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Variance</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Kategori: over / under / on / missing-estimate (tidak ada estimateHours) / no-activity (tidak ada event pm-watch) / no-assignee.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Verdict</span>
                </Tooltip>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={8}>
                  <Text c="dimmed" size="sm" ta="center" py="md">
                    Loading…
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={8}>
                  <Text c="dimmed" size="sm" ta="center" py="md">
                    No tasks yet.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pagedRows.map((r) => (
                <Table.Tr key={r.taskId}>
                  <Table.Td>
                    <Text size="sm" fw={500} lineClamp={1}>
                      {r.title}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {r.status}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{r.projectName}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={r.assigneeEmail ? undefined : 'dimmed'}>
                      {r.assigneeEmail ?? '(unassigned)'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" color={priorityColor[r.priority as keyof typeof priorityColor]} variant="light">
                      {r.priority}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {r.estimateHours !== null ? `${r.estimateHours}h` : '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {r.actualHours}h
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={
                        r.variancePercent === null
                          ? 'dimmed'
                          : r.variancePercent > 25
                            ? 'red'
                            : r.variancePercent < -25
                              ? 'teal'
                              : undefined
                      }
                    >
                      {r.variancePercent === null ? '—' : `${r.variancePercent > 0 ? '+' : ''}${r.variancePercent}%`}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="light" color={verdictColor[r.verdict]}>
                      {r.verdict}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        {rows.length > PAGE_SIZE && (
          <Group justify="space-between" p="md">
            <Text size="xs" c="dimmed">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} dari {rows.length}
            </Text>
            <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
          </Group>
        )}
      </Card>
    </Stack>
  )
}

function GhostView() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'effort', 'ghost'],
    queryFn: () =>
      fetch('/api/admin/effort/ghost?staleDays=3&limit=100', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ count: number; staleDays: number; rows: GhostRow[] }>,
      ),
    refetchInterval: 60_000,
  })
  const rows = data?.rows ?? []
  const abandoned = rows.filter((r) => !r.assigneeOnlineLast24h).length
  const stalled = rows.filter((r) => r.assigneeOnlineLast24h).length
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Stack gap="md">
      {rows.length > 0 && (
        <Alert color="orange" icon={<TbAlertTriangle />}>
          <Text fw={600} size="sm">
            {rows.length} task{rows.length === 1 ? '' : 's'} haven&apos;t moved in {data?.staleDays ?? 3}+ days.
          </Text>
          <Text size="xs" c="dimmed">
            {stalled} with active assignees (stalled), {abandoned} with offline assignees (abandoned).
          </Text>
        </Alert>
      )}
      <Card withBorder padding={0} radius="md">
        <Group p="md" justify="space-between">
          <Group gap="xs">
            <Title order={5}>Ghost tasks</Title>
            <InfoTip
              width={340}
              label="Task status IN_PROGRESS dengan updatedAt ≥3 hari lalu. Diperiksa apakah assignee masih aktif (agent pm-watch online 24j terakhir) untuk bedakan stalled (aktif tapi stuck) vs abandoned (tidak aktif)."
            />
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Table highlightOnHover verticalSpacing="xs" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Task</Table.Th>
              <Table.Th>Project</Table.Th>
              <Table.Th>Assignee</Table.Th>
              <Table.Th>
                <Tooltip label="Berapa hari sejak task terakhir diupdate (updatedAt).">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Stale</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Jam ActivityWatch events dari agent assignee pada task ini dalam 7 hari terakhir. 0 = benar-benar tidak disentuh.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Hours 7d</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Stalled: assignee online tapi task stuck. Abandoned: assignee offline >24 jam, kemungkinan diabaikan.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Signal</span>
                </Tooltip>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" size="sm" ta="center" py="md">
                    Loading…
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" size="sm" ta="center" py="md">
                    No ghost tasks. Nice.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pagedRows.map((r) => (
                <Table.Tr key={r.taskId}>
                  <Table.Td>
                    <Text size="sm" fw={500} lineClamp={1}>
                      {r.title}
                    </Text>
                    <Badge size="xs" color={priorityColor[r.priority as keyof typeof priorityColor]} variant="light">
                      {r.priority}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{r.projectName}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={r.assigneeEmail ? undefined : 'dimmed'}>
                      {r.assigneeEmail ?? '(unassigned)'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="orange">
                      {r.daysStale}d
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {r.actualHoursLast7d}h
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {r.assigneeOnlineLast24h ? (
                      <Badge size="xs" color="orange" variant="light">
                        stalled (user active)
                      </Badge>
                    ) : (
                      <Badge size="xs" color="red" variant="light">
                        abandoned (user offline)
                      </Badge>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        {rows.length > PAGE_SIZE && (
          <Group justify="space-between" p="md">
            <Text size="xs" c="dimmed">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} dari {rows.length}
            </Text>
            <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
          </Group>
        )}
      </Card>
    </Stack>
  )
}

function PhantomView() {
  const [page, setPage] = useState(1)
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'effort', 'phantom'],
    queryFn: () =>
      fetch('/api/admin/effort/phantom?days=7&limit=50', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ count: number; days: number; rows: PhantomRow[] }>,
      ),
    refetchInterval: 60_000,
  })
  const rows = data?.rows ?? []
  const highPhantom = rows.filter((r) => (r.phantomPercent ?? 0) > 50).length
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedRows = rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <Stack gap="md">
      {highPhantom > 0 && (
        <Alert color="yellow" icon={<TbUserExclamation />}>
          <Text fw={600} size="sm">
            {highPhantom} user{highPhantom === 1 ? '' : 's'} with &gt;50% untracked work in the last {data?.days ?? 7}d.
          </Text>
          <Text size="xs" c="dimmed">
            Work is being done, but not captured as tasks. Consider creating tickets or reviewing scope.
          </Text>
        </Alert>
      )}
      <Card withBorder padding={0} radius="md">
        <Group p="md" justify="space-between">
          <Group gap="xs">
            <Title order={5}>Untracked activity per user (last 7d)</Title>
            <InfoTip
              width={340}
              label="Per user: Total = seluruh jam ActivityWatch 7 hari; Tracked = jam yang masuk window task aktif/recent-closed; Phantom = sisanya (Total − Tracked). >50% phantom = banyak kerja tanpa ticket."
            />
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Table highlightOnHover verticalSpacing="xs" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>User</Table.Th>
              <Table.Th>
                <Tooltip label="Seluruh jam ActivityWatch window-events dari agent user dalam 7 hari terakhir.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Total</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Jam yang jatuh di window salah satu task user (IN_PROGRESS atau baru closed).">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Tracked</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Total − Tracked. Jam kerja yang tidak punya task terkait.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Phantom</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>
                <Tooltip label="Phantom / Total × 100. >50% = peringatan, banyak pekerjaan tidak tercatat.">
                  <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>% Phantom</span>
                </Tooltip>
              </Table.Th>
              <Table.Th>Open tasks</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" size="sm" ta="center" py="md">
                    Loading…
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : rows.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={6}>
                  <Text c="dimmed" size="sm" ta="center" py="md">
                    No activity tracked in the last 7 days.
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              pagedRows.map((r) => (
                <Table.Tr key={r.userId}>
                  <Table.Td>
                    <Text size="xs">{r.email}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {r.totalHours}h
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="teal">
                      {r.trackedHours}h
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace" c="orange">
                      {r.phantomHours}h
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text
                      size="xs"
                      ff="monospace"
                      c={
                        r.phantomPercent === null
                          ? 'dimmed'
                          : r.phantomPercent > 50
                            ? 'red'
                            : r.phantomPercent > 25
                              ? 'orange'
                              : 'teal'
                      }
                    >
                      {r.phantomPercent === null ? '—' : `${r.phantomPercent}%`}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {r.openTaskCount}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
        {rows.length > PAGE_SIZE && (
          <Group justify="space-between" p="md">
            <Text size="xs" c="dimmed">
              {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, rows.length)} dari {rows.length}
            </Text>
            <Pagination value={safePage} onChange={setPage} total={totalPages} size="sm" />
          </Group>
        )}
      </Card>
    </Stack>
  )
}

function StatCard({
  icon,
  label,
  value,
  color,
  tip,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
  tip?: string
}) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon variant="light" color={color} size="md">
          {icon}
        </ThemeIcon>
        <div style={{ flex: 1 }}>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
              {label}
            </Text>
            {tip && <InfoTip label={tip} size={12} />}
          </Group>
          <Text fw={700} size="lg">
            {value}
          </Text>
        </div>
      </Group>
    </Card>
  )
}
