import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  CopyButton,
  Group,
  Loader,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  TbBrandGithub,
  TbCheck,
  TbCopy,
  TbDownload,
  TbGitCommit,
  TbHourglass,
  TbListCheck,
  TbRefresh,
  TbTrendingUp,
  TbUsers,
} from 'react-icons/tb'

interface RetroTaskRow {
  id: string
  title: string
  status: string
  priority: string
  assigneeEmail: string | null
  dueAt: string | null
  closedAt: string | null
  estimateHours: number | null
}

interface RetroExtension {
  id: string
  previousEndAt: string | null
  newEndAt: string
  reason: string | null
  extendedBy: string | null
  createdAt: string
}

interface RetroContributor {
  userId: string | null
  email: string | null
  name: string | null
  closed: number
  commits: number
  prsMerged: number
}

interface RetroResult {
  project: { id: string; name: string; status: string; endsAt: string | null }
  window: { since: string; until: string; days: number }
  summary: {
    closed: number
    slipped: number
    stillBlocked: number
    extensions: number
    newTasks: number
    estimateHoursClosed: number
  }
  shipped: RetroTaskRow[]
  slipped: RetroTaskRow[]
  stillBlocked: RetroTaskRow[]
  biggestMisses: (RetroTaskRow & { daysOverDue: number })[]
  extensions: RetroExtension[]
  github: {
    commits: number
    prsOpened: number
    prsMerged: number
    prsClosed: number
    reviews: number
  }
  contributors: RetroContributor[]
}

const WINDOWS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toISOString().slice(0, 10)
}

