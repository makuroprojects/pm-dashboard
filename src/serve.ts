// Dev entry. Two roles:
// 1. Prevent dual instances: if a previous `bun run dev` is still alive,
//    kill it before we bind. Bun sets SO_REUSEPORT, so without this guard
//    two instances can both listen on the same port and split traffic —
//    the symptom is HTML served by one process and /api/* 404 from the other.
// 2. EADDRINUSE race on Bun 1.3.6 HMR: the dynamic import delays app load
//    by one microtask so the kernel has time to release the old socket.

import fs from 'node:fs'
import path from 'node:path'

const PID_FILE = path.join(process.cwd(), '.dev-server.pid')

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function takeOver() {
  if (fs.existsSync(PID_FILE)) {
    const raw = fs.readFileSync(PID_FILE, 'utf-8').trim()
    const prev = Number(raw)
    if (Number.isFinite(prev) && prev !== process.pid && isAlive(prev)) {
      try {
        process.kill(prev, 'SIGTERM')
        console.log(`[dev] killed stale dev server pid=${prev}`)
      } catch (e) {
        console.warn(`[dev] could not kill pid=${prev}:`, e)
      }
    }
  }
  fs.writeFileSync(PID_FILE, String(process.pid))

  const cleanup = () => {
    try {
      const raw = fs.readFileSync(PID_FILE, 'utf-8').trim()
      if (Number(raw) === process.pid) fs.unlinkSync(PID_FILE)
    } catch {}
  }
  process.on('exit', cleanup)
  process.on('SIGINT', () => {
    cleanup()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    cleanup()
    process.exit(0)
  })
}

takeOver()

import('./index.tsx')
