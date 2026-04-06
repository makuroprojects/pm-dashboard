import {
  Avatar,
  Badge,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { TbLogout, TbUser } from 'react-icons/tb'
import { modals } from '@mantine/modals'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'

export const Route = createFileRoute('/profile')({
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
  component: ProfilePage,
})

const roleBadgeColor: Record<string, string> = {
  USER: 'blue',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
}

function ProfilePage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user

  return (
    <Container size="sm" py="xl">
      <Stack gap="xl">
        <Group justify="space-between">
          <Title order={2}>Profile</Title>
          <Group gap="xs">
            <ThemeToggle size="sm" />
            {user?.role === 'SUPER_ADMIN' && (
              <Button component={Link} to="/dev" variant="light" size="xs">
                Dev Console
              </Button>
            )}
            {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN') && (
              <Button component={Link} to="/dashboard" variant="light" size="xs">
                Dashboard
              </Button>
            )}
            <Button
              variant="light"
              color="red"
              leftSection={<TbLogout size={16} />}
              onClick={() => modals.openConfirmModal({
                title: 'Logout',
                children: <Text size="sm">Are you sure you want to logout?</Text>,
                labels: { confirm: 'Logout', cancel: 'Cancel' },
                confirmProps: { color: 'red' },
                onConfirm: () => logout.mutate(),
              })}
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
              <Text fw={600} size="lg">{user?.name}</Text>
              <Text c="dimmed" size="sm">{user?.email}</Text>
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
              <Text fw={500} size="sm">Account Info</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Name</Text>
              <Text size="sm">{user?.name}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Email</Text>
              <Text size="sm">{user?.email}</Text>
            </Group>
            <Group justify="space-between">
              <Text size="sm" c="dimmed">Role</Text>
              <Text size="sm">{user?.role}</Text>
            </Group>
          </Stack>
        </Paper>
      </Stack>
    </Container>
  )
}
