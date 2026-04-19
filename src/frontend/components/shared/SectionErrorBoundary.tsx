import { Alert, Button, Code, Collapse, Group, Stack, Text } from '@mantine/core'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TbAlertTriangle, TbChevronDown, TbChevronUp, TbRefresh } from 'react-icons/tb'

interface Props {
  label?: string
  children: ReactNode
  onReset?: () => void
}

interface State {
  error: Error | null
  showDetail: boolean
}

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null, showDetail: false }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof console !== 'undefined') {
      console.error('[SectionErrorBoundary]', this.props.label ?? 'section', error, info.componentStack)
    }
  }

  reset = () => {
    this.setState({ error: null, showDetail: false })
    this.props.onReset?.()
  }

  toggleDetail = () => this.setState((s) => ({ showDetail: !s.showDetail }))

  render() {
    const { error, showDetail } = this.state
    if (!error) return this.props.children

    return (
      <Alert
        variant="light"
        color="red"
        radius="md"
        icon={<TbAlertTriangle size={18} />}
        title={`Panel error${this.props.label ? ` — ${this.props.label}` : ''}`}
      >
        <Stack gap="xs">
          <Text size="sm">Komponen ini gagal dirender. Panel lain tetap berjalan. Coba muat ulang bagian ini.</Text>
          <Group gap="xs">
            <Button size="xs" variant="light" color="red" leftSection={<TbRefresh size={14} />} onClick={this.reset}>
              Muat ulang
            </Button>
            <Button
              size="xs"
              variant="subtle"
              color="gray"
              rightSection={showDetail ? <TbChevronUp size={14} /> : <TbChevronDown size={14} />}
              onClick={this.toggleDetail}
            >
              {showDetail ? 'Sembunyikan detail' : 'Lihat detail'}
            </Button>
          </Group>
          <Collapse in={showDetail}>
            <Code block fz="xs" style={{ maxHeight: 200, overflow: 'auto' }}>
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </Code>
          </Collapse>
        </Stack>
      </Alert>
    )
  }
}
