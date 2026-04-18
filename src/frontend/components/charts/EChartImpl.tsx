import type { EChartsOption } from 'echarts'
import ReactECharts from 'echarts-for-react'
import type { CSSProperties } from 'react'

function applyAxisDefaults<T>(axis: T, textColor: string, axisLineColor: string, splitLineColor: string): T {
  if (axis === undefined || axis === null) return axis
  if (Array.isArray(axis)) {
    return axis.map((a) => applyAxisDefaults(a, textColor, axisLineColor, splitLineColor)) as unknown as T
  }
  const a = axis as Record<string, unknown>
  return {
    ...a,
    axisLine: { lineStyle: { color: axisLineColor }, ...((a.axisLine as object) ?? {}) },
    axisTick: { lineStyle: { color: axisLineColor }, ...((a.axisTick as object) ?? {}) },
    axisLabel: { color: textColor, ...((a.axisLabel as object) ?? {}) },
    splitLine: {
      lineStyle: { color: splitLineColor, opacity: 0.4 },
      ...((a.splitLine as object) ?? {}),
    },
  } as unknown as T
}

export default function EChartImpl({
  option,
  style,
  colorScheme,
  onEvents,
}: {
  option: EChartsOption
  style?: CSSProperties
  colorScheme: 'light' | 'dark'
  onEvents?: Record<string, (params: unknown) => void>
}) {
  const isDark = colorScheme === 'dark'
  const textColor = isDark ? '#c1c2c5' : '#495057'
  const axisLineColor = isDark ? '#373a40' : '#dee2e6'
  const splitLineColor = isDark ? '#2c2e33' : '#e9ecef'
  const tooltipBg = isDark ? '#25262b' : '#ffffff'
  const tooltipBorder = isDark ? '#373a40' : '#dee2e6'

  const tooltip: EChartsOption['tooltip'] =
    option.tooltip === undefined
      ? undefined
      : Array.isArray(option.tooltip)
        ? option.tooltip.map((t) => ({
            backgroundColor: tooltipBg,
            borderColor: tooltipBorder,
            textStyle: { color: textColor },
            ...t,
          }))
        : {
            backgroundColor: tooltipBg,
            borderColor: tooltipBorder,
            textStyle: { color: textColor },
            ...option.tooltip,
          }

  const legend: EChartsOption['legend'] = option.legend
    ? Array.isArray(option.legend)
      ? option.legend.map((l) => ({ textStyle: { color: textColor }, ...l }))
      : { textStyle: { color: textColor }, ...option.legend }
    : undefined

  const emptyCellBg = isDark ? '#2c2e33' : '#f1f3f5'
  const cellBorder = isDark ? '#1a1b1e' : '#ffffff'

  const mergeCalendar = (c: Record<string, unknown>) => ({
    ...c,
    itemStyle: {
      color: emptyCellBg,
      borderColor: cellBorder,
      borderWidth: 2,
      ...((c.itemStyle as object) ?? {}),
    },
    dayLabel: { color: textColor, ...((c.dayLabel as object) ?? {}) },
    monthLabel: { color: textColor, ...((c.monthLabel as object) ?? {}) },
    yearLabel: { color: textColor, ...((c.yearLabel as object) ?? {}) },
    splitLine: {
      lineStyle: { color: splitLineColor, opacity: 0.4 },
      ...((c.splitLine as object) ?? {}),
    },
  })
  const calendar: EChartsOption['calendar'] = option.calendar
    ? Array.isArray(option.calendar)
      ? (option.calendar as Array<Record<string, unknown>>).map(mergeCalendar)
      : mergeCalendar(option.calendar as Record<string, unknown>)
    : undefined

  const mergeVisualMap = (v: Record<string, unknown>) => ({
    ...v,
    textStyle: { color: textColor, ...((v.textStyle as object) ?? {}) },
  })
  const visualMap: EChartsOption['visualMap'] = option.visualMap
    ? Array.isArray(option.visualMap)
      ? (option.visualMap as Array<Record<string, unknown>>).map(mergeVisualMap)
      : mergeVisualMap(option.visualMap as Record<string, unknown>)
    : undefined

  const title: EChartsOption['title'] = option.title
    ? Array.isArray(option.title)
      ? option.title.map((t) => ({
          textStyle: { color: textColor },
          subtextStyle: { color: textColor, opacity: 0.7 },
          ...t,
        }))
      : {
          textStyle: { color: textColor },
          subtextStyle: { color: textColor, opacity: 0.7 },
          ...option.title,
        }
    : undefined

  const merged: EChartsOption = {
    ...option,
    backgroundColor: 'transparent',
    textStyle: { color: textColor, ...option.textStyle },
    tooltip,
    legend,
    title,
    calendar,
    visualMap,
    xAxis: applyAxisDefaults(option.xAxis, textColor, axisLineColor, splitLineColor),
    yAxis: applyAxisDefaults(option.yAxis, textColor, axisLineColor, splitLineColor),
  }

  return (
    <ReactECharts
      option={merged}
      style={style}
      onEvents={onEvents as never}
      notMerge
      lazyUpdate
      opts={{ renderer: 'canvas' }}
    />
  )
}
