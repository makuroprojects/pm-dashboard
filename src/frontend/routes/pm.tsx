import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
  Card,
  Container,
  Group,
  NavLink,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import {
  TbActivity,
  TbBug,
  TbLayoutDashboard,
  TbLayoutSidebarLeftCollapse,
  TbLayoutSidebarLeftExpand,
  TbListCheck,
  TbLogout,
  TbPlus,
  TbSettings,
  TbTarget,
  TbUser,
  TbUsers,
} from 'react-icons/tb'
import { ActivityPanel } from '@/frontend/components/ActivityPanel'
import { NotificationBell } from '@/frontend/components/NotificationBell'
import { PROJECT_DETAIL_TABS, type ProjectDetailTab, ProjectDetailView } from '@/frontend/components/ProjectDetailView'
import { ProjectsPanel } from '@/frontend/components/ProjectsPanel'
import { TaskDetailView } from '@/frontend/components/TaskDetailView'
import { TasksPanel } from '@/frontend/components/TasksPanel'
import { ThemeToggle } from '@/frontend/components/ThemeToggle'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'

const validTabs = ['overview', 'projects', 'tasks', 'activity', 'team'] as const
type TabKey = (typeof validTabs)[number]

type PmSearch = { tab: TabKey; projectId?: string; detailTab?: ProjectDetailTab; taskId?: string }

export const Route = createFileRoute('/pm')({
  validateSearch: (search: Record<string, unknown>): PmSearch => {
    const tab = validTabs.includes(search.tab as TabKey) ? (search.tab as TabKey) : 'overview'
    const projectId = typeof search.projectId === 'string' ? search.projectId : undefined
    const detailTab = PROJECT_DETAIL_TABS.includes(search.detailTab as ProjectDetailTab)
      ? (search.detailTab as ProjectDetailTab)
      : undefined
    const taskId = typeof search.taskId === 'string' ? search.taskId : undefined
    const out: PmSearch = { tab }
    if (projectId) out.projectId = projectId
    if (detailTab) out.detailTab = detailTab
    if (taskId) out.taskId = taskId
    return out
  },
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
  component: PmPage,
})

type NavItem = { label: string; icon: typeof TbLayoutDashboard; key: TabKey; badge?: string }

const navItems: NavItem[] = [
  { label: 'Ringkasan', icon: TbLayoutDashboard, key: 'overview' },
  { label: 'Proyek', icon: TbTarget, key: 'projects' },
  { label: 'Task', icon: TbListCheck, key: 'tasks' },
  { label: 'Aktivitas', icon: TbActivity, key: 'activity', badge: 'AW' },
  { label: 'Tim', icon: TbUsers, key: 'team' },
]

function PmPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { tab: active, projectId: activeProjectId, detailTab, taskId: activeTaskId } = Route.useSearch()
  const navigate = useNavigate()
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const isMobile = useMediaQuery('(max-width: 48em)')
  const setActive = (key: TabKey) => {
    navigate({ to: '/pm', search: { tab: key } })
    closeMobile()
  }
  const setTasksProjectFilter = (projectId: string | null) => {
    navigate({ to: '/pm', search: { tab: 'tasks', ...(projectId ? { projectId } : {}) } })
  }
  const setProjectDetailTab = (next: ProjectDetailTab) => {
    if (!activeProjectId) return
    navigate({ to: '/pm', search: { tab: 'projects', projectId: activeProjectId, detailTab: next } })
  }
  const closeProjectDetail = () => {
    navigate({ to: '/pm', search: { tab: 'projects' } })
  }
  const closeTaskDetail = () => {
    navigate({
      to: '/pm',
      search: activeProjectId ? { tab: 'tasks', projectId: activeProjectId } : { tab: 'tasks' },
    })
  }
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('pm:sidebar') === 'collapsed')
  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('pm:sidebar', next ? 'collapsed' : 'open')
      return next
    })
  }
  const confirmLogout = () =>
    modals.openConfirmModal({
      title: 'Keluar',
      children: <Text size="sm">Yakin ingin keluar dari sesi ini?</Text>,
      labels: { confirm: 'Keluar', cancel: 'Batal' },
      confirmProps: { color: 'red' },
      onConfirm: () => logout.mutate(),
    })

  const desktopWidth = collapsed ? 60 : 260
  const canAdmin = user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN'

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{
        width: desktopWidth,
        breakpoint: 'sm',
        collapsed: { mobile: !mobileOpened },
      }}
      padding="md"
      styles={{
        navbar: { backgroundColor: 'var(--app-navbar-bg)' },
        header: { backgroundColor: 'var(--app-navbar-bg)' },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="sm" />
            <ThemeIcon variant="light" color="blue" size="md">
              <TbTarget size={18} />
            </ThemeIcon>
            <Title order={4}>Manajer Proyek</Title>
          </Group>
          <Group gap="xs">
            <NotificationBell size="md" />
            <Badge color="blue" variant="light" size="sm">
              {user?.role}
            </Badge>
            <Text size="sm" visibleFrom="sm" c="dimmed">
              {user?.email}
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={collapsed && !isMobile ? 'xs' : 'md'}>
        <Stack gap="xs" style={{ flex: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon
            if (collapsed && !isMobile) {
              return (
                <Tooltip key={item.key} label={item.label} position="right" withArrow>
                  <ActionIcon
                    variant={active === item.key ? 'filled' : 'subtle'}
                    color={active === item.key ? 'blue' : 'gray'}
                    size="lg"
                    onClick={() => setActive(item.key)}
                  >
                    <Icon size={18} />
                  </ActionIcon>
                </Tooltip>
              )
            }
            return (
              <NavLink
                key={item.key}
                label={item.label}
                leftSection={<Icon size={18} />}
                rightSection={
                  item.badge ? (
                    <Badge size="xs" variant="light">
                      {item.badge}
                    </Badge>
                  ) : null
                }
                color="blue"
                active={active === item.key}
                onClick={() => setActive(item.key)}
              />
            )
          })}
        </Stack>

        <Stack gap="xs">
          {!collapsed || isMobile ? (
            <>
              {canAdmin && (
                <Button
                  variant="light"
                  leftSection={<TbSettings size={16} />}
                  onClick={() => navigate({ to: '/admin', search: { tab: 'overview' } })}
                  size="sm"
                >
                  Admin
                </Button>
              )}
              <Button
                variant="light"
                leftSection={<TbUser size={16} />}
                onClick={() => navigate({ to: '/settings' })}
                size="sm"
              >
                Pengaturan
              </Button>
              <Group justify="space-between">
                <ThemeToggle size="sm" />
                <ActionIcon variant="subtle" onClick={toggleSidebar} visibleFrom="sm" size="lg">
                  <TbLayoutSidebarLeftCollapse size={18} />
                </ActionIcon>
              </Group>
              <Button
                variant="light"
                color="red"
                leftSection={<TbLogout size={16} />}
                onClick={confirmLogout}
                loading={logout.isPending}
                size="sm"
              >
                Keluar
              </Button>
            </>
          ) : (
            <Stack gap="xs" align="center">
              {canAdmin && (
                <Tooltip label="Admin" position="right" withArrow>
                  <ActionIcon
                    variant="subtle"
                    size="lg"
                    onClick={() => navigate({ to: '/admin', search: { tab: 'overview' } })}
                  >
                    <TbSettings size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip label="Pengaturan" position="right" withArrow>
                <ActionIcon variant="subtle" size="lg" onClick={() => navigate({ to: '/settings' })}>
                  <TbUser size={18} />
                </ActionIcon>
              </Tooltip>
              <ThemeToggle size="sm" />
              <Tooltip label="Perluas sidebar" position="right" withArrow>
                <ActionIcon variant="subtle" onClick={toggleSidebar} size="lg">
                  <TbLayoutSidebarLeftExpand size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Keluar" position="right" withArrow>
                <ActionIcon variant="light" color="red" size="lg" onClick={confirmLogout} loading={logout.isPending}>
                  <TbLogout size={18} />
                </ActionIcon>
              </Tooltip>
            </Stack>
          )}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Container size="xl" px={0}>
          {active === 'overview' && (
            <OverviewPanel
              userName={user?.name ?? ''}
              onGoToTasks={() => setActive('tasks')}
              onGoToProjects={() => setActive('projects')}
            />
          )}
          {active === 'projects' &&
            (activeProjectId ? (
              <ProjectDetailView
                projectId={activeProjectId}
                tab={detailTab ?? 'overview'}
                onTabChange={setProjectDetailTab}
                onBack={closeProjectDetail}
                onDeleted={closeProjectDetail}
              />
            ) : (
              <ProjectsPanel />
            ))}
          {active === 'tasks' &&
            (activeTaskId ? (
              <TaskDetailView taskId={activeTaskId} onBack={closeTaskDetail} />
            ) : (
              <TasksPanel
                projectId={activeProjectId}
                onProjectChange={setTasksProjectFilter}
                onBackToProjects={() => setActive('projects')}
              />
            ))}
          {active === 'activity' && <ActivityPanel />}
          {active === 'team' && (
            <PlaceholderPanel
              title="Team"
              icon={TbUsers}
              description="See who's working on what, in real time. Coming in Phase 2."
            />
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

function OverviewPanel({
  userName,
  onGoToTasks,
  onGoToProjects,
}: {
  userName: string
  onGoToTasks: () => void
  onGoToProjects: () => void
}) {
  const projectsQ = useQuery<{ projects: Array<{ id: string; archivedAt: string | null; _count: { tasks: number } }> }>(
    {
      queryKey: ['projects'],
      queryFn: () => fetch('/api/projects', { credentials: 'include' }).then((r) => r.json()),
    },
  )
  const openTasksQ = useQuery<{ tasks: Array<{ id: string; kind: string }> }>({
    queryKey: ['tasks', 'status=OPEN'],
    queryFn: () => fetch('/api/tasks?status=OPEN', { credentials: 'include' }).then((r) => r.json()),
  })
  const myTasksQ = useQuery<{ tasks: Array<{ id: string }> }>({
    queryKey: ['tasks', 'mine=1'],
    queryFn: () => fetch('/api/tasks?mine=1', { credentials: 'include' }).then((r) => r.json()),
  })

  const projects = projectsQ.data?.projects ?? []
  const activeProjects = projects.filter((p) => !p.archivedAt)
  const openTasks = openTasksQ.data?.tasks ?? []
  const openBugs = openTasks.filter((t) => t.kind === 'BUG').length
  const myTasksCount = myTasksQ.data?.tasks?.length ?? 0

  return (
    <Stack gap="lg">
      <div>
        <Title order={2}>Halo, {userName.split(' ')[0]}</Title>
        <Text c="dimmed" size="sm">
          Ringkasan proyek kamu. Mulai proyek, pantau task, dan lihat pipeline bergerak.
        </Text>
      </div>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
        <StatCard label="Proyek Aktif" value={String(activeProjects.length)} icon={TbTarget} color="blue" />
        <StatCard label="Task Terbuka" value={String(openTasks.length)} icon={TbListCheck} color="orange" />
        <StatCard label="Bug Terbuka" value={String(openBugs)} icon={TbBug} color="red" />
        <StatCard label="Ditugaskan ke Saya" value={String(myTasksCount)} icon={TbActivity} color="grape" />
      </SimpleGrid>

      <Paper withBorder p="lg" radius="md">
        <Group justify="space-between" mb="md">
          <Title order={5}>Proyek Kamu</Title>
          <Group gap="xs">
            <Button variant="subtle" size="xs" onClick={onGoToTasks}>
              Lihat task
            </Button>
            <Button leftSection={<TbPlus size={14} />} size="xs" onClick={onGoToProjects}>
              Kelola
            </Button>
          </Group>
        </Group>
        {activeProjects.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="xl">
            Belum ada proyek aktif. Buat satu dari tab Proyek.
          </Text>
        ) : (
          <Stack gap="xs">
            {activeProjects.slice(0, 5).map((p) => (
              <Group
                key={p.id}
                justify="space-between"
                px="sm"
                py="xs"
                style={{ borderRadius: 6, cursor: 'pointer' }}
                onClick={onGoToProjects}
              >
                <Text size="sm">{(p as { name?: string }).name ?? p.id.slice(0, 8)}</Text>
                <Badge size="xs" variant="light">
                  {p._count.tasks} task
                </Badge>
              </Group>
            ))}
          </Stack>
        )}
      </Paper>
    </Stack>
  )
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: typeof TbLayoutDashboard
  color: string
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="xs" c="dimmed" fw={500} tt="uppercase">
            {label}
          </Text>
          <Text fw={700} size="xl">
            {value}
          </Text>
        </div>
        <ThemeIcon variant="light" color={color} size="lg" radius="md">
          <Icon size={20} />
        </ThemeIcon>
      </Group>
    </Card>
  )
}

function PlaceholderPanel({
  title,
  icon: Icon,
  description,
}: {
  title: string
  icon: typeof TbLayoutDashboard
  description: string
}) {
  return (
    <Paper withBorder p="xl" radius="md">
      <Stack align="center" gap="md" py="xl">
        <ThemeIcon variant="light" color="blue" size={60} radius="md">
          <Icon size={32} />
        </ThemeIcon>
        <Title order={3}>{title}</Title>
        <Text size="sm" c="dimmed" ta="center" maw={480}>
          {description}
        </Text>
      </Stack>
    </Paper>
  )
}
