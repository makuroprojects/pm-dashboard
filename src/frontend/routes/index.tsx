import {
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Container,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  useMantineColorScheme,
} from '@mantine/core'
import { createFileRoute, Link } from '@tanstack/react-router'
import type { IconType } from 'react-icons'
import { FaGoogle } from 'react-icons/fa'
import { SiBun, SiPostgresql, SiPrisma, SiRedis, SiTypescript, SiVite } from 'react-icons/si'
import {
  TbActivity,
  TbArrowRight,
  TbBolt,
  TbBrandGithub,
  TbBrandReact,
  TbChecklist,
  TbDashboard,
  TbDeviceDesktopAnalytics,
  TbFeather,
  TbLayoutDashboard,
  TbLogin,
  TbPlugConnected,
  TbShieldLock,
  TbSparkles,
  TbWebhook,
} from 'react-icons/tb'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { getDefaultRoute, useSession } from '@/frontend/hooks/useAuth'

export const Route = createFileRoute('/')({
  component: HomePage,
})

interface Feature {
  icon: IconType
  color: string
  title: string
  description: string
}

const features: Feature[] = [
  {
    icon: TbLayoutDashboard,
    color: 'blue',
    title: 'Project Manager',
    description:
      'Plan projects, manage members, set milestones, and track progress with role-based access (Owner, PM, Member, Viewer).',
  },
  {
    icon: TbChecklist,
    color: 'grape',
    title: 'Task Workflow',
    description:
      'Tasks, bugs, and QC items with priorities, dependencies, checklists, tags, comments, and full status history.',
  },
  {
    icon: TbActivity,
    color: 'teal',
    title: 'pm-watch Activity',
    description:
      'ActivityWatch agents stream real activity events into the dashboard — see what every machine is actually doing.',
  },
  {
    icon: TbWebhook,
    color: 'orange',
    title: 'Secure Webhooks',
    description:
      'DB-backed webhook tokens with SHA-256 hashing, show-once secrets, expiry presets, and full audit trail.',
  },
  {
    icon: TbDeviceDesktopAnalytics,
    color: 'cyan',
    title: 'Live Dev Console',
    description:
      'React Flow visualizations of your schema, routes, env, dependencies, sessions, and live request stream.',
  },
  {
    icon: TbShieldLock,
    color: 'red',
    title: 'Auth & RBAC',
    description:
      'Session cookies, Google OAuth, and four roles (USER · QC · ADMIN · SUPER_ADMIN) with route-level guards.',
  },
]

interface TechItem {
  icon: IconType
  label: string
  color: string
}

const stack: TechItem[] = [
  { icon: SiBun, label: 'Bun', color: '#f9b94c' },
  { icon: TbFeather, label: 'Elysia', color: '#a855f7' },
  { icon: TbBrandReact, label: 'React 19', color: '#61dafb' },
  { icon: SiVite, label: 'Vite 8', color: '#bd34fe' },
  { icon: SiTypescript, label: 'TypeScript', color: '#3178c6' },
  { icon: SiPrisma, label: 'Prisma', color: '#5a67d8' },
  { icon: SiPostgresql, label: 'PostgreSQL', color: '#336791' },
  { icon: SiRedis, label: 'Redis', color: '#dc382d' },
]

const stats = [
  { value: '4', label: 'Roles' },
  { value: '50+', label: 'API endpoints' },
  { value: '10', label: 'Dev visualizations' },
  { value: 'realtime', label: 'WebSocket presence' },
]

