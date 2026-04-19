import {
  ActionIcon,
  AppShell,
  Avatar,
  Badge,
  Burger,
  Button,
  Container,
  Divider,
  Group,
  NavLink,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core'
import { useDisclosure, useMediaQuery } from '@mantine/hooks'
import { modals } from '@mantine/modals'
import { notifications } from '@mantine/notifications'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  TbAlertTriangle,
  TbBell,
  TbBriefcase,
  TbCheck,
  TbClock,
  TbDeviceDesktop,
  TbKey,
  TbLayoutGrid,
  TbLock,
  TbSettings,
  TbShieldLock,
  TbUser,
  TbX,
} from 'react-icons/tb'
import { MyDevicesPanel } from '@/frontend/components/MyDevicesPanel'
import { NotificationBell } from '@/frontend/components/NotificationBell'
import { SidebarAppSwitcher } from '@/frontend/components/SidebarAppSwitcher'
import { SidebarUserFooter } from '@/frontend/components/SidebarUserFooter'
import { useLogout, useSession } from '@/frontend/hooks/useAuth'

const validSections = ['profile', 'security', 'devices', 'preferences'] as const
type SectionKey = (typeof validSections)[number]

type SettingsSearch = { section?: SectionKey }

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): SettingsSearch => {
    const section = validSections.includes(search.section as SectionKey) ? (search.section as SectionKey) : undefined
    return section ? { section } : {}
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
  component: SettingsPage,
})

const roleBadgeColor: Record<string, string> = {
  USER: 'blue',
  QC: 'teal',
  ADMIN: 'violet',
  SUPER_ADMIN: 'red',
}

const navItems: {
  key: SectionKey
  label: string
  description: string
  icon: React.ComponentType<{ size?: number }>
}[] = [
  { key: 'profile', label: 'Profil', description: 'Info pribadi & stats kerja', icon: TbUser },
  { key: 'security', label: 'Keamanan', description: 'Password, sesi, riwayat', icon: TbShieldLock },
  { key: 'devices', label: 'Perangkat', description: 'Agen pm-watch kamu', icon: TbDeviceDesktop },
  { key: 'preferences', label: 'Preferensi', description: 'Notifikasi & tampilan', icon: TbBell },
]

function SettingsPage() {
  const { data } = useSession()
  const logout = useLogout()
  const user = data?.user
  const { section: activeSearch } = Route.useSearch()
  const active: SectionKey = activeSearch ?? 'profile'
  const navigate = useNavigate()
  const [mobileOpened, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false)
  const isMobile = useMediaQuery('(max-width: 48em)')
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('settings:sidebar') === 'collapsed')
  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('settings:sidebar', next ? 'collapsed' : 'open')
      return next
    })
  }
  const setActive = (key: SectionKey) => {
    navigate({ to: '/settings', search: { section: key } })
    closeMobile()
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
              <TbSettings size={18} />
            </ThemeIcon>
            <Title order={4}>Pengaturan</Title>
          </Group>
          <Group gap="xs">
            <NotificationBell size="md" />
            <Badge color={roleBadgeColor[user?.role ?? 'USER']} variant="light" size="sm">
              {user?.role}
            </Badge>
            <Text size="sm" visibleFrom="sm" c="dimmed">
              {user?.email}
            </Text>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={collapsed && !isMobile ? 'xs' : 'md'}>
        <Stack gap="md" style={{ flex: 1, overflowY: 'auto' }}>
          <Stack gap={4}>
            {!(collapsed && !isMobile) && (
              <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }} px="xs" pt={4}>
                Pengaturan Akun
              </Text>
            )}
            {navItems.map((item) => {
              const Icon = item.icon
              if (collapsed && !isMobile) {
                return (
                  <Tooltip
                    key={item.key}
                    label={
                      <Stack gap={0}>
                        <Text size="xs" fw={600}>
                          {item.label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {item.description}
                        </Text>
                      </Stack>
                    }
                    position="right"
                    withArrow
                  >
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
                  description={item.description}
                  leftSection={<Icon size={18} />}
                  color="blue"
                  active={active === item.key}
                  onClick={() => setActive(item.key)}
                />
              )
            })}
          </Stack>

          <SidebarAppSwitcher current="settings" role={user?.role} collapsed={collapsed && !isMobile} />
        </Stack>

        <SidebarUserFooter
          user={user}
          collapsed={collapsed && !isMobile}
          onToggleCollapse={toggleSidebar}
          onLogout={confirmLogout}
          isLoggingOut={logout.isPending}
          accentColor="blue"
        />
      </AppShell.Navbar>

      <AppShell.Main>
        <Container size="xl" px={0}>
          {active === 'profile' && <ProfileSection user={user} />}
          {active === 'security' && <SecuritySection />}
          {active === 'devices' && <MyDevicesPanel />}
          {active === 'preferences' && <PreferencesSection />}
        </Container>
      </AppShell.Main>
    </AppShell>
  )
}

