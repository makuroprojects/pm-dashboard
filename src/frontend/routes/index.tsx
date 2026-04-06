import { Box, Button, Container, Group, Stack, Text, Title } from '@mantine/core'
import { Link, createFileRoute } from '@tanstack/react-router'
import { SiBun } from 'react-icons/si'
import { TbBrandReact, TbLogin, TbRocket } from 'react-icons/tb'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'

export const Route = createFileRoute('/')({
  component: HomePage,
})

function HomePage() {
  return (
    <Container size="sm" py="xl">
      <Box style={{ position: 'absolute', top: 16, right: 16 }}>
        <ThemeToggle />
      </Box>
      <Stack align="center" gap="lg">
        <Group gap="lg">
          <SiBun size={64} color="#fbf0df" />
          <TbBrandReact size={64} color="#61dafb" />
        </Group>

        <Title order={1}>Bun + Elysia + Vite + React</Title>

        <Text c="dimmed" ta="center" maw={480}>
          Full-stack starter template with Mantine UI, TanStack Router, and session-based auth.
        </Text>

        <Group>
          <Button component={Link} to="/login" leftSection={<TbLogin size={18} />} variant="filled">
            Login
          </Button>
          <Button component={Link} to="/dashboard" leftSection={<TbRocket size={18} />} variant="light">
            Dashboard
          </Button>
        </Group>
      </Stack>
    </Container>
  )
}
