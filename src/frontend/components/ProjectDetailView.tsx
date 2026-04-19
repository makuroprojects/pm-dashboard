import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Code,
  CopyButton,
  Group,
  Loader,
  Progress,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { DateInput } from '@mantine/dates'
import { useHotkeys } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  TbAlertTriangle,
  TbArrowLeft,
  TbBrandGithub,
  TbCalendarEvent,
  TbChecks,
  TbClock,
  TbCopy,
  TbFlag,
  TbHistory,
  TbListCheck,
  TbRefresh,
  TbReport,
  TbSettings,
  TbTarget,
  TbTrash,
  TbUsers,
} from 'react-icons/tb'
import { useSession } from '../hooks/useAuth'
import { notifyError, notifySuccess } from '../lib/notify'
import {
  ExtensionsSection,
  MembersSection,
  MilestonesSection,
  type ProjectDetail,
  type ProjectListItem,
  type ProjectPriority,
  type ProjectStatus,
} from './ProjectsPanel'
import { RetroTab } from './RetroTab'
import { Breadcrumbs } from './shared/Breadcrumbs'
import { TasksPanel } from './TasksPanel'

export const PROJECT_DETAIL_TABS = [
  'overview',
  'tasks',
  'team',
  'milestones',
  'extensions',
  'retro',
  'settings',
] as const
export type ProjectDetailTab = (typeof PROJECT_DETAIL_TABS)[number]

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const STATUS_COLOR: Record<ProjectStatus, string> = {
  DRAFT: 'gray',
  ACTIVE: 'blue',
  ON_HOLD: 'yellow',
  COMPLETED: 'green',
  CANCELLED: 'dark',
}

const PRIORITY_COLOR: Record<ProjectPriority, string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

const ROLE_COLOR: Record<string, string> = {
  OWNER: 'red',
  PM: 'violet',
  MEMBER: 'blue',
  VIEWER: 'gray',
}

const STATUS_OPTIONS: Array<{ value: ProjectStatus; label: string }> = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ON_HOLD', label: 'On hold' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const PRIORITY_OPTIONS: Array<{ value: ProjectPriority; label: string }> = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function computeOverdue(p: Pick<ProjectListItem, 'endsAt' | 'status'>): { overdue: boolean; daysOver: number } {
  if (!p.endsAt) return { overdue: false, daysOver: 0 }
  if (p.status === 'COMPLETED' || p.status === 'CANCELLED') return { overdue: false, daysOver: 0 }
  const end = new Date(p.endsAt).getTime()
  const now = Date.now()
  if (end >= now) return { overdue: false, daysOver: 0 }
  return { overdue: true, daysOver: Math.round((now - end) / (24 * 3600 * 1000)) }
}

function computeTimeProgress(p: Pick<ProjectListItem, 'startsAt' | 'endsAt'>): number | null {
  if (!p.startsAt || !p.endsAt) return null
  const start = new Date(p.startsAt).getTime()
  const end = new Date(p.endsAt).getTime()
  const now = Date.now()
  if (end <= start) return null
  if (now <= start) return 0
  if (now >= end) return 100
  return Math.round(((now - start) / (end - start)) * 100)
}

function isSystemAdmin(role: string | null | undefined): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN'
}

function computeCanManage(myRole: string | null, systemRole: string | null | undefined): boolean {
  if (isSystemAdmin(systemRole)) return true
  return myRole === 'OWNER' || myRole === 'PM'
}

