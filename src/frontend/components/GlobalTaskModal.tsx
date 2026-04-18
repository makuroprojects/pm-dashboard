import { useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'

export function GlobalTaskModal() {
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ taskId?: string; projectId?: string }>).detail
      if (!detail?.taskId) return
      navigate({
        to: '/pm',
        search: detail.projectId
          ? { tab: 'tasks', projectId: detail.projectId, taskId: detail.taskId }
          : { tab: 'tasks', taskId: detail.taskId },
      })
    }
    window.addEventListener('pm:openTask', handler)
    return () => window.removeEventListener('pm:openTask', handler)
  }, [navigate])

  return null
}
