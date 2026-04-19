import {
  Avatar,
  Badge,
  Card,
  Divider,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  TbActivity,
  TbArrowRight,
  TbCircleCheck,
  TbListCheck,
  TbMessage,
  TbUsers,
  TbUsersGroup,
  TbWifi,
} from 'react-icons/tb'
import { EmptyState } from '@/frontend/components/shared/EmptyState'
import { usePresence } from '@/frontend/hooks/usePresence'

type Teammate = {
  id: string
  name: string
  email: string
  role: 'USER' | 'QC' | 'ADMIN' | 'SUPER_ADMIN'
  blocked: boolean
  sharedProjects: Array<{ projectId: string; projectName: string; myRole: string; theirRole: string }>
  openTasks: number
  overdueTasks: number
}

type TeamResponse = {
  teammates: Teammate[]
  projects: Array<{ id: string; name: string; myRole: string }>
}

type TeamActivityItem = {
  id: string
  kind: 'STATUS_CHANGE' | 'COMMENT'
  createdAt: string
  author: { id: string; name: string; email: string } | null
  task: { id: string; title: string; projectId: string }
  project: { id: string; name: string } | null
  detail: { fromStatus: string | null; toStatus: string | null; body: string | null }
}

type TeamActivityResponse = { activity: TeamActivityItem[] }

const ROLE_COLOR: Record<string, string> = {
  USER: 'blue',
  QC: 'teal',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
  OWNER: 'violet',
  PM: 'blue',
  MEMBER: 'gray',
  VIEWER: 'gray',
}

const STATUS_COLOR: Record<string, string> = {
  OPEN: 'gray',
  IN_PROGRESS: 'blue',
  READY_FOR_QC: 'cyan',
  REOPENED: 'orange',
  CLOSED: 'teal',
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const abs = Math.abs(diff)
  const mins = Math.floor(abs / 60_000)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  const suffix = diff >= 0 ? 'lalu' : 'lagi'
  if (days > 0) return `${days}h ${suffix}`
  if (hours > 0) return `${hours}j ${suffix}`
  if (mins > 0) return `${mins}m ${suffix}`
  return 'baru saja'
}

