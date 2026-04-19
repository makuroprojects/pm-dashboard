import { Badge, Group, Text } from '@mantine/core'
import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData } from '@mantine/spotlight'
import '@mantine/spotlight/styles.css'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo } from 'react'
import {
  TbActivity,
  TbCode,
  TbDeviceDesktop,
  TbLayoutDashboard,
  TbListCheck,
  TbSearch,
  TbSettings,
  TbShieldLock,
  TbTarget,
  TbUser,
  TbUsers,
} from 'react-icons/tb'

interface ProjectOption {
  id: string
  name: string
  myRole: 'OWNER' | 'PM' | 'MEMBER' | 'VIEWER' | null
  _count?: { tasks?: number }
}

interface TaskListItem {
  id: string
  title: string
  status: string
  priority: string
  kind: string
  project: { id: string; name: string }
}

interface SessionUser {
  id: string
  name: string
  email: string
  role: string
}

type CurrentRole = 'USER' | 'QC' | 'ADMIN' | 'SUPER_ADMIN'

export function CommandPalette() {
  const navigate = useNavigate()

  const sessionQ = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () =>
      fetch('/api/auth/session', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ user: SessionUser | null }>,
      ),
    staleTime: 60_000,
  })
  const user = sessionQ.data?.user ?? null
  const role = (user?.role ?? 'USER') as CurrentRole
  const canAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN'
  const isSuper = role === 'SUPER_ADMIN'

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: () =>
      fetch('/api/projects', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ projects: ProjectOption[] }>,
      ),
    enabled: !!user,
    staleTime: 60_000,
  })

  const tasksQ = useQuery({
    queryKey: ['tasks', 'palette'],
    queryFn: () =>
      fetch('/api/tasks', { credentials: 'include' }).then((r) => r.json() as Promise<{ tasks: TaskListItem[] }>),
    enabled: !!user,
    staleTime: 30_000,
  })

  const groups = useMemo<SpotlightActionGroupData[]>(() => {
    const navActions: SpotlightActionData[] = [
      {
        id: 'nav-pm-overview',
        label: 'Project Manager · Overview',
        description: 'Dashboard, stats, team presence',
        leftSection: <TbTarget size={16} />,
        keywords: ['pm', 'projects', 'overview', 'dashboard'],
        onClick: () => navigate({ to: '/pm', search: { tab: 'overview' } }),
      },
      {
        id: 'nav-pm-projects',
        label: 'Browse Projects',
        leftSection: <TbTarget size={16} />,
        keywords: ['pm', 'projects', 'list'],
        onClick: () => navigate({ to: '/pm', search: { tab: 'projects' } }),
      },
      {
        id: 'nav-pm-tasks',
        label: 'All Tasks',
        leftSection: <TbListCheck size={16} />,
        keywords: ['tasks', 'bugs', 'qc'],
        onClick: () => navigate({ to: '/pm', search: { tab: 'tasks' } }),
      },
      {
        id: 'nav-pm-activity',
        label: 'ActivityWatch Activity',
        leftSection: <TbActivity size={16} />,
        keywords: ['aw', 'activity', 'focus'],
        onClick: () => navigate({ to: '/pm', search: { tab: 'activity' } }),
      },
      {
        id: 'nav-pm-team',
        label: 'Team',
        leftSection: <TbUsers size={16} />,
        keywords: ['team', 'members', 'people'],
        onClick: () => navigate({ to: '/pm', search: { tab: 'team' } }),
      },
      {
        id: 'nav-settings',
        label: 'My Settings',
        description: 'Account, devices, preferences',
        leftSection: <TbSettings size={16} />,
        keywords: ['settings', 'profile', 'account', 'devices'],
        onClick: () => navigate({ to: '/settings' }),
      },
      {
        id: 'nav-my-devices',
        label: 'My Devices (pm-watch)',
        leftSection: <TbDeviceDesktop size={16} />,
        keywords: ['agents', 'devices', 'pmw'],
        onClick: () => navigate({ to: '/settings' }),
      },
      ...(canAdmin
        ? [
            {
              id: 'nav-admin',
              label: 'Admin Console',
              leftSection: <TbShieldLock size={16} />,
              keywords: ['admin', 'users', 'logs', 'console'],
              onClick: () => navigate({ to: '/admin', search: { tab: 'overview' } }),
            },
          ]
        : []),
      ...(isSuper
        ? [
            {
              id: 'nav-dev',
              label: 'Dev Console',
              description: 'Agents, webhooks, logs, schema',
              leftSection: <TbCode size={16} />,
              keywords: ['dev', 'agents', 'webhook', 'schema'],
              onClick: () => navigate({ to: '/dev', search: { tab: 'overview' } }),
            },
          ]
        : []),
    ]

    const projects = projectsQ.data?.projects ?? []
    const projectActions: SpotlightActionData[] = projects.map((p) => ({
      id: `project-${p.id}`,
      label: p.name,
      description: p.myRole ? `Project · ${p.myRole}` : 'Project',
      leftSection: <TbTarget size={16} />,
      keywords: ['project', p.name.toLowerCase(), ...(p.myRole ? [p.myRole.toLowerCase()] : [])],
      onClick: () => navigate({ to: '/pm', search: { tab: 'tasks', projectId: p.id } }),
    }))

    const tasks = (tasksQ.data?.tasks ?? []).slice(0, 40)
    const taskActions: SpotlightActionData[] = tasks.map((t) => ({
      id: `task-${t.id}`,
      label: t.title,
      description: `${t.project.name} · ${t.kind} · ${t.status.replace('_', ' ')} · ${t.priority}`,
      leftSection:
        t.kind === 'BUG' ? (
          <Badge size="xs" color="red" variant="light">
            BUG
          </Badge>
        ) : t.kind === 'QC' ? (
          <Badge size="xs" color="teal" variant="light">
            QC
          </Badge>
        ) : (
          <TbListCheck size={16} />
        ),
      keywords: ['task', t.kind.toLowerCase(), t.title.toLowerCase(), t.project.name.toLowerCase()],
      onClick: () => {
        window.dispatchEvent(
          new CustomEvent('pm:openTask', {
            detail: { taskId: t.id, projectId: t.project.id },
          }),
        )
      },
    }))

    const profileActions: SpotlightActionData[] = user
      ? [
          {
            id: 'me',
            label: `${user.name} (${user.email})`,
            description: `Signed in as ${user.role}`,
            leftSection: <TbUser size={16} />,
            keywords: ['me', 'profile', user.email],
            onClick: () => navigate({ to: '/settings' }),
          },
        ]
      : []

    return [
      { group: 'Navigate', actions: navActions },
      ...(projectActions.length ? [{ group: 'Projects', actions: projectActions }] : []),
      ...(taskActions.length ? [{ group: 'Tasks', actions: taskActions }] : []),
      ...(profileActions.length ? [{ group: 'You', actions: profileActions }] : []),
    ]
  }, [navigate, canAdmin, isSuper, projectsQ.data, tasksQ.data, user])

  if (!user) return null

  return (
    <Spotlight
      actions={groups}
      shortcut={['mod + k', 'mod + K']}
      nothingFound={
        <Group justify="center" py="md">
          <Text size="sm" c="dimmed">
            Nothing found. Try a different keyword.
          </Text>
        </Group>
      }
      highlightQuery
      searchProps={{
        leftSection: <TbSearch size={16} />,
        placeholder: 'Jump to project, task, or setting…',
      }}
      scrollable
      maxHeight={480}
      limit={20}
    />
  )
}

export function CommandPaletteHint() {
  return (
    <Badge size="xs" variant="light" color="gray" leftSection={<TbLayoutDashboard size={10} />}>
      ⌘K
    </Badge>
  )
}
