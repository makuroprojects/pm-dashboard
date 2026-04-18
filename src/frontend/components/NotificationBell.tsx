import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Indicator,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  TbArrowRight,
  TbBell,
  TbBellRinging,
  TbChecks,
  TbClock,
  TbClockExclamation,
  TbMessage,
  TbRefresh,
  TbTrash,
  TbUserPlus,
} from 'react-icons/tb'

type NotificationKind =
  | 'TASK_ASSIGNED'
  | 'TASK_COMMENTED'
  | 'TASK_STATUS_CHANGED'
  | 'TASK_DUE_SOON'
  | 'TASK_OVERDUE'
  | 'TASK_MENTIONED'

interface NotificationItem {
  id: string
  kind: NotificationKind
  taskId: string | null
  projectId: string | null
  title: string
  body: string | null
  readAt: string | null
  createdAt: string
  actor: { id: string; name: string; email: string } | null
}

const KIND_META: Record<NotificationKind, { icon: typeof TbBell; color: string; label: string }> = {
  TASK_ASSIGNED: { icon: TbUserPlus, color: 'blue', label: 'Assigned' },
  TASK_COMMENTED: { icon: TbMessage, color: 'violet', label: 'Comment' },
  TASK_STATUS_CHANGED: { icon: TbArrowRight, color: 'teal', label: 'Status' },
  TASK_DUE_SOON: { icon: TbClock, color: 'yellow', label: 'Due soon' },
  TASK_OVERDUE: { icon: TbClockExclamation, color: 'red', label: 'Overdue' },
  TASK_MENTIONED: { icon: TbMessage, color: 'cyan', label: 'Mentioned' },
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export function NotificationBell({ size = 'lg' }: { size?: 'sm' | 'md' | 'lg' }) {
  const qc = useQueryClient()

  const countQ = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () =>
      fetch('/api/me/notifications/unread-count', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ unreadCount: number }>,
      ),
    refetchInterval: 30_000,
  })

  const listQ = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () =>
      fetch('/api/me/notifications?limit=20', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ notifications: NotificationItem[]; unreadCount: number }>,
      ),
    refetchInterval: 30_000,
  })

  const markRead = useMutation({
    mutationFn: (id: string) => fetch(`/api/me/notifications/${id}/read`, { method: 'POST', credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const markAllRead = useMutation({
    mutationFn: () => fetch('/api/me/notifications/read-all', { method: 'POST', credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => fetch(`/api/me/notifications/${id}`, { method: 'DELETE', credentials: 'include' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const unread = countQ.data?.unreadCount ?? 0
  const items = listQ.data?.notifications ?? []

  return (
    <Menu shadow="md" width={380} position="bottom-end" withArrow closeOnItemClick={false}>
      <Menu.Target>
        <Tooltip label={unread > 0 ? `${unread} unread` : 'Notifications'} withArrow>
          <ActionIcon variant="subtle" size={size} aria-label="Notifications">
            <Indicator
              inline
              disabled={unread === 0}
              label={unread > 9 ? '9+' : unread}
              size={16}
              color="red"
              offset={2}
            >
              {unread > 0 ? <TbBellRinging size={18} /> : <TbBell size={18} />}
            </Indicator>
          </ActionIcon>
        </Tooltip>
      </Menu.Target>

      <Menu.Dropdown>
        <Group justify="space-between" px="xs" py={4}>
          <Group gap="xs">
            <TbBell size={14} />
            <Text size="sm" fw={600}>
              Notifications
            </Text>
            {unread > 0 && (
              <Badge size="xs" color="red" variant="filled">
                {unread}
              </Badge>
            )}
          </Group>
          <Group gap={4}>
            <Tooltip label="Refresh" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={() => {
                  listQ.refetch()
                  countQ.refetch()
                }}
                loading={listQ.isFetching}
              >
                <TbRefresh size={12} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Mark all as read" withArrow>
              <ActionIcon
                size="sm"
                variant="subtle"
                color="teal"
                disabled={unread === 0}
                onClick={() => markAllRead.mutate()}
                loading={markAllRead.isPending}
              >
                <TbChecks size={12} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
        <Menu.Divider />

        {items.length === 0 ? (
          <Stack align="center" py="md" gap={4}>
            <TbBell size={20} opacity={0.4} />
            <Text size="xs" c="dimmed">
              No notifications yet.
            </Text>
          </Stack>
        ) : (
          <ScrollArea h={Math.min(420, items.length * 72 + 16)}>
            <Stack gap={4} p={4}>
              {items.map((n) => {
                const meta = KIND_META[n.kind]
                const Icon = meta.icon
                const isUnread = !n.readAt
                return (
                  <UnstyledButton
                    key={n.id}
                    onClick={() => {
                      if (isUnread) markRead.mutate(n.id)
                      if (n.taskId) {
                        window.dispatchEvent(
                          new CustomEvent('pm:openTask', {
                            detail: { taskId: n.taskId, projectId: n.projectId },
                          }),
                        )
                      }
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      borderRadius: 6,
                      padding: 8,
                      background: isUnread ? 'var(--mantine-color-blue-light)' : undefined,
                    }}
                  >
                    <Group wrap="nowrap" align="flex-start" gap="xs">
                      <ActionIcon
                        variant="light"
                        color={meta.color}
                        size="sm"
                        component="div"
                        style={{ pointerEvents: 'none', flexShrink: 0 }}
                      >
                        <Icon size={12} />
                      </ActionIcon>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text size="sm" fw={isUnread ? 600 : 500} lineClamp={2}>
                          {n.title}
                        </Text>
                        {n.body && (
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {n.body}
                          </Text>
                        )}
                        <Group justify="space-between" mt={2}>
                          <Text size="xs" c="dimmed">
                            {meta.label} · {formatRelative(n.createdAt)}
                          </Text>
                          <ActionIcon
                            variant="subtle"
                            size="xs"
                            color="gray"
                            onClick={(e) => {
                              e.stopPropagation()
                              remove.mutate(n.id)
                            }}
                          >
                            <TbTrash size={10} />
                          </ActionIcon>
                        </Group>
                      </div>
                    </Group>
                  </UnstyledButton>
                )
              })}
            </Stack>
          </ScrollArea>
        )}

        {items.length > 0 && (
          <>
            <Menu.Divider />
            <Group justify="space-between" px="xs" py={4}>
              <Text size="xs" c="dimmed">
                Showing {items.length}
              </Text>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={unread === 0}
                onClick={() => markAllRead.mutate()}
                loading={markAllRead.isPending}
                leftSection={<TbChecks size={12} />}
              >
                Mark all read
              </Button>
            </Group>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  )
}