type TaskLite = {
  id: string
  title: string
  status: 'OPEN' | 'IN_PROGRESS' | 'READY_FOR_QC' | 'REOPENED' | 'CLOSED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  dueAt: string | null
  closedAt: string | null
  project?: { id: string; name: string }
}

type ProjectLite = {
  id: string
  name: string
  status: string
  priority: string
  myRole?: string
  _count?: { tasks?: number; members?: number }
}

const priorityColor: Record<string, string> = {
  LOW: 'gray',
  MEDIUM: 'blue',
  HIGH: 'orange',
  CRITICAL: 'red',
}

const projectStatusColor: Record<string, string> = {
  PLANNING: 'gray',
  ACTIVE: 'blue',
  ON_HOLD: 'yellow',
  DONE: 'teal',
  ARCHIVED: 'gray',
  CANCELLED: 'red',
}

function ProfileSection({ user }: { user: { name?: string; email?: string; role?: string } | null | undefined }) {
  const navigate = useNavigate()
  const { data: tasksData } = useQuery({
    queryKey: ['me', 'tasks'],
    queryFn: () =>
      fetch('/api/tasks?mine=1', { credentials: 'include' }).then((r) => r.json() as Promise<{ tasks: TaskLite[] }>),
  })
  const { data: projectsData } = useQuery({
    queryKey: ['me', 'projects'],
    queryFn: () =>
      fetch('/api/projects', { credentials: 'include' }).then((r) => r.json() as Promise<{ projects: ProjectLite[] }>),
  })

  const tasks = tasksData?.tasks ?? []
  const projects = projectsData?.projects ?? []
  const now = Date.now()
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000

  const openTasks = tasks.filter((t) => t.status !== 'CLOSED')
  const closedLast7 = tasks.filter((t) => t.closedAt && new Date(t.closedAt).getTime() >= weekAgo)
  const overdueTasks = openTasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now)
  const criticalTasks = openTasks.filter((t) => t.priority === 'CRITICAL' || t.priority === 'HIGH')

  return (
    <Stack gap="lg">
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md">
          <Avatar color="blue" radius="xl" size={80}>
            {user?.name?.charAt(0).toUpperCase()}
          </Avatar>
          <div style={{ textAlign: 'center' }}>
            <Text fw={600} size="lg">
              {user?.name}
            </Text>
            <Text c="dimmed" size="sm">
              {user?.email}
            </Text>
          </div>
          <Badge color={roleBadgeColor[user?.role ?? 'USER']} variant="light" size="lg">
            {user?.role}
          </Badge>
        </Stack>
      </Paper>

      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <StatCard label="Tugas aktif" value={openTasks.length} color="blue" />
        <StatCard label="Selesai 7 hari" value={closedLast7.length} color="teal" />
        <StatCard label="Terlambat" value={overdueTasks.length} color={overdueTasks.length > 0 ? 'red' : 'gray'} />
        <StatCard
          label="Prioritas tinggi"
          value={criticalTasks.length}
          color={criticalTasks.length > 0 ? 'orange' : 'gray'}
        />
      </SimpleGrid>

      {overdueTasks.length > 0 && (
        <Paper withBorder p="lg" radius="md">
          <Stack gap="sm">
            <Group gap="xs">
              <ThemeIcon variant="light" color="red" size="md" radius="md">
                <TbAlertTriangle size={16} />
              </ThemeIcon>
              <Text fw={500} size="sm">
                Butuh perhatian segera ({overdueTasks.length})
              </Text>
            </Group>
            <Stack gap={6}>
              {overdueTasks.slice(0, 5).map((t) => {
                const daysLate = t.dueAt ? Math.max(1, Math.floor((now - new Date(t.dueAt).getTime()) / 86_400_000)) : 0
                return (
                  <Group
                    key={t.id}
                    justify="space-between"
                    wrap="nowrap"
                    gap="sm"
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate({ to: '/pm', search: { tab: 'tasks' } })}
                  >
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" truncate>
                        {t.title}
                      </Text>
                      {t.project && (
                        <Text size="xs" c="dimmed" truncate>
                          {t.project.name}
                        </Text>
                      )}
                    </Stack>
                    <Badge size="xs" color="red" variant="light">
                      {daysLate}h telat
                    </Badge>
                  </Group>
                )
              })}
            </Stack>
          </Stack>
        </Paper>
      )}

      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <ThemeIcon variant="light" color="violet" size="md" radius="md">
                <TbBriefcase size={16} />
              </ThemeIcon>
              <Text fw={500} size="sm">
                Proyek yang saya ikuti ({projects.length})
              </Text>
            </Group>
          </Group>
          {projects.length === 0 ? (
            <Text size="xs" c="dimmed">
              Belum terdaftar sebagai anggota proyek manapun.
            </Text>
          ) : (
            <Stack gap={6}>
              {projects.slice(0, 6).map((p) => (
                <Group
                  key={p.id}
                  justify="space-between"
                  wrap="nowrap"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate({ to: '/pm', search: { tab: 'projects' } })}
                >
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Text size="sm" truncate>
                      {p.name}
                    </Text>
                    <Group gap={6}>
                      <Badge size="xs" color={projectStatusColor[p.status] ?? 'gray'} variant="light">
                        {p.status}
                      </Badge>
                      {p.myRole && (
                        <Text size="xs" c="dimmed">
                          {p.myRole}
                        </Text>
                      )}
                    </Group>
                  </Stack>
                  <Badge size="xs" color={priorityColor[p.priority] ?? 'gray'} variant="light">
                    {p.priority}
                  </Badge>
                </Group>
              ))}
              {projects.length > 6 && (
                <Text size="xs" c="dimmed" ta="center">
                  +{projects.length - 6} lainnya
                </Text>
              )}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Group gap="xs">
            <TbUser size={16} />
            <Text fw={500} size="sm">
              Informasi Akun
            </Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Nama
            </Text>
            <Text size="sm">{user?.name}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Email
            </Text>
            <Text size="sm">{user?.email}</Text>
          </Group>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              Peran
            </Text>
            <Text size="sm">{user?.role}</Text>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  )
}

