import { spawn } from 'node:child_process'

interface Call {
  name: string
  args?: Record<string, unknown>
  label?: string
}

const calls: Call[] = [
  // readonly / safe
  { name: 'health_full' },
  { name: 'db_count_by_table' },
  { name: 'db_list_users', args: { limit: 5 } },
  { name: 'db_list_sessions', args: { limit: 5 } },
  { name: 'db_list_audit_logs', args: { limit: 5 } },
  { name: 'logs_app', args: { limit: 5 } },
  { name: 'logs_audit', args: { limit: 5 } },
  { name: 'presence_online' },
  { name: 'project_routes' },
  { name: 'project_schema' },
  { name: 'project_dependencies' },
  { name: 'project_migrations' },
  { name: 'project_env_map' },
  { name: 'project_structure' },
  { name: 'code_read_file', args: { path: 'package.json', limit: 10 } },
  { name: 'code_read_file', args: { path: '../../../etc/passwd' }, label: 'traversal guard' },
  { name: 'code_grep', args: { pattern: 'createMcpServer', maxResults: 3 } },
  { name: 'code_stat', args: { path: 'scripts/mcp/server.ts' } },
  { name: 'redis_info' },
  { name: 'redis_set', args: { key: 'mcp:test:key', value: 'hello', ttlSeconds: 60 } },
  { name: 'redis_get', args: { key: 'mcp:test:key' } },
  { name: 'redis_keys', args: { pattern: 'mcp:test:*', limit: 10 } },
  { name: 'redis_del', args: { keys: ['mcp:test:key'] } },
  // overview (readonly aggregates)
  { name: 'admin_overview' },
  { name: 'project_health', args: { limit: 10 } },
  { name: 'team_load', args: { limit: 10 } },
  { name: 'risk_report' },
  // admin / write (transactional — we create then clean up)
  { name: 'admin_create_user', args: { name: 'MCP Tester', email: `mcp-test-${Date.now()}@example.com`, password: 'testpass123', role: 'USER' } },
]

function send(child: ReturnType<typeof spawn>, msg: unknown) {
  child.stdin!.write(`${JSON.stringify(msg)}\n`)
}

function summarize(result: unknown): string {
  try {
    const r = result as { content?: { text: string }[]; isError?: boolean }
    if (!r?.content?.[0]) return '(no content)'
    const text = r.content[0].text
    const parsed = JSON.parse(text)
    if (parsed.error) return `ERROR: ${parsed.error}`
    // Pick key summary fields
    const keys = Object.keys(parsed).slice(0, 4)
    const parts: string[] = []
    for (const k of keys) {
      const v = parsed[k]
      if (Array.isArray(v)) parts.push(`${k}=${v.length}`)
      else if (typeof v === 'object' && v !== null) parts.push(`${k}=<obj>`)
      else if (typeof v === 'string') parts.push(`${k}=${v.length > 60 ? `${v.slice(0, 60)}…` : v}`)
      else parts.push(`${k}=${v}`)
    }
    return parts.join(' ')
  } catch {
    return String(result).slice(0, 120)
  }
}

async function main() {
  const child = spawn('bun', ['run', 'scripts/mcp/server.ts'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, MCP_SCOPE: 'admin' },
  })

  const pending = new Map<number, (r: unknown) => void>()
  let buffer = ''
  child.stdout!.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)!(msg.error ?? msg.result)
          pending.delete(msg.id)
        }
      } catch {}
    }
  })

  function call(id: number, method: string, params?: unknown) {
    return new Promise<unknown>((resolve) => {
      pending.set(id, resolve)
      send(child, { jsonrpc: '2.0', id, method, params })
    })
  }

  // Initialize
  await call(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-harness', version: '1.0' },
  })
  send(child, { jsonrpc: '2.0', method: 'notifications/initialized' })

  // List tools
  const listed = (await call(2, 'tools/list')) as { tools: { name: string }[] }
  console.log(`Available tools: ${listed.tools.length}`)
  const names = new Set(listed.tools.map((t) => t.name))

  // Run each call
  let id = 10
  let passed = 0
  let failed = 0
  let createdUserId: string | null = null
  for (const c of calls) {
    if (!names.has(c.name)) {
      console.log(`  ⚠️  ${c.name}: tool not registered`)
      failed++
      continue
    }
    const label = c.label ? ` [${c.label}]` : ''
    const started = Date.now()
    const result = (await call(++id, 'tools/call', { name: c.name, arguments: c.args ?? {} })) as any
    const dur = Date.now() - started
    const summary = summarize(result)
    const ok = !result?.isError && !summary.startsWith('ERROR:')
    // For admin_create_user capture the id
    if (c.name === 'admin_create_user') {
      try {
        const parsed = JSON.parse(result.content[0].text)
        if (parsed.ok && parsed.user?.id) createdUserId = parsed.user.id
      } catch {}
    }
    const marker = ok ? '✅' : '⚠️'
    console.log(`  ${marker} ${c.name}${label} (${dur}ms) — ${summary}`)
    ok ? passed++ : failed++
  }

  // Exercise user lifecycle if we created one
  if (createdUserId) {
    console.log(`\n--- User lifecycle test (userId=${createdUserId}) ---`)
    const seq: Call[] = [
      { name: 'db_get_user', args: { id: createdUserId } },
      { name: 'admin_set_user_role', args: { userId: createdUserId, role: 'ADMIN' } },
      { name: 'admin_block_user', args: { userId: createdUserId, reason: 'test' } },
      { name: 'admin_unblock_user', args: { userId: createdUserId } },
      { name: 'admin_reset_password', args: { userId: createdUserId, newPassword: 'newpass456' } },
      { name: 'admin_revoke_sessions', args: { userId: createdUserId } },
    ]
    for (const c of seq) {
      const r = (await call(++id, 'tools/call', { name: c.name, arguments: c.args ?? {} })) as any
      const summary = summarize(r)
      const ok = !r?.isError && !summary.startsWith('ERROR:')
      console.log(`  ${ok ? '✅' : '⚠️'} ${c.name} — ${summary}`)
      ok ? passed++ : failed++
    }
    // Clean up created user via raw prisma (not via tool, to ensure gone)
    const { prisma } = await import('../../src/lib/db')
    await prisma.session.deleteMany({ where: { userId: createdUserId } })
    await prisma.auditLog.deleteMany({ where: { userId: createdUserId } })
    await prisma.user.delete({ where: { id: createdUserId } })
    console.log('  🧹 cleaned up test user')
  }

  // Dev tools — run a quick typecheck + lint to confirm spawn works
  console.log('\n--- Dev automation ---')
  for (const c of [
    { name: 'dev_typecheck', args: { timeoutMs: 120_000 } },
    { name: 'dev_db_generate', args: { timeoutMs: 60_000 } },
  ]) {
    const r = (await call(++id, 'tools/call', { name: c.name, arguments: c.args })) as any
    try {
      const parsed = JSON.parse(r.content[0].text)
      const ok = parsed.exitCode === 0
      console.log(`  ${ok ? '✅' : '⚠️'} ${c.name} exit=${parsed.exitCode} duration=${parsed.durationMs}ms timedOut=${parsed.timedOut}`)
      ok ? passed++ : failed++
    } catch (e) {
      console.log(`  ⚠️ ${c.name}: parse error — ${e}`)
      failed++
    }
  }

  console.log(`\n==== Summary ====\n  passed: ${passed}\n  failed: ${failed}\n  total : ${passed + failed}`)

  child.kill()
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
