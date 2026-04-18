import { Center, Loader, useComputedColorScheme } from '@mantine/core'
import type { EChartsOption } from 'echarts'
import { type CSSProperties, lazy, Suspense } from 'react'

const EChartImpl = lazy(() => import('./EChartImpl'))

export function EChart({
  option,
  style,
  height = 260,
  onEvents,
}: {
  option: EChartsOption
  style?: CSSProperties
  height?: number | string
  onEvents?: Record<string, (params: unknown) => void>
}) {
  const colorScheme = useComputedColorScheme('light', { getInitialValueInEffect: true })
  const h = typeof height === 'number' ? `${height}px` : height
  return (
    <Suspense
      fallback={
        <Center style={{ height: h }}>
          <Loader size="sm" />
        </Center>
      }
    >
      <EChartImpl
        option={option}
        style={{ height: h, width: '100%', ...style }}
        colorScheme={colorScheme}
        onEvents={onEvents}
      />
    </Suspense>
  )
}
