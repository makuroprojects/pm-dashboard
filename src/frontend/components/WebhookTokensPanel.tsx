import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Menu,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { modals } from '@mantine/modals'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  TbCheck,
  TbCopy,
  TbDots,
  TbKey,
  TbPlayerPause,
  TbPlayerPlay,
  TbPlus,
  TbRefresh,
  TbShieldOff,
  TbTrash,
} from 'react-icons/tb'

type TokenStatus = 'ACTIVE' | 'DISABLED' | 'REVOKED'

interface TokenRow {
  id: string
  name: string
  tokenPrefix: string
  status: TokenStatus
  expiresAt: string | null
  lastUsedAt: string | null
  createdBy: { id: string; name: string; email: string } | null
  createdAt: string
}

interface ListResponse {
  tokens: TokenRow[]
  envFallback: boolean
}

interface CreateResponse {
  token: Omit<TokenRow, 'createdBy' | 'lastUsedAt'>
  raw: string
}

const STATUS_COLOR: Record<TokenStatus, string> = {
  ACTIVE: 'green',
  DISABLED: 'gray',
  REVOKED: 'red',
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
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatExpiry(iso: string | null): { text: string; expired: boolean } {
  if (!iso) return { text: 'Never', expired: false }
  const d = new Date(iso)
  const expired = d.getTime() <= Date.now()
  return { text: d.toLocaleDateString(), expired }
}

export function WebhookTokensPanel() {
  const queryClient = useQueryClient()

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'webhook-tokens'],
    queryFn: () => api<ListResponse>('/api/admin/webhook-tokens'),
    refetchInterval: 20_000,
  })

  const createToken = useMutation({
    mutationFn: (body: { name: string; expiresAt: string | null }) =>
      api<CreateResponse>('/api/admin/webhook-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'webhook-tokens'] })
      openShowOnceModal(res.raw, res.token.name)
    },
  })

  const patchToken = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TokenStatus }) =>
      api(`/api/admin/webhook-tokens/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'webhook-tokens'] }),
  })

  const deleteToken = useMutation({
    mutationFn: (id: string) => api(`/api/admin/webhook-tokens/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'webhook-tokens'] }),
  })

  const tokens = data?.tokens ?? []
  const counts = tokens.reduce(
    (acc, t) => {
      acc[t.status] = (acc[t.status] || 0) + 1
      return acc
    },
    {} as Record<string, number>,
  )

  const openCreate = () => {
    let name = ''
    let expiryPreset: string = 'never'
    modals.openConfirmModal({
      title: 'Create webhook token',
      children: <CreateTokenForm onName={(v) => (name = v)} onExpiry={(v) => (expiryPreset = v)} />,
      labels: { confirm: 'Create', cancel: 'Cancel' },
      confirmProps: { color: 'green' },
      onConfirm: () => {
        if (!name.trim()) return
        let expiresAt: string | null = null
        if (expiryPreset !== 'never') {
          const days = parseInt(expiryPreset, 10)
          expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        }
        createToken.mutate({ name: name.trim(), expiresAt })
      },
    })
  }

  const openShowOnceModal = (raw: string, name: string) => {
    modals.open({
      title: `Token created: ${name}`,
      size: 'lg',
      children: (
        <Stack gap="sm">
          <Alert color="yellow" variant="light">
            Simpan token ini sekarang — setelah modal ditutup, token tidak bisa dilihat lagi.
          </Alert>
          <Card withBorder padding="sm" radius="sm">
            <Group gap="xs" wrap="nowrap">
              <Code style={{ flex: 1, wordBreak: 'break-all', fontSize: 12 }}>{raw}</Code>
              <CopyButton value={raw}>
                {({ copied, copy }) => (
                  <Button size="xs" leftSection={copied ? <TbCheck size={14} /> : <TbCopy size={14} />} onClick={copy}>
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                )}
              </CopyButton>
            </Group>
          </Card>
          <Text size="xs" c="dimmed">
            Gunakan sebagai <Code>Authorization: Bearer &lt;token&gt;</Code> di pm-watch config.
          </Text>
          <Group justify="flex-end">
            <Button onClick={() => modals.closeAll()}>Done</Button>
          </Group>
        </Stack>
      ),
    })
  }

  const openRevoke = (token: TokenRow) => {
    modals.openConfirmModal({
      title: `Revoke token "${token.name}"?`,
      children: (
        <Text size="sm">
          Token akan ditolak di webhook (HTTP 403) dan tidak bisa diaktifkan kembali. Buat token baru kalau perlu
          rotate.
        </Text>
      ),
      labels: { confirm: 'Revoke', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => patchToken.mutate({ id: token.id, status: 'REVOKED' }),
    })
  }

  const openDelete = (token: TokenRow) => {
    modals.openConfirmModal({
      title: `Delete token "${token.name}"?`,
      children: (
        <Text size="sm">
          Token akan dihapus permanen dari database. Biasanya cukup revoke saja kecuali ingin bersih-bersih.
        </Text>
      ),
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => deleteToken.mutate(token.id),
    })
  }

  const err = createToken.error || patchToken.error || deleteToken.error

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Group gap="xs">
          <TbKey size={24} />
          <Title order={3}>Webhook Tokens</Title>
          <Badge color="green" variant="light">
            Active: {counts.ACTIVE ?? 0}
          </Badge>
          <Badge color="gray" variant="light">
            Disabled: {counts.DISABLED ?? 0}
          </Badge>
          <Badge color="red" variant="light">
            Revoked: {counts.REVOKED ?? 0}
          </Badge>
        </Group>
        <Group gap="xs">
          <Button leftSection={<TbPlus size={14} />} size="xs" onClick={openCreate}>
            New token
          </Button>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {data?.envFallback && (
        <Alert color="blue" variant="light">
          <Text size="sm">
            <Code>PMW_WEBHOOK_TOKEN</Code> env var aktif sebagai fallback. Pertimbangkan migrasi ke DB token lalu hapus
            env untuk mematikan fallback.
          </Text>
        </Alert>
      )}

      {err && <Alert color="red">{err.message}</Alert>}

      <Card withBorder padding={0} radius="md">
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 100 }}>Status</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Prefix</Table.Th>
              <Table.Th style={{ width: 160 }}>Created by</Table.Th>
              <Table.Th style={{ width: 120 }}>Expires</Table.Th>
              <Table.Th style={{ width: 120 }}>Last used</Table.Th>
              <Table.Th style={{ width: 50 }}></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {isLoading && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text ta="center" c="dimmed" py="md">
                    Loading…
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {!isLoading && tokens.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text ta="center" c="dimmed" py="md">
                    Belum ada token. Klik <Code>New token</Code> untuk generate.
                  </Text>
                </Table.Td>
              </Table.Tr>
            )}
            {tokens.map((t) => {
              const expiry = formatExpiry(t.expiresAt)
              return (
                <Table.Tr key={t.id}>
                  <Table.Td>
                    <Badge size="sm" color={STATUS_COLOR[t.status]} variant="light">
                      {t.status}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {t.name}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Code style={{ fontSize: 11 }}>{t.tokenPrefix}…</Code>
                  </Table.Td>
                  <Table.Td>
                    {t.createdBy ? (
                      <div>
                        <Text size="xs" fw={500}>
                          {t.createdBy.name}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {t.createdBy.email}
                        </Text>
                      </div>
                    ) : (
                      <Text size="xs" c="dimmed">
                        —
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c={expiry.expired ? 'red' : 'dimmed'}>
                      {expiry.text}
                      {expiry.expired && ' (expired)'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs" c="dimmed">
                      {formatRelative(t.lastUsedAt)}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <ActionIcon variant="subtle" size="sm">
                          <TbDots size={14} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        {t.status === 'ACTIVE' && (
                          <Menu.Item
                            leftSection={<TbPlayerPause size={14} />}
                            onClick={() => patchToken.mutate({ id: t.id, status: 'DISABLED' })}
                          >
                            Disable
                          </Menu.Item>
                        )}
                        {t.status === 'DISABLED' && (
                          <Menu.Item
                            leftSection={<TbPlayerPlay size={14} />}
                            onClick={() => patchToken.mutate({ id: t.id, status: 'ACTIVE' })}
                          >
                            Enable
                          </Menu.Item>
                        )}
                        {t.status !== 'REVOKED' && (
                          <Menu.Item leftSection={<TbShieldOff size={14} />} color="red" onClick={() => openRevoke(t)}>
                            Revoke
                          </Menu.Item>
                        )}
                        <Menu.Divider />
                        <Menu.Item leftSection={<TbTrash size={14} />} color="red" onClick={() => openDelete(t)}>
                          Delete permanently
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              )
            })}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}

function CreateTokenForm({ onName, onExpiry }: { onName: (v: string) => void; onExpiry: (v: string) => void }) {
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('never')
  return (
    <Stack gap="sm">
      <TextInput
        label="Name"
        placeholder="e.g. laptop-air-bip"
        value={name}
        onChange={(e) => {
          setName(e.currentTarget.value)
          onName(e.currentTarget.value)
        }}
      />
      <Select
        label="Expires"
        value={expiry}
        onChange={(v) => {
          const next = v || 'never'
          setExpiry(next)
          onExpiry(next)
        }}
        data={[
          { value: 'never', label: 'Never' },
          { value: '7', label: '7 days' },
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
          { value: '365', label: '1 year' },
        ]}
      />
    </Stack>
  )
}
