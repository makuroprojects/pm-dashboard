import { redis } from './redis'

export type LogLevel = 'info' | 'warn' | 'error'

export interface AppLogEntry {
  id: number
  level: LogLevel
  message: string
  detail?: string
  timestamp: string
}

const REDIS_KEY = 'app:logs'
const MAX_ENTRIES = 500
const ID_KEY = 'app:logs:next_id'

export async function appLog(level: LogLevel, message: string, detail?: string) {
  const id = await redis.incr(ID_KEY)
  const entry: AppLogEntry = {
    id,
    level,
    message,
    detail,
    timestamp: new Date().toISOString(),
  }
  await redis.lpush(REDIS_KEY, JSON.stringify(entry))
  await redis.ltrim(REDIS_KEY, 0, MAX_ENTRIES - 1)
}

export async function getAppLogs(options?: { level?: LogLevel; limit?: number; afterId?: number }): Promise<AppLogEntry[]> {
  const limit = options?.limit ?? 100
  // Fetch more than needed if filtering
  const fetchCount = options?.level || options?.afterId ? MAX_ENTRIES : limit
  const raw = await redis.lrange(REDIS_KEY, 0, fetchCount - 1)

  let logs: AppLogEntry[] = raw.map((s: string) => JSON.parse(s))

  if (options?.afterId) {
    logs = logs.filter((l) => l.id > options.afterId!)
  }
  if (options?.level) {
    logs = logs.filter((l) => l.level === options.level)
  }

  // lrange returns newest first (LPUSH), reverse to chronological order
  logs.reverse()

  return logs.slice(-limit)
}

export async function clearAppLogs() {
  await redis.del(REDIS_KEY)
  await redis.del(ID_KEY)
}
