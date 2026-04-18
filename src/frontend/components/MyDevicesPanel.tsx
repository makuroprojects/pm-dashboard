import { ActionIcon, Badge, Code, CopyButton, Group, Indicator, Paper, Stack, Text, Tooltip } from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { TbCheck, TbCopy, TbDeviceDesktop, TbRefresh } from 'react-icons/tb'

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

function liveness(lastSeenAt: string | null): { color: string; label: string; processing: boolean } {
  if (!lastSeenAt) return { color: 'gray', label: 'never seen', processing: false }
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

  const agents = data?.agents ?? []
  const liveCount = agents.filter((a) => {
    if (!a.lastSeenAt) return false
    return Date.now() - new Date(a.lastSeenAt).getTime() < LIVE_THRESHOLD_MS
  }).length
  const totalEvents = agents.reduce((sum, a) => sum + a._count.events, 0)

  return (
    <Paper withBorder p="lg" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="xs">
            <TbDeviceDesktop size={16} />
            <Text fw={500} size="sm">
              My Devices
            </Text>
            {agents.length > 0 && (
              <Badge size="xs" variant="light" color="blue">
                {agents.length} {agents.length === 1 ? 'device' : 'devices'}
              </Badge>
            )}
            {liveCount > 0 && (
              <Badge size="xs" variant="light" color="teal">
                {liveCount} live
              </Badge>
            )}
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" size="sm" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {agents.length === 0 ? (
          <Text size="xs" c="dimmed">
            No devices linked yet. Install <Code>pmw</Code> on a machine, run <Code>pmw init</Code>, and ask your admin
            to approve the agent once it appears.
          </Text>
        ) : (
          <>
            <Text size="xs" c="dimmed">
              Total events ingested across all your devices: <b>{totalEvents.toLocaleString()}</b>
            </Text>
            <Stack gap="xs">
              {agents.map((a) => {
                const live = liveness(a.lastSeenAt)
                return (
                  <Paper key={a.id} withBorder p="sm" radius="sm">
                    <Group justify="space-between" wrap="nowrap" align="flex-start">
                      <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                        <Indicator inline processing={live.processing} color={live.color} size={10} offset={2}>
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
                          </Group>
                          <Group gap={6} wrap="nowrap">
                            <Text size="xs" c={live.color} fw={500}>
                              {live.label}
                            </Text>
                            <Text size="xs" c="dimmed">
                              · {a._count.events.toLocaleString()} events
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
                            <Tooltip label={copied ? 'Copied!' : 'Copy ID'}>
                              <ActionIcon size="xs" variant="subtle" onClick={copy} color={copied ? 'teal' : 'gray'}>
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
  )
}
