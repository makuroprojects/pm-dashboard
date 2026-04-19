import { ActionIcon, Group, Stack, Text, ThemeIcon, Tooltip, UnstyledButton } from '@mantine/core'
import { useNavigate } from '@tanstack/react-router'
import type { IconType } from 'react-icons'
import { TbCode, TbSettings, TbShieldLock, TbTarget } from 'react-icons/tb'

type AppKey = 'pm' | 'admin' | 'dev' | 'settings'
type Role = 'USER' | 'QC' | 'ADMIN' | 'SUPER_ADMIN'

type AppDef = {
  key: AppKey
  label: string
  description: string
  icon: IconType
  color: string
  roles: Role[]
  navigate: (nav: ReturnType<typeof useNavigate>) => void
}

const APPS: AppDef[] = [
  {
    key: 'pm',
    label: 'Manajer Proyek',
    description: 'Proyek & tugas',
    icon: TbTarget,
    color: 'blue',
    roles: ['USER', 'QC', 'ADMIN', 'SUPER_ADMIN'],
    navigate: (nav) => nav({ to: '/pm', search: { tab: 'overview' } }),
  },
  {
    key: 'admin',
    label: 'Admin',
    description: 'Cockpit & pengelolaan',
    icon: TbShieldLock,
    color: 'violet',
    roles: ['ADMIN', 'SUPER_ADMIN'],
    navigate: (nav) => nav({ to: '/admin', search: { tab: 'overview' } }),
  },
  {
    key: 'dev',
    label: 'Dev',
    description: 'Konsol teknis',
    icon: TbCode,
    color: 'orange',
    roles: ['SUPER_ADMIN'],
    navigate: (nav) => nav({ to: '/dev', search: { tab: 'overview' } }),
  },
  {
    key: 'settings',
    label: 'Pengaturan',
    description: 'Profil & preferensi',
    icon: TbSettings,
    color: 'gray',
    roles: ['USER', 'QC', 'ADMIN', 'SUPER_ADMIN'],
    navigate: (nav) => nav({ to: '/settings', search: { section: 'profile' } }),
  },
]

export function SidebarAppSwitcher({
  current,
  role,
  collapsed,
}: {
  current: AppKey
  role?: string
  collapsed: boolean
}) {
  const navigate = useNavigate()
  const items = APPS.filter((a) => a.key !== current && a.roles.includes((role ?? 'USER') as Role))
  if (items.length === 0) return null

  if (collapsed) {
    return (
      <Stack gap={6} align="center">
        {items.map((app) => {
          const Icon = app.icon
          return (
            <Tooltip key={app.key} label={app.label} position="right" withArrow>
              <ActionIcon variant="subtle" color={app.color} size="lg" onClick={() => app.navigate(navigate)}>
                <Icon size={18} />
              </ActionIcon>
            </Tooltip>
          )
        })}
      </Stack>
    )
  }

  return (
    <Stack gap={4}>
      <Text size="xs" fw={700} c="dimmed" tt="uppercase" style={{ letterSpacing: 0.6 }} px="xs" pt={4}>
        Aplikasi Lain
      </Text>
      {items.map((app) => {
        const Icon = app.icon
        return (
          <UnstyledButton
            key={app.key}
            onClick={() => app.navigate(navigate)}
            px="xs"
            py={6}
            style={{
              borderRadius: 'var(--mantine-radius-sm)',
              transition: 'background 120ms',
            }}
            className="sidebar-app-item"
          >
            <Group gap="xs" wrap="nowrap">
              <ThemeIcon variant="light" color={app.color} size="md" radius="md">
                <Icon size={14} />
              </ThemeIcon>
              <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={500} truncate>
                  {app.label}
                </Text>
                <Text size="xs" c="dimmed" truncate>
                  {app.description}
                </Text>
              </Stack>
            </Group>
          </UnstyledButton>
        )
      })}
    </Stack>
  )
}
