import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { CommandPalette } from '@/frontend/components/CommandPalette'
import { ErrorPage } from '@/frontend/components/ErrorPage'
import { GlobalTaskModal } from '@/frontend/components/GlobalTaskModal'
import { NotFound } from '@/frontend/components/NotFound'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: ({ error }) => <ErrorPage error={error} />,
})

function RootLayout() {
  return (
    <>
      <Outlet />
      <GlobalTaskModal />
      <CommandPalette />
    </>
  )
}
