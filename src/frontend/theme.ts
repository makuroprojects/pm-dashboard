import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Card,
  type CSSVariablesResolver,
  createTheme,
  Divider,
  Menu,
  Modal,
  NavLink,
  Notification,
  Paper,
  Popover,
  Progress,
  SegmentedControl,
  Skeleton,
  Switch,
  TextInput,
  ThemeIcon,
  Tooltip,
} from '@mantine/core'

const SYSTEM_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, Roboto, "Helvetica Neue", Arial, sans-serif'
const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export const appTheme = createTheme({
  primaryColor: 'indigo',
  primaryShade: { light: 6, dark: 5 },
  fontFamily: `Inter, ${SYSTEM_FONT}`,
  fontFamilyMonospace: MONO_FONT,
  defaultRadius: 'md',
  cursorType: 'pointer',
  focusRing: 'auto',
  autoContrast: true,
  headings: {
    fontFamily: `Inter, ${SYSTEM_FONT}`,
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '1.875rem', lineHeight: '1.25' },
      h2: { fontSize: '1.5rem', lineHeight: '1.3' },
      h3: { fontSize: '1.25rem', lineHeight: '1.35' },
      h4: { fontSize: '1.0625rem', lineHeight: '1.4' },
      h5: { fontSize: '0.9375rem', lineHeight: '1.45' },
      h6: { fontSize: '0.8125rem', lineHeight: '1.5' },
    },
  },
  components: {
    Card: Card.extend({
      defaultProps: { radius: 'md', withBorder: true, shadow: 'xs' },
      styles: {
        root: {
          backgroundColor: 'var(--app-surface)',
          borderColor: 'var(--app-border-subtle)',
        },
      },
    }),
    Paper: Paper.extend({
      defaultProps: { radius: 'md' },
      styles: {
        root: {
          backgroundColor: 'var(--app-surface)',
        },
      },
    }),
    Button: Button.extend({
      defaultProps: { radius: 'md' },
    }),
    ActionIcon: ActionIcon.extend({
      defaultProps: { radius: 'md' },
    }),
    Badge: Badge.extend({
      defaultProps: { radius: 'sm' },
      styles: { root: { fontWeight: 600, letterSpacing: 0.2 } },
    }),
    Tooltip: Tooltip.extend({
      defaultProps: {
        withArrow: true,
        openDelay: 180,
        transitionProps: { transition: 'pop', duration: 120 },
        arrowSize: 6,
      },
    }),
    Modal: Modal.extend({
      defaultProps: {
        radius: 'lg',
        centered: true,
        overlayProps: { backgroundOpacity: 0.45, blur: 3 },
        transitionProps: { transition: 'pop', duration: 160 },
      },
    }),
    Menu: Menu.extend({
      defaultProps: {
        radius: 'md',
        shadow: 'md',
        withArrow: true,
        transitionProps: { transition: 'pop', duration: 140 },
      },
    }),
    Popover: Popover.extend({
      defaultProps: { radius: 'md', shadow: 'md', withArrow: true },
    }),
    Notification: Notification.extend({
      defaultProps: { radius: 'md' },
    }),
    TextInput: TextInput.extend({
      defaultProps: { radius: 'md' },
    }),
    SegmentedControl: SegmentedControl.extend({
      defaultProps: { radius: 'md' },
    }),
    Progress: Progress.extend({
      defaultProps: { radius: 'xl' },
    }),
    Switch: Switch.extend({
      defaultProps: { size: 'md' },
    }),
    Skeleton: Skeleton.extend({
      defaultProps: { radius: 'md' },
    }),
    Divider: Divider.extend({
      defaultProps: { color: 'var(--mantine-color-default-border)' },
    }),
    NavLink: NavLink.extend({
      defaultProps: { variant: 'light' },
      styles: {
        root: {
          borderRadius: 'var(--mantine-radius-md)',
          fontWeight: 500,
        },
      },
    }),
    ThemeIcon: ThemeIcon.extend({
      defaultProps: { radius: 'md' },
    }),
    Anchor: Anchor.extend({
      defaultProps: { underline: 'hover' },
    }),
  },
  other: {
    canvasLight: '#f1f3f7',
    surfaceLight: '#ffffff',
    navbarLight: '#ffffff',
    canvasDark: '#0a0b0e',
    surfaceDark: '#17181c',
    navbarDark: '#101115',
    borderSubtleLight: 'rgba(15, 23, 42, 0.06)',
    borderSubtleDark: 'rgba(255, 255, 255, 0.06)',
  },
})

export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {
    '--app-transition-fast': '120ms cubic-bezier(0.4, 0, 0.2, 1)',
    '--app-transition-base': '180ms cubic-bezier(0.4, 0, 0.2, 1)',
    '--app-shadow-card': '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 1px rgba(15, 23, 42, 0.03)',
  },
  light: {
    '--app-canvas': theme.other.canvasLight,
    '--app-surface': theme.other.surfaceLight,
    '--app-navbar-bg': theme.other.navbarLight,
    '--app-border-subtle': theme.other.borderSubtleLight,
    '--mantine-color-body': theme.other.canvasLight,
  },
  dark: {
    '--app-canvas': theme.other.canvasDark,
    '--app-surface': theme.other.surfaceDark,
    '--app-navbar-bg': theme.other.navbarDark,
    '--app-border-subtle': theme.other.borderSubtleDark,
    '--mantine-color-body': theme.other.canvasDark,
  },
})
