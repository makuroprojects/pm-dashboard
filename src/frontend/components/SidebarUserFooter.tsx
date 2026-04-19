import { ActionIcon, Avatar, Badge, Group, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import { TbLayoutSidebarLeftCollapse, TbLayoutSidebarLeftExpand, TbLogout } from 'react-icons/tb'
import { ThemeToggle } from './ThemeToggle'

type User = { name?: string; email?: string; role?: string } | null | undefined

const roleBadgeColor: Record<string, string> = {
  USER: 'blue',
  QC: 'teal',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
}

const roleAvatarColor: Record<string, string> = {
  USER: 'blue',
  QC: 'teal',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
}

export function SidebarUserFooter({
  user,
  collapsed,
  onToggleCollapse,
  onLogout,
  isLoggingOut,
  accentColor = 'blue',
}: {
  user: User
  collapsed: boolean
  onToggleCollapse: () => void
  onLogout: () => void
  isLoggingOut?: boolean
  accentColor?: string
}) {
  const navigate = useNavigate()
  const initial = user?.name?.charAt(0).toUpperCase() ?? '?'
  const roleKey = user?.role ?? 'USER'
  const avatarColor = roleAvatarColor[roleKey] ?? accentColor
  const badgeColor = roleBadgeColor[roleKey] ?? accentColor
  const goProfile = () => navigate({ to: '/settings', search: { section: 'profile' } })

  if (collapsed) {
    return (
      <Stack align="center" gap={6} py="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
        <Tooltip
          label={
            <Stack gap={2}>
              <Text size="xs" fw={600}>
                {user?.name}
              </Text>
              <Text size="xs" c="dimmed">
                {user?.email}
              </Text>
              <Text size="xs" c={badgeColor}>
                {user?.role}
              </Text>
            </Stack>
          }
          position="right"
          withArrow
        >
          <Avatar color={avatarColor} radius="xl" size="sm" style={{ cursor: 'pointer' }} onClick={goProfile}>
            {initial}
          </Avatar>
        </Tooltip>
        <ThemeToggle size="sm" />
        <Tooltip label="Perluas sidebar" position="right" withArrow>
          <ActionIcon variant="subtle" color="gray" size="sm" onClick={onToggleCollapse}>
            <TbLayoutSidebarLeftExpand size={14} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Keluar" position="right" withArrow>
          <ActionIcon variant="subtle" color="red" size="sm" onClick={onLogout} loading={isLoggingOut}>
            <TbLogout size={14} />
          </ActionIcon>
        </Tooltip>
      </Stack>
    )
  }

  return (
    <Stack gap="xs" pt="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      <UnstyledButton
        onClick={goProfile}
        p="xs"
        style={{
          borderRadius: 'var(--mantine-radius-md)',
          transition: 'background 120ms',
        }}
        className="sidebar-user-card"
      >
        <Group gap="xs" wrap="nowrap">
          <Avatar color={avatarColor} radius="xl" size="md">
            {initial}
          </Avatar>
          <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
            <Text size="sm" fw={600} truncate>
              {user?.name ?? '—'}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {user?.email ?? ''}
            </Text>
          </Stack>
          <Badge size="xs" color={badgeColor} variant="light">
            {user?.role}
          </Badge>
        </Group>
      </UnstyledButton>
      <Group justify="space-between" gap="xs">
        <Group gap={4}>
          <ThemeToggle size="sm" />
          <Tooltip label="Ciutkan sidebar">
            <ActionIcon variant="subtle" color="gray" size="lg" onClick={onToggleCollapse} visibleFrom="sm">
              <TbLayoutSidebarLeftCollapse size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
        <Tooltip label="Keluar">
          <ActionIcon variant="subtle" color="red" size="lg" onClick={onLogout} loading={isLoggingOut}>
            <TbLogout size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Stack>
  )
}