type UserPreferences = {
  notifyTaskAssigned: boolean
  notifyTaskStatusChanged: boolean
  notifyMentioned: boolean
  notifyProjectDeadline: boolean
  pmDefaultTab: 'overview' | 'projects' | 'tasks' | 'activity' | 'team'
  tasksDefaultFilter: 'mine' | 'all' | 'priority'
  tableDensity: 'compact' | 'comfortable'
}

const defaultPrefs: UserPreferences = {
  notifyTaskAssigned: true,
  notifyTaskStatusChanged: true,
  notifyMentioned: true,
  notifyProjectDeadline: true,
  pmDefaultTab: 'overview',
  tasksDefaultFilter: 'mine',
  tableDensity: 'comfortable',
}

function PreferencesSection() {
  const qc = useQueryClient()
  const { data } = useQuery({
    queryKey: ['me', 'preferences'],
    queryFn: () =>
      fetch('/api/me/preferences', { credentials: 'include' }).then(
        (r) => r.json() as Promise<{ preferences: UserPreferences }>,
      ),
  })
  const [draft, setDraft] = useState<UserPreferences>(defaultPrefs)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (data?.preferences) {
      setDraft(data.preferences)
      setDirty(false)
    }
  }, [data?.preferences])

  const save = useMutation({
    mutationFn: (payload: UserPreferences) =>
      fetch('/api/me/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json()),
    onSuccess: (res) => {
      qc.setQueryData(['me', 'preferences'], res)
      setDirty(false)
      notifications.show({ color: 'teal', title: 'Tersimpan', message: 'Preferensi kamu sudah diperbarui.' })
    },
    onError: () => {
      notifications.show({ color: 'red', title: 'Gagal menyimpan', message: 'Coba lagi beberapa saat lagi.' })
    },
  })

  function set<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const reset = () => {
    if (data?.preferences) {
      setDraft(data.preferences)
      setDirty(false)
    }
  }

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg" radius="md">
        <Stack gap="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="blue" size="md" radius="md">
              <TbBell size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={500} size="sm">
                Notifikasi
              </Text>
              <Text size="xs" c="dimmed">
                Pilih kejadian apa yang ingin kamu dapatkan notifikasinya.
              </Text>
            </Stack>
          </Group>
          <Divider />
          <Switch
            label="Tugas baru ditugaskan ke saya"
            description="Saat PM/owner menetapkan task baru ke akunmu."
            checked={draft.notifyTaskAssigned}
            onChange={(e) => set('notifyTaskAssigned', e.currentTarget.checked)}
          />
          <Switch
            label="Perubahan status tugas saya"
            description="Saat status task kamu berpindah (mis. READY_FOR_QC → CLOSED)."
            checked={draft.notifyTaskStatusChanged}
            onChange={(e) => set('notifyTaskStatusChanged', e.currentTarget.checked)}
          />
          <Switch
            label="Disebut di komentar"
            description="Saat seseorang menyebut @namamu di komentar task."
            checked={draft.notifyMentioned}
            onChange={(e) => set('notifyMentioned', e.currentTarget.checked)}
          />
          <Switch
            label="Tenggat proyek mendekat"
            description="Peringatan saat proyek yang kamu ikuti mendekati deadline (<3 hari)."
            checked={draft.notifyProjectDeadline}
            onChange={(e) => set('notifyProjectDeadline', e.currentTarget.checked)}
          />
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="violet" size="md" radius="md">
              <TbLayoutGrid size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={500} size="sm">
                Tampilan Manajer Proyek
              </Text>
              <Text size="xs" c="dimmed">
                Atur cara default halaman PM dibuka.
              </Text>
            </Stack>
          </Group>
          <Divider />
          <Select
            label="Tab default saat membuka /pm"
            value={draft.pmDefaultTab}
            onChange={(v) => v && set('pmDefaultTab', v as UserPreferences['pmDefaultTab'])}
            data={[
              { value: 'overview', label: 'Ringkasan' },
              { value: 'projects', label: 'Proyek' },
              { value: 'tasks', label: 'Tugas' },
              { value: 'activity', label: 'Aktivitas' },
              { value: 'team', label: 'Tim' },
            ]}
          />
          <Select
            label="Filter tugas default"
            description="Filter yang terpasang otomatis saat pertama kali buka tab Tugas."
            value={draft.tasksDefaultFilter}
            onChange={(v) => v && set('tasksDefaultFilter', v as UserPreferences['tasksDefaultFilter'])}
            data={[
              { value: 'mine', label: 'Tugas saya' },
              { value: 'all', label: 'Semua tugas' },
              { value: 'priority', label: 'Prioritas tinggi dulu' },
            ]}
          />
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Kepadatan tabel
            </Text>
            <SegmentedControl
              value={draft.tableDensity}
              onChange={(v) => set('tableDensity', v as UserPreferences['tableDensity'])}
              data={[
                { value: 'comfortable', label: 'Nyaman' },
                { value: 'compact', label: 'Padat' },
              ]}
            />
          </Stack>
        </Stack>
      </Paper>

      <Group justify="flex-end">
        <Button variant="subtle" onClick={reset} disabled={!dirty || save.isPending}>
          Batal
        </Button>
        <Button
          leftSection={<TbCheck size={14} />}
          onClick={() => save.mutate(draft)}
          loading={save.isPending}
          disabled={!dirty}
        >
          Simpan perubahan
        </Button>
      </Group>
    </Stack>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Paper withBorder p="sm" radius="md">
      <Stack gap={2}>
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        <Text size="xl" fw={700} c={color}>
          {value}
        </Text>
      </Stack>
    </Paper>
  )
}

