import type { ServerWebSocket } from 'bun'

interface PresenceSocket {
  ws: ServerWebSocket<{ userId: string }>
  userId: string
}

// userId → Set of WebSocket connections (one user can have multiple tabs)
const connections = new Map<string, Set<ServerWebSocket<{ userId: string }>>>()

// Admin subscribers — get notified of all presence changes
const adminSubs = new Set<ServerWebSocket<{ userId: string }>>()

export function getOnlineUserIds(): string[] {
  return Array.from(connections.keys())
}

function broadcast() {
  const online = getOnlineUserIds()
  const msg = JSON.stringify({ type: 'presence', online })
  for (const ws of adminSubs) {
    ws.send(msg)
  }
}

export function addConnection(ws: ServerWebSocket<{ userId: string }>, userId: string, isAdmin: boolean) {
  let set = connections.get(userId)
  if (!set) {
    set = new Set()
    connections.set(userId, set)
  }
  set.add(ws)

  if (isAdmin) {
    adminSubs.add(ws)
    // Send current state immediately to new admin subscriber
    ws.send(JSON.stringify({ type: 'presence', online: getOnlineUserIds() }))
  }

  broadcast()
}

export function removeConnection(ws: ServerWebSocket<{ userId: string }>) {
  const userId = ws.data.userId
  const set = connections.get(userId)
  if (set) {
    set.delete(ws)
    if (set.size === 0) {
      connections.delete(userId)
    }
  }
  adminSubs.delete(ws)
  broadcast()
}
