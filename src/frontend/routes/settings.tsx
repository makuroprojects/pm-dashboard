import { Avatar, Badge, Button, Container, Group, Paper, Stack, Text, Title } from '@mantine/core'
import { modals } from '@mantine/modals'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { TbCode, TbLogout, TbShieldLock, TbTarget, TbUser } from 'react-icons/tb'
import { MyDevicesPanel } from '@/frontend/components/MyDevicesPanel'
import { NotificationBell } from '@/frontend/components/NotificationBell'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'

export const Route = createFileRoute('/settings')({
  beforeLoad: async ({ context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'session'],
        queryFn: () => fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()),
      })
      if (!data?.user) throw redirect({ to: '/login' })
      if (data.user.blocked) throw redirect({ to: '/blocked' })
    } catch (e) {
      if (e instanceof Error) throw redirect({ to: '/login' })
      throw e
    }
  },
  component: SettingsPage,
})

const roleBadgeColor: Record<string, string> = {
  USER: 'blue',
  QC: 'teal',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
}

function SettingsPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const canAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'
  const isSuper = user?.role === 'SUPER_ADMIN'

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <Group justify="space-between">
          <Title order={2}>Settings</Title>
          <Group gap="xs">
            <NotificationBell size="md" />
            <ThemeToggle size="sm" />
            <Button component={Link} to="/pm" variant="light" size="xs" leftSection={<TbTarget size={14} />}>
              PM
            </Button>
            {canAdmin && (
              <Button
                component={Link}
                to="/admin"
                variant="light"
                size="xs"
                color="violet"
                leftSection={<TbShieldLock size={14} />}
              >
                Admin
              </Button>
            )}
            {isSuper && (
              <Button
                component={Link}
                to="/dev"
                variant="light"
                size="xs"
                color="orange"
                leftSection={<TbCode size={14} />}
              >
                Dev
              </Button>
            )}
            <Button
              variant="light"
              color="red"
              size="xs"
              leftSection={<TbLogout size={14} />}
              onClick={() =>
                modals.openConfirmModal({
                  title: 'Logout',
                  children: <Text size="sm">Are you sure you want to logout?</Text>,
                  labels: { confirm: 'Logout', cancel: 'Cancel' },
                  confirmProps: { color: 'red' },
                  onConfirm: () => logout.mutate(),
                })
              }
              loading={logout.isPending}
            >
              Logout
            </Button>
          </Group>
        </Group>

        <Paper withBorder p="xl" radius="md">
          <Stack align="center" gap="md">
            <Avatar color="blue" radius="xl" size={80}>
              {user?.name?.charAt(0).toUpperCase()}
            </Avatar>
            <div style={{ textAlign: 'center' }}>
              <Text fw={600} size="lg">
                {user?.name}
              </Text>
              <Text c="dimmed" size="sm">
                {user?.email}
              </Text>
            </div>
            <Badge color={roleBadgeColor[user?.role ?? 'USER']} variant="light" size="lg">
              {user?.role}
            </Badge>
          </Stack>
        </Paper>

        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Group gap="xs">
              <TbUser size={16} />
              <Text fw={500} size="sm">
                Account Info
              </Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Name
              </Text>
              <Text size="sm">{user?.name}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Email
              </Text>
              <Text size="sm">{user?.email}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">
                Role
              </Text>
              <Text size="sm">{user?.role}</Text>
            </Group>
          </Stack>
        </Paper>

        <MyDevicesPanel />

        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Text fw={500} size="sm">
              Project Manager preferences
            </Text>
            <Text size="xs" c="dimmed">
              Notifications, default project view, AW pairing rules. Coming in Phase 2.
            </Text>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  )
}
