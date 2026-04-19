import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Group,
  Indicator,
  List,
  Modal,
  Paper,
  Progress,
  Stack,
  Stepper,
  Text,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import {
  TbAlertTriangle,
  TbCheck,
  TbClock,
  TbCopy,
  TbDeviceDesktop,
  TbDownload,
  TbKey,
  TbPlayerPlay,
  TbPlus,
  TbRefresh,
  TbSparkles,
} from 'react-icons/tb'

interface MyAgent {
  id: string
  agentId: string
  hostname: string
  osUser: string
  status: 'PENDING' | 'APPROVED' | 'REVOKED'
  lastSeenAt: string | null
  createdAt: string
  _count: { events: number }
}

interface TodayStats {
  totalSeconds: number
  perAgent: { agentId: string; seconds: number }[]
}

const LIVE_THRESHOLD_MS = 5 * 60 * 1000
const STALE_THRESHOLD_MS = 60 * 60 * 1000

function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}d`
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}j` : `${h}j ${rem}m`
}

function liveness(lastSeenAt: string | null): { color: string; label: string; processing: boolean } {
  if (!lastSeenAt) return { color: 'gray', label: 'belum pernah terlihat', processing: false }
  const diff = Date.now() - new Date(lastSeenAt).getTime()
  if (diff < LIVE_THRESHOLD_MS) return { color: 'teal', label: 'live', processing: true }
  if (diff < STALE_THRESHOLD_MS) return { color: 'green', label: formatRelative(lastSeenAt), processing: false }
  return { color: 'gray', label: `offline · ${formatRelative(lastSeenAt)}`, processing: false }
}

