import { notifications } from '@mantine/notifications'
import type { ReactNode } from 'react'

interface NotifyOptions {
  title?: string
  message: ReactNode
  id?: string
  autoClose?: number | false
}

export function notifySuccess(opts: NotifyOptions | string) {
  const o = typeof opts === 'string' ? { message: opts } : opts
  notifications.show({
    id: o.id,
    title: o.title ?? 'Berhasil',
    message: o.message,
    color: 'teal',
    autoClose: o.autoClose ?? 3500,
    withBorder: true,
    radius: 'md',
  })
}

export function notifyError(opts: NotifyOptions | string | unknown) {
  if (typeof opts === 'string') {
    notifications.show({
      title: 'Gagal',
      message: opts,
      color: 'red',
      withBorder: true,
      radius: 'md',
      autoClose: 5000,
    })
    return
  }
  if (opts && typeof opts === 'object' && 'message' in opts) {
    const o = opts as NotifyOptions
    notifications.show({
      id: o.id,
      title: o.title ?? 'Gagal',
      message: o.message,
      color: 'red',
      withBorder: true,
      radius: 'md',
      autoClose: o.autoClose ?? 5000,
    })
    return
  }
  const msg = opts instanceof Error ? opts.message : 'Terjadi kesalahan tak terduga.'
  notifications.show({
    title: 'Gagal',
    message: msg,
    color: 'red',
    withBorder: true,
    radius: 'md',
    autoClose: 5000,
  })
}

export function notifyInfo(opts: NotifyOptions | string) {
  const o = typeof opts === 'string' ? { message: opts } : opts
  notifications.show({
    id: o.id,
    title: o.title,
    message: o.message,
    color: 'blue',
    autoClose: o.autoClose ?? 3500,
    withBorder: true,
    radius: 'md',
  })
}

interface MutationNotifyOptions<T> {
  id?: string
  pending?: { title?: string; message: ReactNode }
  success?: { title?: string; message: ReactNode | ((result: T) => ReactNode) }
  error?: { title?: string; message?: ReactNode | ((err: unknown) => ReactNode) }
  fn: () => Promise<T>
}

export async function notifyMutation<T>(opts: MutationNotifyOptions<T>): Promise<T> {
  const id = opts.id ?? `mut-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  if (opts.pending) {
    notifications.show({
      id,
      title: opts.pending.title ?? 'Memproses…',
      message: opts.pending.message,
      color: 'blue',
      loading: true,
      autoClose: false,
      withBorder: true,
      radius: 'md',
    })
  }
  try {
    const result = await opts.fn()
    if (opts.success) {
      const message = typeof opts.success.message === 'function' ? opts.success.message(result) : opts.success.message
      notifications.update({
        id,
        title: opts.success.title ?? 'Berhasil',
        message,
        color: 'teal',
        loading: false,
        autoClose: 3500,
        withBorder: true,
        radius: 'md',
      })
    } else if (opts.pending) {
      notifications.hide(id)
    }
    return result
  } catch (err) {
    const message =
      opts.error?.message !== undefined
        ? typeof opts.error.message === 'function'
          ? opts.error.message(err)
          : opts.error.message
        : err instanceof Error
          ? err.message
          : 'Terjadi kesalahan tak terduga.'
    notifications.update({
      id,
      title: opts.error?.title ?? 'Gagal',
      message,
      color: 'red',
      loading: false,
      autoClose: 5000,
      withBorder: true,
      radius: 'md',
    })
    throw err
  }
}