export function RetroTab({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(14)
  const since = useMemo(() => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(), [days])

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['project', projectId, 'retro', days],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/retro?since=${encodeURIComponent(since)}`, { credentials: 'include' }).then(
        (r) => r.json() as Promise<RetroResult>,
      ),
  })

  const markdownQuery = useQuery({
    queryKey: ['project', projectId, 'retro', 'md', days],
    queryFn: () =>
      fetch(`/api/projects/${projectId}/retro?format=md&since=${encodeURIComponent(since)}`, {
        credentials: 'include',
      }).then((r) => r.text()),
    enabled: !!data,
  })

  const downloadMarkdown = () => {
    if (!markdownQuery.data) return
    const blob = new Blob([markdownQuery.data], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `retro-${data?.project.name ?? 'project'}-${fmtDate(data?.window.since)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (isLoading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    )
  }

  if (!data) {
    return <Alert color="red">Failed to load retrospective.</Alert>
  }

  const empty =
    data.summary.closed === 0 &&
    data.summary.slipped === 0 &&
    data.summary.extensions === 0 &&
    data.github.commits === 0 &&
    data.github.prsOpened === 0

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <div>
          <Title order={3}>Retrospective</Title>
          <Text size="sm" c="dimmed">
            {fmtDate(data.window.since)} → {fmtDate(data.window.until)} ({data.window.days} days)
          </Text>
        </div>
        <Group gap="xs">
          <SegmentedControl
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            data={WINDOWS.map((w) => ({ label: w.label, value: String(w.days) }))}
            size="sm"
          />
          <Tooltip label="Refresh">
            <ActionIcon variant="subtle" onClick={() => refetch()} loading={isFetching}>
              <TbRefresh size={16} />
            </ActionIcon>
          </Tooltip>
          <CopyButton value={markdownQuery.data ?? ''} timeout={2000}>
            {({ copied, copy }) => (
              <Button
                size="xs"
                variant="light"
                leftSection={copied ? <TbCheck size={14} /> : <TbCopy size={14} />}
                onClick={copy}
                disabled={!markdownQuery.data}
              >
                {copied ? 'Copied' : 'Copy markdown'}
              </Button>
            )}
          </CopyButton>
          <Button
            size="xs"
            variant="light"
            leftSection={<TbDownload size={14} />}
            onClick={downloadMarkdown}
            disabled={!markdownQuery.data}
          >
            Download .md
          </Button>
        </Group>
      </Group>

      {empty && <Alert color="blue">No activity recorded in this window. Try a longer range.</Alert>}

      <SimpleGrid cols={{ base: 2, md: 4, lg: 6 }} spacing="sm">
        <SummaryCard icon={<TbListCheck />} label="Shipped" value={data.summary.closed} color="teal" />
        <SummaryCard icon={<TbHourglass />} label="Slipped" value={data.summary.slipped} color="orange" />
        <SummaryCard icon={<TbHourglass />} label="Still blocked" value={data.summary.stillBlocked} color="red" />
        <SummaryCard icon={<TbTrendingUp />} label="New tasks" value={data.summary.newTasks} color="blue" />
        <SummaryCard icon={<TbHourglass />} label="Extensions" value={data.summary.extensions} color="yellow" />
        <SummaryCard icon={<TbGitCommit />} label="Commits" value={data.github.commits} color="violet" />
      </SimpleGrid>

      {data.github.commits + data.github.prsOpened + data.github.prsMerged > 0 && (
        <Card withBorder padding="md" radius="md">
          <Group gap="xs" mb="xs">
            <TbBrandGithub size={16} />
            <Title order={5}>GitHub activity</Title>
          </Group>
          <SimpleGrid cols={{ base: 2, md: 5 }} spacing="sm">
            <Stat label="Commits" value={data.github.commits} color="violet" />
            <Stat label="PRs opened" value={data.github.prsOpened} color="blue" />
            <Stat label="PRs merged" value={data.github.prsMerged} color="teal" />
            <Stat label="PRs closed" value={data.github.prsClosed} color="gray" />
            <Stat label="Reviews" value={data.github.reviews} color="orange" />
          </SimpleGrid>
        </Card>
      )}

      {data.shipped.length > 0 && (
        <Section title={`Shipped (${data.shipped.length})`} color="teal">
          {data.shipped.slice(0, 15).map((t) => (
            <TaskLine key={t.id} task={t} suffix={`closed ${fmtDate(t.closedAt)}`} />
          ))}
          {data.shipped.length > 15 && (
            <Text size="xs" c="dimmed">
              …and {data.shipped.length - 15} more
            </Text>
          )}
        </Section>
      )}

      {data.biggestMisses.length > 0 && (
        <Section title="Biggest misses" color="red">
          {data.biggestMisses.map((t) => (
            <TaskLine key={t.id} task={t} suffix={`${t.daysOverDue}d overdue`} />
          ))}
        </Section>
      )}

      {data.slipped.length > 0 && (
        <Section title={`Slipped (${data.slipped.length})`} color="orange">
          {data.slipped.slice(0, 15).map((t) => (
            <TaskLine
              key={t.id}
              task={t}
              suffix={`due ${fmtDate(t.dueAt)}${t.closedAt ? ` · closed ${fmtDate(t.closedAt)}` : ' · still open'}`}
            />
          ))}
          {data.slipped.length > 15 && (
            <Text size="xs" c="dimmed">
              …and {data.slipped.length - 15} more
            </Text>
          )}
        </Section>
      )}

      {data.stillBlocked.length > 0 && (
        <Section title="Still blocked" color="grape">
          {data.stillBlocked.slice(0, 10).map((t) => (
            <TaskLine key={t.id} task={t} />
          ))}
        </Section>
      )}

      {data.extensions.length > 0 && (
        <Section title="Deadline pushes" color="yellow">
          {data.extensions.map((e) => (
            <Group key={e.id} gap="xs" wrap="nowrap">
              <Text size="sm" ff="monospace">
                {fmtDate(e.previousEndAt)} → {fmtDate(e.newEndAt)}
              </Text>
              <Text size="xs" c="dimmed">
                by {e.extendedBy ?? 'system'}
              </Text>
              {e.reason && (
                <Text size="xs" c="dimmed" truncate>
                  · {e.reason}
                </Text>
              )}
            </Group>
          ))}
        </Section>
      )}

      {data.contributors.length > 0 && (
        <Card withBorder padding="md" radius="md">
          <Group gap="xs" mb="sm">
            <TbUsers size={16} />
            <Title order={5}>Top contributors</Title>
          </Group>
          <Stack gap={6}>
            {data.contributors.map((c) => (
              <Group key={c.userId ?? c.email ?? Math.random()} gap="xs" wrap="nowrap">
                <Text size="sm" fw={500} style={{ flex: 1 }} truncate>
                  {c.name ?? c.email ?? '—'}
                </Text>
                <Badge size="xs" color="teal" variant="light">
                  {c.closed} closed
                </Badge>
                {c.commits > 0 && (
                  <Badge size="xs" color="violet" variant="light">
                    {c.commits} commits
                  </Badge>
                )}
                {c.prsMerged > 0 && (
                  <Badge size="xs" color="blue" variant="light">
                    {c.prsMerged} PRs
                  </Badge>
                )}
              </Group>
            ))}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}

function Section({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
  return (
    <Card withBorder padding="md" radius="md">
      <Group gap="xs" mb="sm">
        <Badge color={color} variant="light" size="lg">
          {title}
        </Badge>
      </Group>
      <Stack gap={4}>{children}</Stack>
    </Card>
  )
}

function TaskLine({ task, suffix }: { task: RetroTaskRow; suffix?: string }) {
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge size="xs" variant="outline" color="gray">
        {task.priority}
      </Badge>
      <Text size="sm" style={{ flex: 1 }} truncate>
        {task.title}
      </Text>
      <Text size="xs" c="dimmed">
        {task.assigneeEmail ?? 'unassigned'}
      </Text>
      {suffix && (
        <Text size="xs" c="dimmed">
          {suffix}
        </Text>
      )}
    </Group>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: number
  color: string
}) {
  return (
    <Card withBorder padding="sm" radius="md">
      <Group gap="xs" wrap="nowrap">
        <ThemeIcon variant="light" color={color} size="md">
          {icon}
        </ThemeIcon>
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={500}>
            {label}
          </Text>
          <Text fw={700} size="lg">
            {value}
          </Text>
        </div>
      </Group>
    </Card>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed" fw={500} tt="uppercase">
        {label}
      </Text>
      <Text fw={700} size="lg" c={color}>
        {value}
      </Text>
    </div>
  )
}