type MySession = {
  id: string
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

type MyAudit = {
  id: string
  action: string
  detail: string | null
  ip: string | null
  createdAt: string
}

function SecuritySection() {
  const qc = useQueryClient()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const { data: sessionsData } = useQuery({
    queryKey: ['me', 'sessions'],
    queryFn: () =>
      fetch('/api/me/sessions', { credentials: 'include' }).then((r) => r.json() as Promise<{ sessions: MySession[] }>),
    refetchInterval: 60_000,
  })
  const { data: auditData } = useQuery({
    queryKey: ['me', 'audit'],
    queryFn: () =>
      fetch('/api/me/audit', { credentials: 'include' }).then((r) => r.json() as Promise<{ logs: MyAudit[] }>),
  })

  const sessions = sessionsData?.sessions ?? []
  const otherSessions = sessions.filter((s) => !s.isCurrent)
  const auditLogs = auditData?.logs ?? []

  const changePwd = useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) => {
      const r = await fetch('/api/me/password', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error ?? 'Gagal mengubah password')
      return body
    },
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notifications.show({ color: 'teal', title: 'Password diubah', message: 'Password kamu sudah diperbarui.' })
    },
    onError: (e: Error) => {
      notifications.show({ color: 'red', title: 'Gagal mengubah password', message: e.message })
    },
  })

  const revokeOthers = useMutation({
    mutationFn: () =>
      fetch('/api/me/sessions/others', { method: 'DELETE', credentials: 'include' }).then((r) => r.json()),
    onSuccess: (res: { revoked?: number }) => {
      qc.invalidateQueries({ queryKey: ['me', 'sessions'] })
      notifications.show({
        color: 'teal',
        title: 'Sesi lain dicabut',
        message: `${res.revoked ?? 0} sesi lain berhasil dicabut.`,
      })
    },
  })

  const submitPwd = () => {
    if (newPassword.length < 8) {
      notifications.show({ color: 'red', title: 'Password terlalu pendek', message: 'Minimal 8 karakter.' })
      return
    }
    if (newPassword !== confirmPassword) {
      notifications.show({
        color: 'red',
        title: 'Konfirmasi tidak cocok',
        message: 'Password baru dan konfirmasi harus sama.',
      })
      return
    }
    changePwd.mutate({ currentPassword, newPassword })
  }

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg" radius="md">
        <Stack gap="md">
          <Group gap="xs">
            <ThemeIcon variant="light" color="blue" size="md" radius="md">
              <TbLock size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={500} size="sm">
                Ubah Password
              </Text>
              <Text size="xs" c="dimmed">
                Gunakan password yang tidak dipakai di layanan lain.
              </Text>
            </Stack>
          </Group>
          <Divider />
          <PasswordInput
            label="Password saat ini"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label="Password baru"
            description="Minimal 8 karakter."
            value={newPassword}
            onChange={(e) => setNewPassword(e.currentTarget.value)}
            required
          />
          <PasswordInput
            label="Konfirmasi password baru"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
          />
          <Group justify="flex-end">
            <Button
              leftSection={<TbCheck size={14} />}
              onClick={submitPwd}
              loading={changePwd.isPending}
              disabled={!currentPassword || !newPassword || !confirmPassword}
            >
              Ubah password
            </Button>
          </Group>
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Group gap="xs">
              <ThemeIcon variant="light" color="teal" size="md" radius="md">
                <TbKey size={16} />
              </ThemeIcon>
              <Stack gap={0}>
                <Text fw={500} size="sm">
                  Sesi Aktif ({sessions.length})
                </Text>
                <Text size="xs" c="dimmed">
                  Perangkat/browser yang sedang masuk dengan akunmu.
                </Text>
              </Stack>
            </Group>
            {otherSessions.length > 0 && (
              <Button
                size="xs"
                variant="light"
                color="red"
                leftSection={<TbX size={12} />}
                onClick={() => revokeOthers.mutate()}
                loading={revokeOthers.isPending}
              >
                Cabut yang lain ({otherSessions.length})
              </Button>
            )}
          </Group>
          <Divider />
          {sessions.length === 0 ? (
            <Text size="xs" c="dimmed">
              Tidak ada sesi aktif.
            </Text>
          ) : (
            <Stack gap="xs">
              {sessions.map((s) => (
                <Group key={s.id} justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Text size="sm" fw={500}>
                        {s.isCurrent ? 'Sesi ini' : 'Sesi lain'}
                      </Text>
                      {s.isCurrent && (
                        <Badge size="xs" color="teal" variant="light">
                          aktif
                        </Badge>
                      )}
                    </Group>
                    <Text size="xs" c="dimmed">
                      Dibuat {formatDateTime(s.createdAt)} · kadaluarsa {formatDateTime(s.expiresAt)}
                    </Text>
                  </Stack>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm">
          <Group gap="xs">
            <ThemeIcon variant="light" color="orange" size="md" radius="md">
              <TbClock size={16} />
            </ThemeIcon>
            <Stack gap={0}>
              <Text fw={500} size="sm">
                Aktivitas Masuk Terkini
              </Text>
              <Text size="xs" c="dimmed">
                Riwayat login, logout, dan upaya gagal dalam 20 kejadian terakhir.
              </Text>
            </Stack>
          </Group>
          <Divider />
          {auditLogs.length === 0 ? (
            <Text size="xs" c="dimmed">
              Belum ada riwayat.
            </Text>
          ) : (
            <Stack gap={6}>
              {auditLogs.map((log) => (
                <Group key={log.id} justify="space-between" wrap="nowrap">
                  <Stack gap={0} style={{ minWidth: 0 }}>
                    <Group gap={6}>
                      <Badge size="xs" color={auditColor(log.action)} variant="light">
                        {log.action}
                      </Badge>
                      {log.ip && (
                        <Text size="xs" c="dimmed">
                          {log.ip}
                        </Text>
                      )}
                    </Group>
                    {log.detail && (
                      <Text size="xs" c="dimmed" truncate>
                        {log.detail}
                      </Text>
                    )}
                  </Stack>
                  <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(log.createdAt)}
                  </Text>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Paper>
    </Stack>
  )
}

function auditColor(action: string): string {
  if (action === 'LOGIN') return 'teal'
  if (action === 'LOGOUT') return 'gray'
  if (action === 'LOGIN_FAILED') return 'red'
  if (action === 'LOGIN_BLOCKED') return 'red'
  return 'blue'
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}