function HomePage() {
  const { data } = useSession()
  const user = data?.user
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  const heroBg = isDark
    ? 'radial-gradient(at 20% 0%, rgba(34,139,230,0.18) 0, transparent 55%), radial-gradient(at 80% 30%, rgba(190,75,219,0.18) 0, transparent 55%), radial-gradient(at 50% 100%, rgba(32,201,151,0.14) 0, transparent 60%)'
    : 'radial-gradient(at 20% 0%, rgba(34,139,230,0.14) 0, transparent 55%), radial-gradient(at 80% 30%, rgba(190,75,219,0.12) 0, transparent 55%), radial-gradient(at 50% 100%, rgba(32,201,151,0.10) 0, transparent 60%)'

  const dashboardHref = user ? getDefaultRoute(user.role) : '/login'

  return (
    <Box mih="100vh" style={{ background: heroBg }}>
      {/* Top navigation */}
      <Container size="lg" py="md">
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon variant="gradient" gradient={{ from: 'blue', to: 'grape', deg: 135 }} size={32} radius="md">
              <TbDashboard size={18} />
            </ThemeIcon>
            <Text fw={700} size="lg">
              PM Dashboard
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Anchor
              href="https://github.com/bipproduction"
              target="_blank"
              rel="noopener noreferrer"
              c="dimmed"
              underline="never"
              visibleFrom="sm"
            >
              <Group gap={6} wrap="nowrap">
                <TbBrandGithub size={18} />
                <Text size="sm">GitHub</Text>
              </Group>
            </Anchor>
            <ThemeToggle />
            {user ? (
              <Button
                component={Link}
                to={getDefaultRoute(user.role)}
                size="sm"
                rightSection={<TbArrowRight size={16} />}
              >
                Open dashboard
              </Button>
            ) : (
              <Button component={Link} to="/login" size="sm" leftSection={<TbLogin size={16} />}>
                Login
              </Button>
            )}
          </Group>
        </Group>
      </Container>

      {/* Hero */}
      <Container size="lg" pt={{ base: 40, sm: 80 }} pb={{ base: 40, sm: 80 }}>
        <Stack align="center" gap="xl">
          <Badge size="lg" variant="light" color="blue" radius="sm" leftSection={<TbSparkles size={14} />}>
            v0.1 — full-stack starter, ready to ship
          </Badge>

          <Title order={1} ta="center" fz={{ base: 36, sm: 56 }} lh={1.1} fw={800} maw={820}>
            A modern{' '}
            <Text span inherit variant="gradient" gradient={{ from: 'blue', to: 'grape', deg: 135 }}>
              project &amp; activity
            </Text>{' '}
            dashboard for shipping teams
          </Title>

          <Text c="dimmed" ta="center" size="xl" maw={680}>
            Plan projects, track tasks, ingest real activity from every machine, and audit every webhook — all in one
            Bun + Elysia + React stack.
          </Text>

          <Group gap="md" mt="sm">
            {user ? (
              <Button
                component={Link}
                to={dashboardHref}
                size="lg"
                rightSection={<TbArrowRight size={18} />}
                variant="gradient"
                gradient={{ from: 'blue', to: 'grape', deg: 135 }}
              >
                Continue as {user.name.split(' ')[0]}
              </Button>
            ) : (
              <>
                <Button
                  component={Link}
                  to="/login"
                  size="lg"
                  leftSection={<TbLogin size={18} />}
                  variant="gradient"
                  gradient={{ from: 'blue', to: 'grape', deg: 135 }}
                >
                  Sign in to get started
                </Button>
                <Button
                  component="a"
                  href="/api/auth/google"
                  size="lg"
                  variant="default"
                  leftSection={<FaGoogle size={16} />}
                >
                  Continue with Google
                </Button>
              </>
            )}
          </Group>

          {/* Hero stats */}
          <Paper withBorder radius="lg" p="lg" mt={32} w="100%" maw={760} style={{ backdropFilter: 'blur(8px)' }}>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="lg">
              {stats.map((s) => (
                <Stack key={s.label} gap={2} align="center">
                  <Text fw={700} fz={28} variant="gradient" gradient={{ from: 'blue', to: 'grape', deg: 135 }}>
                    {s.value}
                  </Text>
                  <Text c="dimmed" size="xs" tt="uppercase" fw={600} ta="center">
                    {s.label}
                  </Text>
                </Stack>
              ))}
            </SimpleGrid>
          </Paper>
        </Stack>
      </Container>

      {/* Features */}
      <Container size="lg" py={{ base: 40, sm: 80 }}>
        <Stack gap="xs" align="center" mb="xl">
          <Badge variant="light" color="grape" size="md" radius="sm">
            Features
          </Badge>
          <Title order={2} ta="center" fz={{ base: 28, sm: 36 }}>
            Everything a small team needs
          </Title>
          <Text c="dimmed" ta="center" maw={560}>
            Opinionated batteries: auth, RBAC, real-time presence, audit logs, and visual dev tooling — out of the box.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
          {features.map((f) => {
            const Icon = f.icon
            return (
              <Card
                key={f.title}
                withBorder
                radius="lg"
                padding="lg"
                style={{ height: '100%', transition: 'transform 150ms ease, box-shadow 150ms ease' }}
                className="hover:shadow-lg"
              >
                <Stack gap="md">
                  <ThemeIcon variant="light" color={f.color} size={44} radius="md">
                    <Icon size={22} />
                  </ThemeIcon>
                  <Title order={4}>{f.title}</Title>
                  <Text c="dimmed" size="sm" lh={1.6}>
                    {f.description}
                  </Text>
                </Stack>
              </Card>
            )
          })}
        </SimpleGrid>
      </Container>

      {/* Tech stack */}
      <Container size="lg" py={{ base: 40, sm: 60 }}>
        <Paper withBorder radius="lg" p="xl">
          <Stack gap="lg" align="center">
            <Group gap={8}>
              <TbBolt size={20} />
              <Text fw={600} tt="uppercase" size="sm" c="dimmed">
                Built with
              </Text>
            </Group>
            <SimpleGrid cols={{ base: 2, xs: 4, sm: 8 }} spacing="lg" w="100%">
              {stack.map((t) => {
                const Icon = t.icon
                return (
                  <Stack key={t.label} align="center" gap={6}>
                    <Icon size={32} color={t.color} />
                    <Text size="xs" c="dimmed" fw={500}>
                      {t.label}
                    </Text>
                  </Stack>
                )
              })}
            </SimpleGrid>
          </Stack>
        </Paper>
      </Container>

      {/* CTA banner */}
      <Container size="lg" py={{ base: 40, sm: 80 }}>
        <Card
          withBorder
          radius="lg"
          padding="xl"
          style={{
            background: isDark
              ? 'linear-gradient(135deg, rgba(34,139,230,0.18), rgba(190,75,219,0.18))'
              : 'linear-gradient(135deg, rgba(34,139,230,0.10), rgba(190,75,219,0.10))',
          }}
        >
          <Group justify="space-between" align="center" wrap="wrap" gap="xl">
            <Stack gap={4} maw={520}>
              <Group gap={6}>
                <TbPlugConnected size={20} />
                <Text fw={600} size="sm" tt="uppercase" c="dimmed">
                  Ready to plug in
                </Text>
              </Group>
              <Title order={3} fz={{ base: 24, sm: 28 }}>
                Sign in and start tracking your team in minutes
              </Title>
              <Text c="dimmed" size="sm">
                Use a seeded demo account or your Google identity. SUPER_ADMIN unlocks the full Dev Console.
              </Text>
            </Stack>
            <Group gap="sm">
              <Button
                component={Link}
                to={dashboardHref}
                size="md"
                rightSection={<TbArrowRight size={16} />}
                variant="gradient"
                gradient={{ from: 'blue', to: 'grape', deg: 135 }}
              >
                {user ? 'Open dashboard' : 'Sign in'}
              </Button>
              {!user && (
                <Button
                  component="a"
                  href="/api/auth/google"
                  size="md"
                  variant="default"
                  leftSection={<FaGoogle size={14} />}
                >
                  Google
                </Button>
              )}
            </Group>
          </Group>
        </Card>
      </Container>

      {/* Footer */}
      <Divider />
      <Container size="lg" py="lg">
        <Group justify="space-between" wrap="wrap" gap="md">
          <Group gap={8}>
            <ThemeIcon variant="gradient" gradient={{ from: 'blue', to: 'grape', deg: 135 }} size={24} radius="sm">
              <TbDashboard size={14} />
            </ThemeIcon>
            <Text size="sm" c="dimmed">
              PM Dashboard · © {new Date().getFullYear()}
            </Text>
          </Group>
          <Group gap="lg">
            <Anchor component={Link} to="/login" size="sm" c="dimmed">
              Login
            </Anchor>
            <Anchor component={Link} to="/profile" size="sm" c="dimmed">
              Profile
            </Anchor>
            <Anchor
              href="https://github.com/bipproduction"
              target="_blank"
              rel="noopener noreferrer"
              size="sm"
              c="dimmed"
            >
              <Group gap={4} wrap="nowrap">
                <TbBrandGithub size={14} />
                GitHub
              </Group>
            </Anchor>
          </Group>
        </Group>
      </Container>
    </Box>
  )
}
