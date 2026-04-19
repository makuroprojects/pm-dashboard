import type { ServerWebSocket } from 'bun'

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
  for (const set of connections.values()) {
    for (const ws of set) ws.send(msg)
  }
}

export function addConnection(ws: ServerWebSocket<{ userId: string }>, userId: string, isAdmin: boolean) {
  let set = connections.get(userId)
  if (!set) {
    set = new Set()
    connections.set(userId, set)
  }
  set.add(ws)

  // Every connected user gets current presence snapshot on connect
  ws.send(JSON.stringify({ type: 'presence', online: getOnlineUserIds() }))

  if (isAdmin) {
    adminSubs.add(ws)
  }

  broadcast()
}

export function broadcastToAdmins(message: object) {
  const msg = JSON.stringify(message)
  for (const ws of adminSubs) {
    ws.send(msg)
  }
}

export function broadcastToUser(userId: string, message: object) {
  const set = connections.get(userId)
  if (!set) return
  const msg = JSON.stringify(message)
  for (const ws of set) {
    ws.send(msg)
  }
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
