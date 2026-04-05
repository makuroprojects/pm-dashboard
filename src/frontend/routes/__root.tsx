import { ActionIcon, Tooltip, useMantineColorScheme } from '@mantine/core'
import { Outlet, createRootRouteWithContext } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { TbMoon, TbSun } from 'react-icons/tb'
import { NotFound } from '@/frontend/components/NotFound'
import { ErrorPage } from '@/frontend/components/ErrorPage'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: ({ error }) => <ErrorPage error={error} />,
})

function RootLayout() {
  const { colorScheme, toggleColorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'

  return (
    <>
      <Tooltip label={isDark ? 'Light mode' : 'Dark mode'} position="left">
        <ActionIcon
          variant="default"
          size="lg"
          onClick={toggleColorScheme}
          aria-label="Toggle color scheme"
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 1000,
          }}
        >
          {isDark ? <TbSun size={18} /> : <TbMoon size={18} />}
        </ActionIcon>
      </Tooltip>
      <Outlet />
    </>
  )
}