export function TeamPanel() {
  const navigate = useNavigate()
  const { onlineUserIds } = usePresence()
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds])
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<'load' | 'overdue' | 'name'>('load')

  const teamQ = useQuery<TeamResponse>({
    queryKey: ['me', 'team'],
    queryFn: () => fetch('/api/me/team', { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 60_000,
  })
  const activityQ = useQuery<TeamActivityResponse>({
    queryKey: ['me', 'team-activity'],
    queryFn: () => fetch('/api/me/team-activity?limit=30', { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 60_000,
  })

  const teammates = teamQ.data?.teammates ?? []
  const projects = teamQ.data?.projects ?? []
  const activity = activityQ.data?.activity ?? []

  const filtered = useMemo(() => {
    if (!projectFilter) return teammates
    return teammates.filter((t) => t.sharedProjects.some((p) => p.projectId === projectFilter))
  }, [teammates, projectFilter])

  const onlineTeammates = useMemo(() => filtered.filter((t) => onlineSet.has(t.id)), [filtered, onlineSet])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    if (sort === 'load') arr.sort((a, b) => b.openTasks - a.openTasks || a.name.localeCompare(b.name))
    else if (sort === 'overdue') arr.sort((a, b) => b.overdueTasks - a.overdueTasks || b.openTasks - a.openTasks)
    else arr.sort((a, b) => a.name.localeCompare(b.name))
    return arr
  }, [filtered, sort])

  const maxLoad = Math.max(10, ...sorted.map((t) => t.openTasks))

  const goToTaskList = (assigneeId: string) =>
    navigate({ to: '/pm', search: { tab: 'tasks', ...(projectFilter ? { projectId: projectFilter } : {}) } }).then(
      () => {
        // assigneeId stays in URL for future tasks filter support; for now just navigate to tasks.
        void assigneeId
      },
    )
  void goToTaskList

  const goToTaskDetail = (taskId: string, projectId: string) =>
    navigate({ to: '/pm', search: { tab: 'tasks', taskId, projectId } })

  const goToProject = (projectId: string) => navigate({ to: '/pm', search: { tab: 'projects', projectId } })

  return (
    <Stack gap="lg">
      <div>
        <Title order={3}>Tim</Title>
        <Text c="dimmed" size="sm">
          Teman se-proyek kamu — siapa online, siapa kelebihan beban, apa yang lagi terjadi.
        </Text>
      </div>

      {projects.length > 1 && (
        <Group gap="xs" wrap="wrap">
          <Text size="xs" c="dimmed">
            Proyek:
          </Text>
          <Badge
            variant={projectFilter === null ? 'filled' : 'light'}
            color="gray"
            size="sm"
            style={{ cursor: 'pointer' }}
            onClick={() => setProjectFilter(null)}
          >
            Semua
          </Badge>
          {projects.map((p) => (
            <Badge
              key={p.id}
              variant={projectFilter === p.id ? 'filled' : 'light'}
              color={ROLE_COLOR[p.myRole] ?? 'blue'}
              size="sm"
              style={{ cursor: 'pointer' }}
              onClick={() => setProjectFilter(projectFilter === p.id ? null : p.id)}
            >
              {p.name}
            </Badge>
          ))}
        </Group>
      )}

      {/* Section 1: Online Now */}
      <Paper withBorder p="lg" radius="md">
        <Group gap="xs" mb="md" justify="space-between">
          <Group gap="xs">
            <ThemeIcon variant="light" color="green" size="md" radius="md">
              <TbWifi size={16} />
            </ThemeIcon>
            <div>
              <Title order={5}>Online Sekarang</Title>
              <Text size="xs" c="dimmed">
                Teman yang aktif dalam sesi sekarang.
              </Text>
            </div>
          </Group>
          <Badge color="green" variant="light">
            {onlineTeammates.length}
          </Badge>
        </Group>
        {teamQ.isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            Memuat…
          </Text>
        ) : onlineTeammates.length === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            Tidak ada teman yang online saat ini.
          </Text>
        ) : (
          <Group gap="md" wrap="wrap">
            {onlineTeammates.map((t) => (
              <Tooltip key={t.id} label={t.email} withArrow>
                <Group gap="xs" wrap="nowrap">
                  <div style={{ position: 'relative' }}>
                    <Avatar color={ROLE_COLOR[t.role] ?? 'gray'} radius="xl" size="md">
                      {initials(t.name)}
                    </Avatar>
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        right: 0,
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        backgroundColor: 'var(--mantine-color-green-6)',
                        border: '2px solid var(--mantine-color-body)',
                      }}
                    />
                  </div>
                  <div>
                    <Text size="sm" fw={500}>
                      {t.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {t.role}
                    </Text>
                  </div>
                </Group>
              </Tooltip>
            ))}
          </Group>
        )}
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        {/* Section 2: Team Load */}
        <Paper withBorder p="lg" radius="md">
          <Group gap="xs" mb="md" justify="space-between">
            <Group gap="xs">
              <ThemeIcon variant="light" color="blue" size="md" radius="md">
                <TbListCheck size={16} />
              </ThemeIcon>
              <div>
                <Title order={5}>Beban Tim</Title>
                <Text size="xs" c="dimmed">
                  Task terbuka per teman di proyek yang kamu ikuti.
                </Text>
              </div>
            </Group>
            <SegmentedControl
              size="xs"
              value={sort}
              onChange={(v) => setSort(v as typeof sort)}
              data={[
                { label: 'Beban', value: 'load' },
                { label: 'Telat', value: 'overdue' },
                { label: 'Nama', value: 'name' },
              ]}
            />
          </Group>
          {teamQ.isLoading ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Memuat…
            </Text>
          ) : sorted.length === 0 ? (
            <EmptyState
              icon={TbUsersGroup}
              title="Belum ada teman se-proyek"
              message="Tambahkan anggota ke salah satu proyek kamu untuk melihat beban tim."
              variant="inline"
            />
          ) : (
            <Stack gap="sm">
              {sorted.map((t) => {
                const isOnline = onlineSet.has(t.id)
                const loadPercent = Math.min(100, (t.openTasks / maxLoad) * 100)
                const loadColor = t.openTasks >= 10 ? 'red' : t.openTasks >= 6 ? 'orange' : 'blue'
                return (
                  <div key={t.id}>
                    <Group justify="space-between" mb={4} wrap="nowrap">
                      <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                        <div style={{ position: 'relative' }}>
                          <Avatar color={ROLE_COLOR[t.role] ?? 'gray'} radius="xl" size="sm">
                            {initials(t.name)}
                          </Avatar>
                          {isOnline && (
                            <div
                              style={{
                                position: 'absolute',
                                bottom: -1,
                                right: -1,
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: 'var(--mantine-color-green-6)',
                                border: '2px solid var(--mantine-color-body)',
                              }}
                            />
                          )}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <Text size="sm" fw={500} truncate>
                            {t.name}
                          </Text>
                          <Text size="xs" c="dimmed" truncate>
                            {t.sharedProjects.length} proyek bersama
                          </Text>
                        </div>
                      </Group>
                      <Group gap="xs" wrap="nowrap">
                        {t.overdueTasks > 0 && (
                          <Badge color="red" variant="light" size="sm">
                            {t.overdueTasks} telat
                          </Badge>
                        )}
                        <Badge color={loadColor} variant="light" size="sm">
                          {t.openTasks} task
                        </Badge>
                      </Group>
                    </Group>
                    <Progress value={loadPercent} color={loadColor} size="sm" radius="xl" />
                  </div>
                )
              })}
            </Stack>
          )}
        </Paper>

        {/* Section 4: Team Activity */}
        <Paper withBorder p="lg" radius="md">
          <Group gap="xs" mb="md">
            <ThemeIcon variant="light" color="grape" size="md" radius="md">
              <TbActivity size={16} />
            </ThemeIcon>
            <div>
              <Title order={5}>Aktivitas Tim</Title>
              <Text size="xs" c="dimmed">
                Perubahan status & komentar di proyek kamu, 7 hari terakhir.
              </Text>
            </div>
          </Group>
          {activityQ.isLoading ? (
            <Text size="sm" c="dimmed" ta="center" py="md">
              Memuat…
            </Text>
          ) : activity.length === 0 ? (
            <EmptyState
              icon={TbActivity}
              title="Belum ada aktivitas tim"
              message="Status task atau komentar baru akan muncul di sini saat tim mulai bergerak."
              variant="inline"
            />
          ) : (
            <Stack gap={4}>
              {activity.slice(0, 12).map((a) => (
                <UnstyledButton
                  key={a.id}
                  onClick={() => goToTaskDetail(a.task.id, a.task.projectId)}
                  style={{ borderRadius: 6, padding: '8px 10px' }}
                >
                  <Group gap="sm" wrap="nowrap" align="flex-start">
                    <ThemeIcon variant="light" color={a.kind === 'COMMENT' ? 'grape' : 'teal'} size="sm" radius="xl">
                      {a.kind === 'COMMENT' ? <TbMessage size={12} /> : <TbCircleCheck size={12} />}
                    </ThemeIcon>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6} wrap="nowrap">
                        <Text size="sm" fw={500}>
                          {a.author?.name ?? 'Seseorang'}
                        </Text>
                        {a.kind === 'STATUS_CHANGE' && a.detail.fromStatus && a.detail.toStatus ? (
                          <Group gap={4} wrap="nowrap">
                            <Badge size="xs" variant="light" color={STATUS_COLOR[a.detail.fromStatus] ?? 'gray'}>
                              {a.detail.fromStatus}
                            </Badge>
                            <TbArrowRight size={12} />
                            <Badge size="xs" variant="light" color={STATUS_COLOR[a.detail.toStatus] ?? 'gray'}>
                              {a.detail.toStatus}
                            </Badge>
                          </Group>
                        ) : (
                          <Text size="xs" c="dimmed">
                            berkomentar
                          </Text>
                        )}
                      </Group>
                      <Text size="sm" truncate>
                        {a.task.title}
                      </Text>
                      {a.kind === 'COMMENT' && a.detail.body && (
                        <Text size="xs" c="dimmed" truncate>
                          “{a.detail.body}”
                        </Text>
                      )}
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" c="dimmed" truncate>
                          {a.project?.name ?? ''}
                        </Text>
                        <Text size="xs" c="dimmed">
                          · {formatRelativeTime(a.createdAt)}
                        </Text>
                      </Group>
                    </div>
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          )}
        </Paper>
      </SimpleGrid>

      {/* Section 3: Directory */}
      <Paper withBorder p="lg" radius="md">
        <Group gap="xs" mb="md" justify="space-between">
          <Group gap="xs">
            <ThemeIcon variant="light" color="violet" size="md" radius="md">
              <TbUsers size={16} />
            </ThemeIcon>
            <div>
              <Title order={5}>Direktori Teman</Title>
              <Text size="xs" c="dimmed">
                Semua teman yang berbagi proyek dengan kamu.
              </Text>
            </div>
          </Group>
          <Badge variant="light">{sorted.length} orang</Badge>
        </Group>
        {teamQ.isLoading ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            Memuat…
          </Text>
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={TbUsers}
            title="Belum ada teman se-proyek"
            message="Tambahkan anggota ke salah satu proyek kamu dari tab Proyek."
            variant="inline"
          />
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
            {sorted.map((t) => {
              const isOnline = onlineSet.has(t.id)
              return (
                <Card key={t.id} withBorder padding="md" radius="md">
                  <Group gap="sm" mb="sm" wrap="nowrap">
                    <div style={{ position: 'relative' }}>
                      <Avatar color={ROLE_COLOR[t.role] ?? 'gray'} radius="xl" size="md">
                        {initials(t.name)}
                      </Avatar>
                      {isOnline && (
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            right: 0,
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            backgroundColor: 'var(--mantine-color-green-6)',
                            border: '2px solid var(--mantine-color-body)',
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {t.name}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {t.email}
                      </Text>
                    </div>
                    <Badge color={ROLE_COLOR[t.role] ?? 'gray'} variant="light" size="xs">
                      {t.role}
                    </Badge>
                  </Group>
                  <Group gap="xs" mb="sm">
                    <Badge variant="light" color="blue" size="xs">
                      {t.openTasks} task
                    </Badge>
                    {t.overdueTasks > 0 && (
                      <Badge variant="light" color="red" size="xs">
                        {t.overdueTasks} telat
                      </Badge>
                    )}
                  </Group>
                  <Divider mb="xs" />
                  <Text size="xs" c="dimmed" fw={500} mb={4}>
                    PROYEK BERSAMA
                  </Text>
                  <Stack gap={2}>
                    {t.sharedProjects.slice(0, 3).map((p) => (
                      <UnstyledButton
                        key={p.projectId}
                        onClick={() => goToProject(p.projectId)}
                        style={{ borderRadius: 4, padding: '2px 4px' }}
                      >
                        <Group gap="xs" wrap="nowrap">
                          <Text size="xs" truncate style={{ flex: 1 }}>
                            {p.projectName}
                          </Text>
                          <Badge size="xs" variant="dot" color={ROLE_COLOR[p.theirRole] ?? 'gray'}>
                            {p.theirRole}
                          </Badge>
                        </Group>
                      </UnstyledButton>
                    ))}
                    {t.sharedProjects.length > 3 && (
                      <Text size="xs" c="dimmed">
                        +{t.sharedProjects.length - 3} proyek lainnya
                      </Text>
                    )}
                  </Stack>
                </Card>
              )
            })}
          </SimpleGrid>
        )}
      </Paper>
    </Stack>
  )
}
