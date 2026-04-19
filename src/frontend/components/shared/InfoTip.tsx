import { ThemeIcon, Tooltip } from '@mantine/core'
import { TbInfoCircle } from 'react-icons/tb'

interface InfoTipProps {
  label: string
  width?: number
  size?: number
  color?: string
}

export function InfoTip({ label, width = 320, size = 14, color = 'gray' }: InfoTipProps) {
  return (
    <Tooltip multiline w={width} withArrow label={label}>
      <ThemeIcon variant="subtle" color={color} size="sm" radius="xl" style={{ cursor: 'help' }}>
        <TbInfoCircle size={size} />
      </ThemeIcon>
    </Tooltip>
  )
}