export function MyDevicesPanel() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ['me', 'agents'],
    queryFn: () =>
      fetch('/api/me/agents', { credentials: 'include' }).then((r) => r.json() as Promise<{ agents: MyAgent[] }>),
    refetchInterval: 30_000,
  })

  const { data: today } = useQuery({
    queryKey: ['me', 'agents', 'today'],
    queryFn: () =>
      fetch('/api/me/agents/today', { credentials: 'include' }).then((r) => r.json() as Promise<TodayStats>),
    refetchInterval: 60_000,
  })

  const [wizardOpened, { open: openWizard, close: closeWizard }] = useDisclosure(false)

  const allAgents = data?.agents ?? []
  const pending = allAgents.filter((a) => a.status === 'PENDING')
  const approved = allAgents.filter((a) => a.status === 'APPROVED')
  const revoked = allAgents.filter((a) => a.status === 'REVOKED')
  const visibleAgents = [...approved, ...revoked]

  const liveCount = approved.filter((a) => {
    if (!a.lastSeenAt) return false
    return Date.now() - new Date(a.lastSeenAt).getTime() < LIVE_THRESHOLD_MS
  }).length
  const totalEvents = approved.reduce((sum, a) => sum + a._count.events, 0)

  const todayTotal = today?.totalSeconds ?? 0
  const todayPerAgent = new Map((today?.perAgent ?? []).map((p) => [p.agentId, p.seconds]))
  const todayMax = Math.max(1, ...Array.from(todayPerAgent.values()))

  return (
    <>
      <Stack gap="md">
        {approved.length > 0 && (
          <Paper withBorder p="lg" radius="md">
            <Group justify="space-between" align="flex-start">
              <Stack gap={4}>
                <Group gap="xs">
                  <ThemeIcon variant="light" color="teal" size="md" radius="md">
                    <TbClock size={16} />
                  </ThemeIcon>
                  <Text fw={500} size="sm">
                    Aktivitas Hari Ini
                  </Text>
                </Group>
                <Text size="xl" fw={700}>
                  {todayTotal > 0 ? formatDuration(todayTotal) : '—'}
                </Text>
                <Text size="xs" c="dimmed">
                  Total waktu terlacak dari semua perangkat aktif sejak tengah malam.
                </Text>
              </Stack>
              {liveCount > 0 && (
                <Badge size="sm" variant="light" color="teal" leftSection={<TbSparkles size={10} />}>
                  {liveCount} live
                </Badge>
              )}
            </Group>

            {approved.length > 1 && todayTotal > 0 && (
              <Stack gap="xs" mt="md">
                {approved.map((a) => {
                  const seconds = todayPerAgent.get(a.id) ?? 0
                  const percent = (seconds / todayMax) * 100
                  return (
                    <Stack key={a.id} gap={4}>
                      <Group justify="space-between">
                        <Text size="xs" fw={500} truncate>
                          {a.hostname}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {seconds > 0 ? formatDuration(seconds) : '—'}
                        </Text>
                      </Group>
                      <Progress value={percent} size="sm" color={seconds > 0 ? 'teal' : 'gray'} />
                    </Stack>
                  )
                })}
              </Stack>
            )}
          </Paper>
        )}

        {pending.length > 0 && (
          <Alert
            icon={<TbAlertTriangle size={18} />}
            color="yellow"
            variant="light"
            title={`${pending.length} perangkat menunggu persetujuan`}
          >
            <Stack gap="xs">
              <Text size="xs">
                Perangkat berikut sudah terhubung tapi belum disetujui admin. Kirimkan ID ke admin untuk diaktifkan.
              </Text>
              {pending.map((a) => (
                <Group key={a.id} justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {a.hostname}{' '}
                      <Text span c="dimmed" size="xs">
                        ({a.osUser})
                      </Text>
                    </Text>
                    <Text size="xs" c="dimmed">
                      Tercatat {formatRelative(a.createdAt)}
                    </Text>
                  </Stack>
                  <CopyButton value={a.agentId}>
                    {({ copied, copy }) => (
                      <Button
                        size="xs"
                        variant="light"
                        color={copied ? 'teal' : 'yellow'}
                        leftSection={copied ? <TbCheck size={12} /> : <TbCopy size={12} />}
                        onClick={copy}
                      >
                        {copied ? 'Tersalin' : 'Salin ID'}
                      </Button>
                    )}
                  </CopyButton>
                </Group>
              ))}
            </Stack>
          </Alert>
        )}

        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs">
                <TbDeviceDesktop size={16} />
                <Text fw={500} size="sm">
                  Perangkat Saya
                </Text>
                {approved.length > 0 && (
                  <Badge size="xs" variant="light" color="blue">
                    {approved.length} {approved.length === 1 ? 'perangkat' : 'perangkat'}
                  </Badge>
                )}
                {liveCount > 0 && (
                  <Badge size="xs" variant="light" color="teal">
                    {liveCount} live
                  </Badge>
                )}
              </Group>
              <Group gap={4} wrap="nowrap">
                <Button size="xs" variant="light" leftSection={<TbPlus size={12} />} onClick={openWizard}>
                  Tambah perangkat
                </Button>
                <Tooltip label="Refresh">
                  <ActionIcon variant="subtle" size="sm" onClick={() => refetch()} loading={isFetching}>
                    <TbRefresh size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>

            {visibleAgents.length === 0 ? (
              <Stack gap="xs" py="sm">
                <Text size="sm" c="dimmed">
                  Belum ada perangkat yang terhubung. Instal <Code>pmw</Code> di mesin kerja kamu untuk mulai melacak
                  aktivitas.
                </Text>
                <Group>
                  <Button size="xs" leftSection={<TbPlayerPlay size={12} />} onClick={openWizard}>
                    Mulai pemasangan
                  </Button>
                </Group>
              </Stack>
            ) : (
              <>
                <Text size="xs" c="dimmed">
                  Total event tercatat dari seluruh perangkat aktif: <b>{totalEvents.toLocaleString()}</b>
                </Text>
                <Stack gap="xs">
                  {visibleAgents.map((a) => {
                    const live = liveness(a.lastSeenAt)
                    const isRevoked = a.status === 'REVOKED'
                    return (
                      <Paper key={a.id} withBorder p="sm" radius="sm" style={{ opacity: isRevoked ? 0.6 : 1 }}>
                        <Group justify="space-between" wrap="nowrap" align="flex-start">
                          <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                            <Indicator
                              inline
                              processing={live.processing && !isRevoked}
                              color={isRevoked ? 'red' : live.color}
                              size={10}
                              offset={2}
                            >
                              <TbDeviceDesktop size={20} />
                            </Indicator>
                            <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
                              <Group gap={6} wrap="nowrap">
                                <Text size="sm" fw={600} truncate>
                                  {a.hostname}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  ({a.osUser})
                                </Text>
                                {isRevoked && (
                                  <Badge size="xs" color="red" variant="light">
                                    dicabut
                                  </Badge>
                                )}
                              </Group>
                              <Group gap={6} wrap="nowrap">
                                <Text size="xs" c={isRevoked ? 'red' : live.color} fw={500}>
                                  {isRevoked ? 'akses dicabut' : live.label}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  · {a._count.events.toLocaleString()} event
                                </Text>
                              </Group>
                            </Stack>
                          </Group>
                          <Group gap={4} wrap="nowrap">
                            <Tooltip label={a.agentId} withArrow>
                              <Code style={{ fontSize: 10, cursor: 'help' }}>{a.agentId.slice(0, 10)}…</Code>
                            </Tooltip>
                            <CopyButton value={a.agentId}>
                              {({ copied, copy }) => (
                                <Tooltip label={copied ? 'Tersalin!' : 'Salin ID'}>
                                  <ActionIcon
                                    size="xs"
                                    variant="subtle"
                                    onClick={copy}
                                    color={copied ? 'teal' : 'gray'}
                                  >
                                    {copied ? <TbCheck size={12} /> : <TbCopy size={12} />}
                                  </ActionIcon>
                                </Tooltip>
                              )}
                            </CopyButton>
                          </Group>
                        </Group>
                      </Paper>
                    )
                  })}
                </Stack>
              </>
            )}
          </Stack>
        </Paper>
      </Stack>

      <InstallWizardModal opened={wizardOpened} onClose={closeWizard} />
    </>
  )
}

function InstallWizardModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0)
  const next = () => setStep((s) => Math.min(2, s + 1))
  const prev = () => setStep((s) => Math.max(0, s - 1))

  return (
    <Modal opened={opened} onClose={onClose} title="Pemasangan Perangkat Baru" size="lg" centered>
      <Stepper active={step} onStepClick={setStep} size="sm">
        <Stepper.Step label="Unduh" description="Instal pmw" icon={<TbDownload size={14} />}>
          <Stack gap="sm" mt="md">
            <Text size="sm">
              Unduh dan instal <Code>pmw</Code> (pm-watch) di mesin yang ingin kamu pantau:
            </Text>
            <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-dark-9)">
              <Code block style={{ backgroundColor: 'transparent', color: 'white' }}>
                {`curl -fsSL https://get.pm-watch.dev | bash`}
              </Code>
            </Paper>
            <Text size="xs" c="dimmed">
              Atau unduh biner untuk OS kamu dari halaman rilis dan letakkan di <Code>$PATH</Code>.
            </Text>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Token" description="Minta dari admin" icon={<TbKey size={14} />}>
          <Stack gap="sm" mt="md">
            <Text size="sm">
              Minta admin menerbitkan <b>webhook token</b> untuk kamu — token hanya ditampilkan sekali saat dibuat.
            </Text>
            <List size="sm" spacing={6}>
              <List.Item>Admin buka menu Dev → Webhook Tokens</List.Item>
              <List.Item>Pilih "Create token", beri nama (mis. nama kamu atau perangkat)</List.Item>
              <List.Item>Salin token yang muncul sekali itu dan kirim ke kamu via kanal aman</List.Item>
            </List>
            <Alert color="blue" variant="light">
              Simpan token di password manager. Kalau hilang, admin harus mencabut dan menerbitkan ulang.
            </Alert>
          </Stack>
        </Stepper.Step>

        <Stepper.Step label="Init" description="Jalankan pmw init" icon={<TbPlayerPlay size={14} />}>
          <Stack gap="sm" mt="md">
            <Text size="sm">Di mesin target, jalankan:</Text>
            <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-dark-9)">
              <Code block style={{ backgroundColor: 'transparent', color: 'white' }}>
                {`pmw init \\
  --endpoint ${typeof window !== 'undefined' ? window.location.origin : 'https://dashboard'}/webhooks/aw \\
  --token <token-dari-admin>`}
              </Code>
            </Paper>
            <Text size="sm">Setelah itu jalankan:</Text>
            <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-dark-9)">
              <Code block style={{ backgroundColor: 'transparent', color: 'white' }}>
                pmw start
              </Code>
            </Paper>
            <Alert color="yellow" variant="light" icon={<TbAlertTriangle size={16} />}>
              Perangkat akan muncul di daftar dengan status <b>PENDING</b>. Minta admin menyetujui (assign ke akun kamu)
              agar event mulai tercatat.
            </Alert>
          </Stack>
        </Stepper.Step>
      </Stepper>

      <Group justify="space-between" mt="xl">
        <Button variant="default" onClick={prev} disabled={step === 0}>
          Kembali
        </Button>
        {step < 2 ? (
          <Button onClick={next}>Lanjut</Button>
        ) : (
          <Button color="teal" onClick={onClose} leftSection={<TbCheck size={14} />}>
            Selesai
          </Button>
        )}
      </Group>
    </Modal>
  )
}
