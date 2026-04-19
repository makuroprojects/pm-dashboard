import {
  ActionIcon,
  Badge,
  Card,
  Container,
  Group,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import {
  TbActivity,
  TbAlertTriangle,
  TbCheck,
  TbDatabase,
  TbPlugConnected,
  TbRefresh,
  TbServer,
  TbShieldLock,
  TbWebhook,
} from 'react-icons/tb'

type ServiceStatus = { ok: boolean; latencyMs: number | null; error: string | null }

interface HealthResponse {
  timestamp: string
  services: {
    db: ServiceStatus
    redis: ServiceStatus
  }
  sessions: { total: number; active: number; online: number }
  agents: { total: number; pending: number; approved: number; revoked: number; live: number }
  webhooks: {
    total24h: number
    success24h: number
    fail24h: number
    authFail24h: number
    eventsIn24h: number
    successRate: number | null
    activeTokens: number
  }
  retention: {
    auditLogDays: number
    auditLogCount: number
    webhookLogDays: number
    webhookLogCount: number
  }
  env: { key: string; set: boolean; required: boolean; note?: string }[]
}

export function SystemHealthPanel() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () =>
      fetch('/api/admin/health', { credentials: 'include' }).then((r) => r.json()) as Promise<HealthResponse>,
    refetchInterval: 20_000,
  })

  const anyCriticalDown = data ? !data.services.db.ok || !data.services.redis.ok : false
  const envMissingRequired = data ? data.env.filter((e) => e.required && !e.set) : []

  return (
    <Container size="xl" px={0}>
      <Stack gap="lg">
        <Group justify="space-between">
          <div>
            <Title order={3}>System Health</Title>
            <Text size="sm" c="dimmed">
              Status operasional service + konfigurasi. Auto-refresh 20 detik.
            </Text>
          </div>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {(anyCriticalDown || envMissingRequired.length > 0) && data && (
          <Card withBorder padding="md" radius="md" bg="red.0">
            <Group gap="sm" align="flex-start">
              <TbAlertTriangle size={20} color="var(--mantine-color-red-7)" />
              <Stack gap={4} style={{ flex: 1 }}>
                <Text fw={600} size="sm" c="red.9">
                  Attention needed
                </Text>
                {!data.services.db.ok && (
                  <Text size="xs" c="red.8">
                    Database down: {data.services.db.error}
                  </Text>
                )}
                {!data.services.redis.ok && (
                  <Text size="xs" c="red.8">
                    Redis down: {data.services.redis.error}
                  </Text>
                )}
                {envMissingRequired.map((e) => (
                  <Text key={e.key} size="xs" c="red.8">
                    Required env missing: {e.key}
                  </Text>
                ))}
              </Stack>
            </Group>
          </Card>
        )}

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <ServiceCard
            label="Database"
            service={data?.services.db}
            loading={isLoading}
            icon={<TbDatabase size={22} />}
          />
          <ServiceCard label="Redis" service={data?.services.redis} loading={isLoading} icon={<TbServer size={22} />} />
        </SimpleGrid>

        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Group gap="xs">
                <TbPlugConnected size={16} />
                <Title order={5}>Agents</Title>
              </Group>
              <SimpleGrid cols={2} spacing="xs">
                <Stat label="Live (5m)" value={data?.agents.live ?? '—'} color="teal" />
                <Stat label="Approved" value={data?.agents.approved ?? '—'} color="blue" />
                <Stat
                  label="Pending"
                  value={data?.agents.pending ?? '—'}
                  color={data && data.agents.pending > 0 ? 'orange' : 'dimmed'}
                />
                <Stat label="Revoked" value={data?.agents.revoked ?? '—'} color="dimmed" />
              </SimpleGrid>
            </Stack>
          </Card>

          <Card withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Group gap="xs">
                <TbWebhook size={16} />
                <Title order={5}>Webhooks (24h)</Title>
              </Group>
              <SimpleGrid cols={2} spacing="xs">
                <Stat label="Requests" value={data?.webhooks.total24h ?? '—'} color="blue" />
                <Stat
                  label="Success rate"
                  value={
                    data?.webhooks.successRate !== null && data?.webhooks.successRate !== undefined
                      ? `${data.webhooks.successRate}%`
                      : '—'
                  }
                  color={
                    data?.webhooks.successRate !== null && data?.webhooks.successRate !== undefined
                      ? data.webhooks.successRate >= 95
                        ? 'teal'
                        : data.webhooks.successRate >= 80
                          ? 'orange'
                          : 'red'
                      : 'dimmed'
                  }
                />
                <Stat
                  label="Failures"
                  value={data?.webhooks.fail24h ?? '—'}
                  color={data && data.webhooks.fail24h > 0 ? 'red' : 'dimmed'}
                />
                <Stat
                  label="Auth fails"
                  value={data?.webhooks.authFail24h ?? '—'}
                  color={data && data.webhooks.authFail24h > 0 ? 'red' : 'dimmed'}
                />
                <Stat label="Events in" value={data?.webhooks.eventsIn24h ?? '—'} color="violet" />
                <Stat label="Active tokens" value={data?.webhooks.activeTokens ?? '—'} color="blue" />
              </SimpleGrid>
            </Stack>
          </Card>

          <Card withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Group gap="xs">
                <TbActivity size={16} />
                <Title order={5}>Sessions</Title>
              </Group>
              <SimpleGrid cols={3} spacing="xs">
                <Stat label="Total" value={data?.sessions.total ?? '—'} color="blue" />
                <Stat label="Active" value={data?.sessions.active ?? '—'} color="teal" />
                <Stat label="Online" value={data?.sessions.online ?? '—'} color="green" />
              </SimpleGrid>
            </Stack>
          </Card>

          <Card withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Group gap="xs">
                <TbShieldLock size={16} />
                <Title order={5}>Log Retention</Title>
              </Group>
              <SimpleGrid cols={2} spacing="xs">
                <Stat
                  label={`Audit (${data?.retention.auditLogDays ?? '—'}d)`}
                  value={data?.retention.auditLogCount ?? '—'}
                  color="blue"
                />
                <Stat
                  label={`Webhook (${data?.retention.webhookLogDays ?? '—'}d)`}
                  value={data?.retention.webhookLogCount ?? '—'}
                  color="violet"
                />
              </SimpleGrid>
              <Text size="xs" c="dimmed">
                Auto-cleanup berjalan saat startup + setiap 24 jam.
              </Text>
            </Stack>
          </Card>
        </SimpleGrid>

        <Card withBorder padding={0} radius="md">
          <Group p="md" gap="xs">
            <TbShieldLock size={16} />
            <Title order={5}>Environment Variables</Title>
          </Group>
          <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Variable</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Required</Table.Th>
                <Table.Th>Note</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data?.env ?? []).map((e) => (
                <Table.Tr key={e.key}>
                  <Table.Td>
                    <Text size="sm" ff="monospace">
                      {e.key}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {e.set ? (
                      <Badge color="teal" variant="light" size="sm" leftSection={<TbCheck size={10} />}>
                        set
                      </Badge>
                    ) : (
                      <Badge color={e.required ? 'red' : 'gray'} variant="light" size="sm">
                        unset
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {e.required ? (
                      <Badge color="red" variant="filled" size="xs">
                        required
                      </Badge>
                    ) : (
                      <Text size="xs" c="dimmed">
                        optional
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {e.note ? (
                      <Text size="xs" c="dimmed">
                        {e.note}
                      </Text>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}

function ServiceCard({
  label,
  service,
  loading,
  icon,
}: {
  label: string
  service: ServiceStatus | undefined
  loading: boolean
  icon: React.ReactNode
}) {
  const status = !service ? 'unknown' : service.ok ? 'ok' : 'down'
  const color = status === 'ok' ? 'teal' : status === 'down' ? 'red' : 'gray'
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="md" wrap="nowrap" align="center">
        <div style={{ color: `var(--mantine-color-${color}-6)` }}>{icon}</div>
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs">
            <Text fw={600} size="sm">
              {label}
            </Text>
            <Badge color={color} variant="light" size="sm">
              {loading ? 'checking...' : status === 'ok' ? 'healthy' : status === 'down' ? 'down' : 'unknown'}
            </Badge>
          </Group>
          {service?.ok && service.latencyMs !== null && (
            <Text size="xs" c="dimmed">
              Latency: {service.latencyMs}ms
            </Text>
          )}
          {service && !service.ok && service.error && (
            <Text size="xs" c="red" lineClamp={2}>
              {service.error}
            </Text>
          )}
        </Stack>
      </Group>
    </Card>
  )
}

function Stat({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={500} tt="uppercase">
        {label}
      </Text>
      <Text fw={700} size="lg" c={color === 'dimmed' ? undefined : color}>
        {value}
      </Text>
    </div>
  )
}
