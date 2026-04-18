import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

export type Role = 'USER' | 'QC' | 'ADMIN' | 'SUPER_ADMIN'

export interface User {
  id: string
  name: string
  email: string
  role: Role
  blocked: boolean
}

export function getDefaultRoute(role: Role): string {
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return '/admin'
  return '/pm'
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useSession() {
  return useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () => apiFetch<{ user: User | null }>('/api/auth/session'),
    retry: false,
    staleTime: 30_000,
  })
}

export function useLogin() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (data: { email: string; password: string }) =>
      apiFetch<{ user: User }>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['auth', 'session'], data)
      navigate({ to: getDefaultRoute(data.user.role) })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: () => apiFetch<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.setQueryData(['auth', 'session'], { user: null })
      navigate({ to: '/login' })
    },
  })
}
