import { ActionIcon, Avatar, Badge, Card, Container, Group, Menu, Stack, Table, Text, Title } from '@mantine/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { TbBug, TbCircleFilled, TbDots, TbLock, TbLockOpen, TbShieldCheck, TbShieldOff } from 'react-icons/tb'
import { type Role, useSession } from '@/frontend/hooks/useAuth'
import { usePresence } from '@/frontend/hooks/usePresence'
import { notifyError, notifySuccess } from '@/frontend/lib/notify'

interface AdminUser {
  id: string
  name: string
  email: string
  role: Role
  blocked: boolean
  createdAt: string
}

const roleBadge: Record<string, { color: string; label: string }> = {
  USER: { color: 'blue', label: 'User' },
  QC: { color: 'teal', label: 'QC' },
  ADMIN: { color: 'violet', label: 'Admin' },
  SUPER_ADMIN: { color: 'red', label: 'Super Admin' },
}

export function UsersPanel() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () =>
      fetch('/api/admin/users', { credentials: 'include' }).then((r) => r.json()) as Promise<{ users: AdminUser[] }>,
  })

  const { data: sessionData } = useSession()
  const currentUserId = sessionData?.user?.id
  const currentRole = sessionData?.user?.role
  const { onlineUserIds } = usePresence()

  const changeRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: string }) => {
      const res = await fetch(`/api/admin/users/${id}/role`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal mengubah role')
      return json
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      notifySuccess({ message: `Role diubah ke ${vars.role}.` })
    },
    onError: (err) => notifyError(err),
  })

  const toggleBlock = useMutation({
    mutationFn: async ({ id, blocked }: { id: string; blocked: boolean }) => {
      const res = await fetch(`/api/admin/users/${id}/block`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocked }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Gagal memperbarui status')
      return json
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      notifySuccess({ message: vars.blocked ? 'User diblokir.' : 'User diaktifkan kembali.' })
    },
    onError: (err) => notifyError(err),
  })

  const users = data?.users ?? []

  return (
    <Container size="lg">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={3}>User Management</Title>
          <Badge variant="light" size="lg">
            {users.length} users
          </Badge>
        </Group>

        <Card withBorder radius="md" p={0}>
          <Table highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>User</Table.Th>
                <Table.Th>Role</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th ta="right">Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {isLoading && (
                <Table.Tr>
                  <Table.Td colSpan={4}>
                    <Text ta="center" c="dimmed" py="md">
                      Loading...
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {users.map((u) => {
                const isSelf = u.id === currentUserId
                const badge = roleBadge[u.role] ?? roleBadge.USER
                const isOnline = onlineUserIds.includes(u.id)
                const isTargetSuper = u.role === 'SUPER_ADMIN'
                const canActOnTarget = !isSelf && !isTargetSuper && currentRole === 'SUPER_ADMIN'

                return (
                  <Table.Tr key={u.id} opacity={u.blocked ? 0.5 : 1}>
                    <Table.Td>
                      <Group gap="sm">
                        <div style={{ position: 'relative' }}>
                          <Avatar color={badge.color} radius="xl" size="sm">
                            {u.name.charAt(0).toUpperCase()}
                          </Avatar>
                          {!u.blocked && (
                            <TbCircleFilled
                              size={10}
                              color={isOnline ? 'var(--mantine-color-green-6)' : 'var(--mantine-color-gray-6)'}
                              style={{
                                position: 'absolute',
                                bottom: -1,
                                right: -1,
                                borderRadius: '50%',
                                border: '2px solid var(--mantine-color-body)',
                              }}
                            />
                          )}
                        </div>
                        <div>
                          <Text size="sm" fw={500}>
                            {u.name}{' '}
                            {isSelf && (
                              <Text span c="dimmed" size="xs">
                                (you)
                              </Text>
                            )}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {u.email}
                          </Text>
                        </div>
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={badge.color} variant="light" size="sm">
                        {badge.label}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      {u.blocked ? (
                        <Badge color="red" variant="filled" size="sm">
                          Blocked
                        </Badge>
                      ) : isOnline ? (
                        <Badge color="green" variant="filled" size="sm">
                          Online
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="light" size="sm">
                          Offline
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right">
                      {canActOnTarget && (
                        <Menu shadow="md" width={200} position="bottom-end">
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="gray">
                              <TbDots size={16} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Role</Menu.Label>
                            {u.role !== 'USER' && (
                              <Menu.Item
                                leftSection={<TbShieldOff size={14} />}
                                onClick={() => changeRole.mutate({ id: u.id, role: 'USER' })}
                              >
                                Set as User
                              </Menu.Item>
                            )}
                            {u.role !== 'QC' && (
                              <Menu.Item
                                leftSection={<TbBug size={14} />}
                                onClick={() => changeRole.mutate({ id: u.id, role: 'QC' })}
                              >
                                Set as QC
                              </Menu.Item>
                            )}
                            {u.role !== 'ADMIN' && (
                              <Menu.Item
                                leftSection={<TbShieldCheck size={14} />}
                                onClick={() => changeRole.mutate({ id: u.id, role: 'ADMIN' })}
                              >
                                Set as Admin
                              </Menu.Item>
                            )}

                            <Menu.Divider />
                            <Menu.Label>Status</Menu.Label>
                            {u.blocked ? (
                              <Menu.Item
                                leftSection={<TbLockOpen size={14} />}
                                color="green"
                                onClick={() => toggleBlock.mutate({ id: u.id, blocked: false })}
                              >
                                Unblock User
                              </Menu.Item>
                            ) : (
                              <Menu.Item
                                leftSection={<TbLock size={14} />}
                                color="red"
                                onClick={() => toggleBlock.mutate({ id: u.id, blocked: true })}
                              >
                                Block User
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Card>
      </Stack>
    </Container>
  )
}
