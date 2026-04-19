import { Anchor, Breadcrumbs as MantineBreadcrumbs, Text } from '@mantine/core'
import type { ReactNode } from 'react'
import { TbChevronRight } from 'react-icons/tb'

export interface Crumb {
  key?: string
  label: ReactNode
  onClick?: () => void
}

function crumbKey(item: Crumb, i: number): string {
  if (item.key) return item.key
  if (typeof item.label === 'string' || typeof item.label === 'number') return `${i}:${item.label}`
  return `crumb-${i}`
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <MantineBreadcrumbs separator={<TbChevronRight size={14} />} separatorMargin={6}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        const key = crumbKey(item, i)
        if (isLast || !item.onClick) {
          return (
            <Text key={key} size="sm" c={isLast ? undefined : 'dimmed'} fw={isLast ? 500 : 400} truncate maw={240}>
              {item.label}
            </Text>
          )
        }
        return (
          <Anchor
            key={key}
            size="sm"
            c="dimmed"
            onClick={(e) => {
              e.preventDefault()
              item.onClick?.()
            }}
            style={{ cursor: 'pointer' }}
          >
            {item.label}
          </Anchor>
        )
      })}
    </MantineBreadcrumbs>
  )
}
