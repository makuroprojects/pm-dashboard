import { Alert, Box, Button, Center, Divider, Paper, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { FcGoogle } from 'react-icons/fc'
import { TbAlertCircle, TbLock, TbLogin, TbMail } from 'react-icons/tb'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { getDefaultRoute, useLogin } from '@/frontend/hooks/useAuth'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => {
    const error = typeof search.error === 'string' ? search.error : undefined
    return error ? { error } : {}
  },
  beforeLoad: async ({ context }) => {
    try {
      const data = await context.queryClient.ensureQueryData({
        queryKey: ['auth', 'session'],
        queryFn: () => fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json()),
      })
      if (data?.user) {
        throw redirect({ to: getDefaultRoute(data.user.role) })
      }
    } catch (e) {
      if (e instanceof Error) return
      throw e
    }
  },
  component: LoginPage,
})

function LoginPage() {
  const login = useLogin()
  const { error: searchError } = Route.useSearch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    login.mutate({ email, password })
  }

  return (
    <Center mih="100vh" style={{ position: 'relative' }}>
      <Box style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle />
      </Box>
      <Paper shadow="md" p="xl" radius="md" w={400} withBorder>
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Title order={2} ta="center">
              Login
            </Title>

            {import.meta.env.DEV && (
              <Text c="dimmed" size="sm" ta="center">
                Super Admin: <strong>superadmin@example.com</strong> / <strong>superadmin123</strong>
                <br />
                Admin: <strong>admin@example.com</strong> / <strong>admin123</strong>
                <br />
                User: <strong>user@example.com</strong> / <strong>user123</strong>
              </Text>
            )}

            {(login.isError || searchError) && (
              <Alert icon={<TbAlertCircle size={16} />} color="red" variant="light">
                {login.isError ? login.error.message : 'Login dengan Google gagal, coba lagi.'}
              </Alert>
            )}

            <TextInput
              label="Email"
              placeholder="email@example.com"
              leftSection={<TbMail size={16} />}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              required
            />

            <PasswordInput
              label="Password"
              placeholder="Password"
              leftSection={<TbLock size={16} />}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              required
            />

            <Button type="submit" fullWidth leftSection={<TbLogin size={18} />} loading={login.isPending}>
              Sign in
            </Button>

            <Divider label="atau" labelPosition="center" />

            <Button
              component="a"
              href="/api/auth/google"
              fullWidth
              variant="default"
              leftSection={<FcGoogle size={18} />}
            >
              Login dengan Google
            </Button>
          </Stack>
        </form>
      </Paper>
    </Center>
  )
}