export function ProjectDetailView({
  projectId,
  tab,
  onTabChange,
  onBack,
  onDeleted,
}: {
  projectId: string
  tab: ProjectDetailTab
  onTabChange: (tab: ProjectDetailTab) => void
  onBack: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const session = useSession()
  const systemRole = session.data?.user?.role ?? null
  const detailQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api<{ project: ProjectDetail; myRole: string | null }>(`/api/projects/${projectId}`),
  })

  const project = detailQ.data?.project

  useHotkeys([['Escape', onBack]])

  const tabCounts = project?._count

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
          <Tooltip label="Kembali ke daftar proyek (Esc)">
            <ActionIcon variant="subtle" size="lg" onClick={onBack} aria-label="Back">
              <TbArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Breadcrumbs
            items={[{ label: 'Projects', onClick: onBack }, { label: project?.name ?? projectId.slice(0, 8) }]}
          />
          {project && (
            <CopyButton value={project.id} timeout={1500}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'ID disalin' : 'Salin project ID'}>
                  <ActionIcon variant="subtle" size="sm" onClick={copy} color={copied ? 'teal' : 'gray'}>
                    {copied ? <TbChecks size={14} /> : <TbCopy size={14} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
        </Group>
        <Group gap="xs">
          {detailQ.isFetching && !detailQ.isLoading && (
            <Badge variant="dot" color="blue" size="sm">
              Sinkronisasi…
            </Badge>
          )}
          <Tooltip label="Refresh data">
            <ActionIcon variant="light" size="lg" onClick={() => detailQ.refetch()} loading={detailQ.isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {detailQ.isLoading ? (
        <Stack gap="md">
          <Card withBorder padding="md" radius="md">
            <Group gap="sm" align="flex-start">
              <Skeleton height={48} width={48} radius="md" />
              <Stack gap={6} style={{ flex: 1 }}>
                <Skeleton height={24} width="40%" />
                <Group gap={6}>
                  <Skeleton height={18} width={60} radius="xl" />
                  <Skeleton height={18} width={70} radius="xl" />
                  <Skeleton height={18} width={50} radius="xl" />
                </Group>
                <Skeleton height={14} width="80%" />
              </Stack>
            </Group>
          </Card>
          <Group gap="xs">
            {PROJECT_DETAIL_TABS.map((t) => (
              <Skeleton key={t} height={34} width={110} radius="sm" />
            ))}
          </Group>
          <Card withBorder padding="md" radius="md">
            <Stack gap="sm">
              <Skeleton height={18} width="30%" />
              <Skeleton height={120} />
              <Skeleton height={80} />
            </Stack>
          </Card>
        </Stack>
      ) : detailQ.error ? (
        <Alert color="red" icon={<TbAlertTriangle size={18} />} title="Gagal memuat proyek" radius="md">
          <Stack gap="sm">
            <Text size="sm">{(detailQ.error as Error).message}</Text>
            <Group>
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={() => detailQ.refetch()}
                leftSection={<TbRefresh size={14} />}
              >
                Coba lagi
              </Button>
              <Button size="xs" variant="subtle" onClick={onBack}>
                Kembali
              </Button>
            </Group>
          </Stack>
        </Alert>
      ) : !project ? (
        <Alert color="yellow" icon={<TbAlertTriangle size={18} />} radius="md">
          Proyek tidak ditemukan atau kamu tidak punya akses.
        </Alert>
      ) : (
        <>
          <ProjectHeader project={project} systemRole={systemRole} />

          <Tabs value={tab} onChange={(v) => v && onTabChange(v as ProjectDetailTab)} keepMounted={false}>
            <Tabs.List>
              <Tabs.Tab value="overview" leftSection={<TbTarget size={14} />}>
                Overview
              </Tabs.Tab>
              <Tabs.Tab
                value="tasks"
                leftSection={<TbListCheck size={14} />}
                rightSection={<TabCount value={tabCounts?.tasks} />}
              >
                Tasks
              </Tabs.Tab>
              <Tabs.Tab
                value="team"
                leftSection={<TbUsers size={14} />}
                rightSection={<TabCount value={tabCounts?.members} />}
              >
                Team
              </Tabs.Tab>
              <Tabs.Tab
                value="milestones"
                leftSection={<TbFlag size={14} />}
                rightSection={<TabCount value={tabCounts?.milestones} />}
              >
                Milestones
              </Tabs.Tab>
              <Tabs.Tab value="extensions" leftSection={<TbHistory size={14} />}>
                Extensions
              </Tabs.Tab>
              <Tabs.Tab value="retro" leftSection={<TbReport size={14} />}>
                Retro
              </Tabs.Tab>
              <Tabs.Tab value="settings" leftSection={<TbSettings size={14} />}>
                Settings
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="overview" pt="md">
              <OverviewTab project={project} onOpenTasks={() => onTabChange('tasks')} />
            </Tabs.Panel>
            <Tabs.Panel value="tasks" pt="md">
              <TasksPanel projectId={project.id} />
            </Tabs.Panel>
            <Tabs.Panel value="team" pt="md">
              <MembersSection
                projectId={project.id}
                myRole={project.myRole}
                systemRole={systemRole}
                ownerId={project.ownerId}
              />
            </Tabs.Panel>
            <Tabs.Panel value="milestones" pt="md">
              <MilestonesSection projectId={project.id} canManage={computeCanManage(project.myRole, systemRole)} />
            </Tabs.Panel>
            <Tabs.Panel value="extensions" pt="md">
              <ExtensionsSection
                projectId={project.id}
                currentEndAt={project.endsAt}
                startsAt={project.startsAt}
                canExtend={computeCanManage(project.myRole, systemRole)}
              />
            </Tabs.Panel>
            <Tabs.Panel value="retro" pt="md">
              <RetroTab projectId={project.id} />
            </Tabs.Panel>
            <Tabs.Panel value="settings" pt="md">
              <SettingsTab
                project={project}
                systemRole={systemRole}
                onDeleted={() => {
                  qc.invalidateQueries({ queryKey: ['projects'] })
                  qc.invalidateQueries({ queryKey: ['milestones', 'all'] })
                  onDeleted()
                }}
              />
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </Stack>
  )
}

function TabCount({ value }: { value?: number }) {
  if (value === undefined) return null
  return (
    <Badge size="xs" variant="light" color="gray" circle>
      {value}
    </Badge>
  )
}

function ProjectHeader({ project, systemRole }: { project: ProjectDetail; systemRole: string | null }) {
  const { overdue, daysOver } = computeOverdue(project)
  const extended =
    project.originalEndAt &&
    project.endsAt &&
    new Date(project.endsAt).getTime() !== new Date(project.originalEndAt).getTime()

  return (
    <Stack gap="xs">
      <Group gap="sm" align="flex-start" wrap="nowrap">
        <ThemeIcon variant="light" color={STATUS_COLOR[project.status]} size="xl" radius="md">
          <TbTarget size={22} />
        </ThemeIcon>
        <Stack gap={4} style={{ flex: 1, minWidth: 0 }}>
          <Title order={2} style={{ lineHeight: 1.2 }}>
            {project.name}
          </Title>
          <Group gap={6} wrap="wrap">
            <Badge color={STATUS_COLOR[project.status]} variant="light" size="sm">
              {project.status.replace('_', ' ')}
            </Badge>
            <Badge color={PRIORITY_COLOR[project.priority]} variant="dot" size="sm">
              {project.priority}
            </Badge>
            {project.myRole ? (
              <Badge color={ROLE_COLOR[project.myRole] ?? 'gray'} variant="light" size="sm">
                {project.myRole}
              </Badge>
            ) : isSystemAdmin(systemRole) ? (
              <Badge color="gray" variant="outline" size="sm">
                ADMIN VIEW
              </Badge>
            ) : null}
            {overdue && (
              <Badge color="red" variant="filled" size="sm" leftSection={<TbAlertTriangle size={10} />}>
                Overdue {daysOver}d
              </Badge>
            )}
            {extended && (
              <Tooltip label={`Original deadline: ${formatDate(project.originalEndAt)}`}>
                <Badge color="grape" variant="light" size="sm">
                  Extended
                </Badge>
              </Tooltip>
            )}
          </Group>
          {project.description && (
            <Text size="sm" c="dimmed">
              {project.description}
            </Text>
          )}
        </Stack>
      </Group>
    </Stack>
  )
}

function OverviewTab({ project, onOpenTasks }: { project: ProjectDetail; onOpenTasks: () => void }) {
  const timeProgress = computeTimeProgress(project)
  const { overdue } = computeOverdue(project)
  const ts = project.taskStats
  const ms = project.milestoneStats

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
        <StatMini label="Members" value={String(project._count.members)} icon={TbUsers} color="blue" />
        <StatMini
          label="Tasks"
          value={`${ts?.closed ?? 0}/${ts?.total ?? project._count.tasks}`}
          icon={TbListCheck}
          color="orange"
        />
        <StatMini
          label="Milestones"
          value={`${ms?.done ?? 0}/${ms?.total ?? project._count.milestones}`}
          icon={TbFlag}
          color="grape"
        />
        <StatMini
          label="Timeline"
          value={timeProgress !== null ? `${timeProgress}%` : '—'}
          icon={TbClock}
          color={overdue ? 'red' : 'teal'}
        />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card withBorder padding="md" radius="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Dates
              </Text>
              <Text size="xs" c="dimmed">
                Start → End
              </Text>
            </Group>
            <Group gap={6}>
              <TbCalendarEvent size={14} />
              <Text size="sm">
                {formatDate(project.startsAt)} → {formatDate(project.endsAt)}
              </Text>
            </Group>
            {project.originalEndAt && (
              <Text size="xs" c="dimmed">
                Original deadline: {formatDate(project.originalEndAt)}
              </Text>
            )}
            {timeProgress !== null && (
              <div>
                <Group justify="space-between" gap={4}>
                  <Text size="xs" c="dimmed">
                    Time elapsed
                  </Text>
                  <Text size="xs" c={overdue ? 'red' : 'dimmed'}>
                    {timeProgress}%
                  </Text>
                </Group>
                <Progress
                  value={timeProgress}
                  size="sm"
                  mt={4}
                  color={overdue ? 'red' : timeProgress > 80 ? 'orange' : 'blue'}
                />
              </div>
            )}
          </Stack>
        </Card>

        <Card withBorder padding="md" radius="md">
          <Stack gap="xs">
            <Group justify="space-between">
              <Text fw={600} size="sm">
                Task progress
              </Text>
              <Button size="compact-xs" variant="subtle" onClick={onOpenTasks}>
                Open tasks
              </Button>
            </Group>
            {ts && ts.total > 0 ? (
              <>
                <Group justify="space-between" gap={4}>
                  <Group gap={4}>
                    <TbChecks size={14} />
                    <Text size="xs" c="dimmed">
                      {ts.closed} closed · {ts.inProgress} in progress · {ts.readyForQc} QC · {ts.open + ts.reopened}{' '}
                      open
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {Math.round((ts.closed / ts.total) * 100)}%
                  </Text>
                </Group>
                <Progress.Root size="sm" mt={4}>
                  <Progress.Section value={(ts.closed / ts.total) * 100} color="green" />
                  <Progress.Section value={(ts.readyForQc / ts.total) * 100} color="teal" />
                  <Progress.Section value={(ts.inProgress / ts.total) * 100} color="blue" />
                  <Progress.Section value={((ts.open + ts.reopened) / ts.total) * 100} color="gray" />
                </Progress.Root>
              </>
            ) : (
              <Text size="sm" c="dimmed">
                No tasks yet.
              </Text>
            )}
          </Stack>
        </Card>
      </SimpleGrid>

      <Card withBorder padding="md" radius="md">
        <Stack gap="xs">
          <Text fw={600} size="sm">
            Team
          </Text>
          {project.members.length === 0 ? (
            <Text size="sm" c="dimmed">
              No members yet.
            </Text>
          ) : (
            <Stack gap={6}>
              {project.members.map((m) => (
                <Group key={m.id} justify="space-between" wrap="nowrap">
                  <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                    <Text size="sm" fw={500} truncate>
                      {m.user.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {m.user.email}
                    </Text>
                  </Group>
                  <Badge color={ROLE_COLOR[m.role] ?? 'gray'} variant="light" size="sm">
                    {m.role}
                  </Badge>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>

      <GithubActivityCard project={project} />
    </Stack>
  )
}

type GithubEventKind = 'PUSH_COMMIT' | 'PR_OPENED' | 'PR_CLOSED' | 'PR_MERGED' | 'PR_REVIEWED'

interface GithubContributor {
  login: string
  commits: number
}

interface GithubOpenPr {
  prNumber: number | null
  title: string
  url: string
  actorLogin: string
  createdAt: string
}

interface GithubRecentEvent {
  id: string
  kind: GithubEventKind
  actorLogin: string
  actorEmail: string | null
  title: string
  url: string
  sha: string | null
  prNumber: number | null
  createdAt: string
  matchedUser: { id: string; name: string; email: string } | null
}

interface GithubSummary {
  linked: boolean
  repo: string | null
  stats?: {
    commits7d: number
    commits30d: number
    contributors30d: number
    openPrs: number
    lastPushAt: string | null
    lastPushBy: string | null
  }
  contributors?: GithubContributor[]
  openPrs?: GithubOpenPr[]
  recent?: GithubRecentEvent[]
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return 'just now'
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const EVENT_KIND_COLOR: Record<GithubRecentEvent['kind'], string> = {
  PUSH_COMMIT: 'blue',
  PR_OPENED: 'teal',
  PR_CLOSED: 'gray',
  PR_MERGED: 'grape',
  PR_REVIEWED: 'yellow',
}

const EVENT_KIND_LABEL: Record<GithubRecentEvent['kind'], string> = {
  PUSH_COMMIT: 'commit',
  PR_OPENED: 'PR opened',
  PR_CLOSED: 'PR closed',
  PR_MERGED: 'PR merged',
  PR_REVIEWED: 'PR reviewed',
}

function GithubActivityCard({ project }: { project: ProjectDetail }) {
  const linked = !!project.githubRepo
  const q = useQuery({
    queryKey: ['project-github-summary', project.id],
    queryFn: () => api<GithubSummary>(`/api/projects/${project.id}/github/summary`),
    enabled: linked,
    staleTime: 30_000,
  })

  if (!linked) {
    return (
      <Card withBorder padding="md" radius="md">
        <Stack gap="xs" align="flex-start">
          <Group gap="xs">
            <ThemeIcon variant="light" size="md" radius="sm">
              <TbBrandGithub size={16} />
            </ThemeIcon>
            <Text fw={600} size="sm">
              GitHub activity
            </Text>
          </Group>
          <Text size="sm" c="dimmed">
            No repo linked yet. Add a GitHub repo in Settings to pull in commits, pull requests, and reviews.
          </Text>
        </Stack>
      </Card>
    )
  }

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            <ThemeIcon variant="light" size="md" radius="sm">
              <TbBrandGithub size={16} />
            </ThemeIcon>
            <Text fw={600} size="sm">
              GitHub activity
            </Text>
            {project.githubRepo && (
              <Anchor
                size="xs"
                c="dimmed"
                href={`https://github.com/${project.githubRepo}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {project.githubRepo}
              </Anchor>
            )}
          </Group>
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" size="sm" onClick={() => q.refetch()} loading={q.isFetching}>
              <TbRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {q.isLoading ? (
          <Group gap="xs">
            <Loader size="xs" />
            <Text size="sm" c="dimmed">
              Loading activity…
            </Text>
          </Group>
        ) : q.error ? (
          <Alert color="red" title="Failed to load GitHub activity">
            {(q.error as Error).message}
          </Alert>
        ) : q.data?.stats ? (
          <>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
              <MiniStat label="Commits / 7d" value={String(q.data.stats.commits7d)} />
              <MiniStat label="Contributors / 30d" value={String(q.data.stats.contributors30d)} />
              <MiniStat label="Open PRs" value={String(q.data.stats.openPrs)} />
              <MiniStat label="Last push" value={formatRelativeTime(q.data.stats.lastPushAt)} />
            </SimpleGrid>

            {!q.data.recent || q.data.recent.length === 0 ? (
              <Text size="sm" c="dimmed">
                No activity received yet. Once the webhook fires, events will appear here.
              </Text>
            ) : (
              <Stack gap={4} mt="xs">
                <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                  Recent events
                </Text>
                {q.data.recent.slice(0, 10).map((ev) => (
                  <Group key={ev.id} gap="xs" wrap="nowrap" align="flex-start">
                    <Badge color={EVENT_KIND_COLOR[ev.kind]} variant="light" size="xs" style={{ flexShrink: 0 }}>
                      {EVENT_KIND_LABEL[ev.kind]}
                    </Badge>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <Text size="sm" truncate>
                        {ev.kind === 'PUSH_COMMIT'
                          ? ev.title || ev.sha?.slice(0, 7) || 'commit'
                          : `#${ev.prNumber ?? '?'} ${ev.title}`}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {ev.matchedUser?.name ?? ev.actorLogin} · {formatRelativeTime(ev.createdAt)}
                        {ev.url && (
                          <>
                            {' · '}
                            <Anchor size="xs" href={ev.url} target="_blank" rel="noreferrer noopener">
                              view
                            </Anchor>
                          </>
                        )}
                      </Text>
                    </div>
                  </Group>
                ))}
              </Stack>
            )}
          </>
        ) : null}
      </Stack>
    </Card>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
        {label}
      </Text>
      <Text fw={700} size="lg">
        {value}
      </Text>
    </div>
  )
}

function StatMini({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: string
  icon: typeof TbTarget
  color: string
}) {
  return (
    <Card withBorder padding="md" radius="md">
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

function previewGithubRepo(input: string): string | null {
  const s = input
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  if (!s) return null
  const https = s.match(/^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i)
  if (https) return `${https[1]}/${https[2]}`.toLowerCase()
  const ssh = s.match(/^git@github\.com:([^/]+)\/([^/?#]+)/i)
  if (ssh) return `${ssh[1]}/${ssh[2]}`.toLowerCase()
  const plain = s.match(/^([A-Za-z0-9][A-Za-z0-9-_.]*)\/([A-Za-z0-9][A-Za-z0-9-_.]*)$/)
  if (plain) return `${plain[1]}/${plain[2]}`.toLowerCase()
  return null
}

function SettingsTab({
  project,
  systemRole,
  onDeleted,
}: {
  project: ProjectDetail
  systemRole: string | null
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [status, setStatus] = useState<ProjectStatus>(project.status)
  const [priority, setPriority] = useState<ProjectPriority>(project.priority)
  const [startsAt, setStartsAt] = useState<Date | null>(project.startsAt ? new Date(project.startsAt) : null)
  const [endsAt, setEndsAt] = useState<Date | null>(project.endsAt ? new Date(project.endsAt) : null)
  const [githubRepoInput, setGithubRepoInput] = useState(project.githubRepo ?? '')

  const update = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ project: ProjectDetail }>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', project.id] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      notifySuccess({ message: 'Project disimpan.' })
    },
    onError: (err) => notifyError(err),
  })

  const remove = useMutation({
    mutationFn: () => api<{ ok: true }>(`/api/projects/${project.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      notifySuccess({ message: 'Project dihapus.' })
      onDeleted()
    },
    onError: (err) => notifyError(err),
  })

  const invalidRange = startsAt && endsAt && endsAt < startsAt
  const endChanged = endsAt?.getTime() !== (project.endsAt ? new Date(project.endsAt).getTime() : null)
  const isExtending = project.endsAt && endsAt && endsAt.getTime() > new Date(project.endsAt).getTime()
  const canSave = !!name.trim() && !invalidRange && !update.isPending
  const canManage = computeCanManage(project.myRole, systemRole)
  const canDelete = project.myRole === 'OWNER' || systemRole === 'SUPER_ADMIN'

  const confirmDelete = () => {
    modals.openConfirmModal({
      title: 'Delete project permanently',
      centered: true,
      children: (
        <Stack gap="xs">
          <Text size="sm">
            You're about to delete <b>{project.name}</b>.
          </Text>
          <Text size="sm" c="red">
            This cascades to {project._count.tasks} task(s), {project._count.members} member(s), and{' '}
            {project._count.milestones} milestone(s). This cannot be undone.
          </Text>
        </Stack>
      ),
      labels: { confirm: 'Delete forever', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => remove.mutate(),
    })
  }

  return (
    <Stack gap="md" maw={720}>
      <Card withBorder padding="md" radius="md">
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Project details
          </Text>
          <TextInput
            label="Name"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            required
            disabled={!canManage}
          />
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
            autosize
            minRows={2}
            maxRows={6}
            disabled={!canManage}
          />
          <Group grow>
            <Select
              label="Status"
              data={STATUS_OPTIONS}
              value={status}
              onChange={(v) => v && setStatus(v as ProjectStatus)}
              disabled={!canManage}
            />
            <Select
              label="Priority"
              data={PRIORITY_OPTIONS}
              value={priority}
              onChange={(v) => v && setPriority(v as ProjectPriority)}
              disabled={!canManage}
            />
          </Group>
          <Group grow>
            <DateInput
              label="Start date"
              placeholder="Optional"
              value={startsAt}
              onChange={(v) => setStartsAt(v ? new Date(v as unknown as string) : null)}
              clearable
              leftSection={<TbClock size={14} />}
              disabled={!canManage}
            />
            <DateInput
              label="End date"
              placeholder="Optional"
              value={endsAt}
              onChange={(v) => setEndsAt(v ? new Date(v as unknown as string) : null)}
              clearable
              leftSection={<TbCalendarEvent size={14} />}
              error={invalidRange ? 'End must be after start' : undefined}
              disabled={!canManage}
            />
          </Group>
          {project.originalEndAt && (
            <Text size="xs" c="dimmed">
              Original deadline: {formatDate(project.originalEndAt)}
              {isExtending ? ' · you are extending this' : ''}
            </Text>
          )}
          {endChanged && project.originalEndAt && (
            <Text size="xs" c="grape">
              Note: edits to end date via Save don't record a reason. Use the Extensions tab to log an audited
              extension.
            </Text>
          )}
          {update.error && (
            <Text size="sm" c="red">
              {(update.error as Error).message}
            </Text>
          )}
          {canManage && (
            <Group justify="flex-end">
              <Button
                disabled={!canSave}
                loading={update.isPending}
                onClick={() =>
                  update.mutate({
                    name: name.trim(),
                    description: description.trim() || null,
                    status,
                    priority,
                    startsAt: startsAt ? startsAt.toISOString() : null,
                    endsAt: endsAt ? endsAt.toISOString() : null,
                  })
                }
              >
                Save changes
              </Button>
            </Group>
          )}
        </Stack>
      </Card>

      <GithubIntegrationCard
        project={project}
        canManage={canManage}
        value={githubRepoInput}
        onChange={setGithubRepoInput}
        onSave={(repo) => update.mutate({ githubRepo: repo })}
        onUnlink={() => update.mutate({ githubRepo: null })}
        saving={update.isPending}
        error={update.error as Error | null}
      />

      {canDelete && (
        <Card withBorder padding="md" radius="md" style={{ borderColor: 'var(--mantine-color-red-4)' }}>
          <Stack gap="sm">
            <Text fw={600} size="sm" c="red">
              Danger zone
            </Text>
            <Text size="sm" c="dimmed">
              Deleting a project permanently removes it along with all its tasks, members, milestones, and activity
              history. This cannot be undone.
            </Text>
            {remove.error && (
              <Text size="sm" c="red">
                {(remove.error as Error).message}
              </Text>
            )}
            <Group>
              <Button
                color="red"
                variant="light"
                leftSection={<TbTrash size={14} />}
                onClick={confirmDelete}
                loading={remove.isPending}
              >
                Delete project
              </Button>
            </Group>
          </Stack>
        </Card>
      )}
    </Stack>
  )
}

function GithubIntegrationCard({
  project,
  canManage,
  value,
  onChange,
  onSave,
  onUnlink,
  saving,
  error,
}: {
  project: ProjectDetail
  canManage: boolean
  value: string
  onChange: (v: string) => void
  onSave: (repo: string) => void
  onUnlink: () => void
  saving: boolean
  error: Error | null
}) {
  const preview = previewGithubRepo(value)
  const trimmed = value.trim()
  const invalid = trimmed.length > 0 && !preview
  const changed = (preview ?? '') !== (project.githubRepo ?? '')
  const webhookUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/webhooks/github`

  return (
    <Card withBorder padding="md" radius="md">
      <Stack gap="sm">
        <Group gap="xs">
          <ThemeIcon variant="light" size="md" radius="sm">
            <TbBrandGithub size={16} />
          </ThemeIcon>
          <Text fw={600} size="sm">
            GitHub integration
          </Text>
          {project.githubRepo && (
            <Badge color="green" variant="light" size="sm">
              Linked
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed">
          Link a GitHub repo to capture commits, pull requests, and reviews as project activity. Paste any form of repo
          URL — we'll normalize to <Code>owner/repo</Code>.
        </Text>
        <TextInput
          label="GitHub repo"
          placeholder="https://github.com/owner/repo or owner/repo"
          value={value}
          onChange={(e) => onChange(e.currentTarget.value)}
          disabled={!canManage}
          error={invalid ? 'Not a valid GitHub repo reference' : undefined}
          description={
            preview ? (
              <Text size="xs" c="dimmed">
                Will be stored as <Code>{preview}</Code>
              </Text>
            ) : undefined
          }
        />
        {error && changed && (
          <Text size="sm" c="red">
            {error.message}
          </Text>
        )}
        {canManage && (
          <Group justify="flex-end" gap="xs">
            {project.githubRepo && (
              <Button
                variant="subtle"
                color="red"
                size="xs"
                onClick={() => {
                  onChange('')
                  onUnlink()
                }}
                disabled={saving}
              >
                Unlink
              </Button>
            )}
            <Button
              size="xs"
              disabled={!changed || invalid || saving}
              loading={saving && changed}
              onClick={() => onSave(preview ?? '')}
            >
              {project.githubRepo ? 'Update link' : 'Link repo'}
            </Button>
          </Group>
        )}

        {project.githubRepo && (
          <Stack gap={4} mt="xs">
            <Text size="xs" fw={600} c="dimmed">
              Webhook setup
            </Text>
            <Text size="xs" c="dimmed">
              In your repo → Settings → Webhooks → Add webhook. Content type <Code>application/json</Code>. Secret is
              your <Code>GITHUB_WEBHOOK_SECRET</Code>. Events: <i>Pushes</i>, <i>Pull requests</i>,{' '}
              <i>Pull request reviews</i>.
            </Text>
            <Group gap="xs" wrap="nowrap">
              <Code style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{webhookUrl}</Code>
              <CopyButton value={webhookUrl}>
                {({ copied, copy }) => (
                  <Button size="compact-xs" variant="light" color={copied ? 'teal' : undefined} onClick={copy}>
                    {copied ? 'Copied' : 'Copy URL'}
                  </Button>
                )}
              </CopyButton>
            </Group>
            <Anchor
              size="xs"
              href={`https://github.com/${project.githubRepo}/settings/hooks/new`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open GitHub webhook settings →
            </Anchor>
          </Stack>
        )}
      </Stack>
    </Card>
  )
}
