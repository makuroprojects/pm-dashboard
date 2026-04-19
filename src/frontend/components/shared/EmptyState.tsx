import { Button, Card, type MantineColor, Stack, Text, ThemeIcon } from '@mantine/core'
import type { ComponentType, ReactNode } from 'react'
import { TbInbox } from 'react-icons/tb'

interface EmptyStateProps {
  icon?: ComponentType<{ size?: number | string }>
  color?: MantineColor
  title: string
  message?: ReactNode
  ctaLabel?: string
  onCta?: () => void
  variant?: 'card' | 'inline' | 'row'
  minHeight?: number | string
}

export function EmptyState({
  icon: Icon = TbInbox,
  color = 'gray',
  title,
  message,
  ctaLabel,
  onCta,
  variant = 'card',
  minHeight,
}: EmptyStateProps) {
  const body = (
    <Stack gap="xs" align="center" ta="center" py={variant === 'inline' ? 'sm' : 'lg'}>
      <ThemeIcon variant="light" color={color} size={variant === 'inline' ? 'lg' : 'xl'} radius="xl">
        <Icon size={variant === 'inline' ? 20 : 26} />
      </ThemeIcon>
      <Stack gap={2} align="center">
        <Text size={variant === 'inline' ? 'sm' : 'md'} fw={600}>
          {title}
        </Text>
        {message && (
          <Text size="xs" c="dimmed" maw={420}>
            {message}
          </Text>
        )}
      </Stack>
      {ctaLabel && onCta && (
        <Button size="xs" variant="light" color={color} onClick={onCta} mt={4}>
          {ctaLabel}
        </Button>
      )}
    </Stack>
  )

  if (variant === 'inline') return body
  if (variant === 'row') {
    return (
      <div style={{ minHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '12px' }}>
        {body}
      </div>
    )
  }
  return (
    <Card withBorder radius="md" style={{ minHeight }}>
      {body}
    </Card>
  )
}

export function EmptyRow({
  icon: Icon = TbInbox,
  title,
  message,
}: {
  icon?: ComponentType<{ size?: number | string }>
  title: string
  message?: ReactNode
}) {
  return (
    <Stack gap={4} align="center" py="md">
      <ThemeIcon variant="light" color="gray" size="md" radius="xl">
        <Icon size={16} />
      </ThemeIcon>
      <Text size="sm" fw={500}>
        {title}
      </Text>
      {message && (
        <Text size="xs" c="dimmed">
          {message}
        </Text>
      )}
    </Stack>
  )
}
