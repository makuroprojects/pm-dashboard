import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { adminTools } from './tools/admin'
import { agentsTools, agentsReadonly } from './tools/agents'
import { codeTools } from './tools/code'
import { dbTools } from './tools/db'
import { devTools } from './tools/dev'
import { githubReadonly } from './tools/github'
import { healthTools } from './tools/health'
import { logsAdmin, logsReadonly } from './tools/logs'
import { milestonesReadonly, milestonesTools } from './tools/milestones'
import { overviewReadonly } from './tools/overview'
import { presenceTools } from './tools/presence'
import { projectTools } from './tools/project'
import { projectsReadonly, projectsTools } from './tools/projects'
import { redisTools } from './tools/redis'
import { tagsReadonly, tagsTools } from './tools/tags'
import { tasksReadonly, tasksTools } from './tools/tasks'
import { webhooksTools, webhooksReadonly } from './tools/webhooks'
import type { McpScope, ToolModule } from './tools/shared'

export type { McpScope }

const READONLY_MODULES: ToolModule[] = [
  dbTools,
  logsReadonly,
  presenceTools,
  healthTools,
  projectTools,
  codeTools,
  agentsReadonly,
  webhooksReadonly,
  githubReadonly,
  projectsReadonly,
  tasksReadonly,
  tagsReadonly,
  milestonesReadonly,
  overviewReadonly,
]

const ADMIN_MODULES: ToolModule[] = [
  ...READONLY_MODULES,
  logsAdmin,
  adminTools,
  devTools,
  redisTools,
  agentsTools,
  webhooksTools,
  projectsTools,
  tasksTools,
  tagsTools,
  milestonesTools,
]

export function createMcpServer(scope: McpScope = 'admin'): McpServer {
  const server = new McpServer({
    name: 'pm-dashboard',
    version: '0.3.0',
  })

  const modules = scope === 'admin' ? ADMIN_MODULES : READONLY_MODULES
  for (const mod of modules) {
    mod.register(server)
  }

  return server
}

if (import.meta.main) {
  const scope: McpScope = process.env.MCP_SCOPE === 'readonly' ? 'readonly' : 'admin'
  const server = createMcpServer(scope)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
