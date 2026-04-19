import { Card, Group, Loader, Skeleton, Stack, Text } from '@mantine/core'
import type { ReactNode } from 'react'

export function SectionSkeleton({
  height = 180,
  radius = 'md',
}: {
  height?: number | string
  radius?: string | number
}) {
  return <Skeleton height={height} radius={radius} />
}

export function KpiSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => `kpi-${i}`).map((key) => (
        <Skeleton key={key} height={96} radius="md" />
      ))}
    </>
  )
}

export function TableSkeleton({ rows = 5, height = 32 }: { rows?: number; height?: number }) {
  return (
    <Stack gap="xs">
      {Array.from({ length: rows }, (_, i) => `row-${i}`).map((key) => (
        <Skeleton key={key} height={height} radius="sm" />
      ))}
    </Stack>
  )
}

export function LoadingBlock({
  message = 'Memuat…',
  minHeight = 140,
}: {
  message?: ReactNode
  minHeight?: number | string
}) {
  return (
    <Card withBorder radius="md">
      <Stack gap="xs" align="center" py="lg" style={{ minHeight }}>
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          {message}
        </Text>
      </Stack>
    </Card>
  )
}

export function InlineLoading({ message = 'Memuat…' }: { message?: ReactNode }) {
  return (
    <Group gap="xs" justify="center" py="md">
      <Loader size="xs" />
      <Text size="sm" c="dimmed">
        {message}
      </Text>
    </Group>
  )
}
