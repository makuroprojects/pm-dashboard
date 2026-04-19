import { PrismaClient } from '../generated/prisma'
import type {
  NotificationKind,
  ProjectMemberRole,
  ProjectPriority,
  ProjectStatus,
  Role,
  TaskKind,
  TaskPriority,
  TaskStatus,
} from '../generated/prisma'

const prisma = new PrismaClient()

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAIL ?? '')
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean)

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

const now = new Date()
const daysAgo = (d: number) => new Date(now.getTime() - d * DAY)
const daysAhead = (d: number) => new Date(now.getTime() + d * DAY)
const hoursAgo = (h: number) => new Date(now.getTime() - h * HOUR)
const minutesAgo = (m: number) => new Date(now.getTime() - m * MINUTE)

function pick<T>(arr: readonly T[], i: number): T {
  return arr[i % arr.length]!
}

function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

async function hash(plain: string) {
  return Bun.password.hash(plain, { algorithm: 'bcrypt' })
}

// ──────────────────────────────────────────────────────────────
// 1. WIPE derivative data (keep schema, nuke rows)
// ──────────────────────────────────────────────────────────────
async function wipe() {
  console.log('⎯  Wiping existing data...')
  // Order respects FK constraints where onDelete isn't cascade-safe.
  await prisma.notification.deleteMany()
  await prisma.taskStatusChange.deleteMany()
  await prisma.taskComment.deleteMany()
  await prisma.taskEvidence.deleteMany()
  await prisma.taskChecklistItem.deleteMany()
  await prisma.taskDependency.deleteMany()
  await prisma.taskTag.deleteMany()
  await prisma.task.deleteMany()
  await prisma.tag.deleteMany()
  await prisma.projectExtension.deleteMany()
  await prisma.projectMilestone.deleteMany()
  await prisma.projectMember.deleteMany()
  await prisma.projectGithubEvent.deleteMany()
  await prisma.githubWebhookLog.deleteMany()
  await prisma.project.deleteMany()
  await prisma.activityEvent.deleteMany()
  await prisma.webhookRequestLog.deleteMany()
  await prisma.agent.deleteMany()
  await prisma.webhookToken.deleteMany()
  await prisma.auditLog.deleteMany()
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
  console.log('   done.\n')
}

// ──────────────────────────────────────────────────────────────
// 2. USERS (20 with varied roles, one blocked)
// ──────────────────────────────────────────────────────────────
type UserSeed = {
  name: string
  email: string
  password: string
  role: Role
  blocked?: boolean
}

const USER_SEEDS: UserSeed[] = [
  // Baseline (do not rename — used by tests and memory)
  { name: 'Super Admin', email: 'superadmin@example.com', password: 'superadmin123', role: 'SUPER_ADMIN' },
  { name: 'Admin', email: 'admin@example.com', password: 'admin123', role: 'ADMIN' },
  { name: 'User', email: 'user@example.com', password: 'user123', role: 'USER' },

  // Leadership
  { name: 'Ratna Pratama', email: 'ratna@example.com', password: 'pass1234', role: 'SUPER_ADMIN' },
  { name: 'Dewi Anggraini', email: 'dewi@example.com', password: 'pass1234', role: 'ADMIN' },
  { name: 'Bima Saputra', email: 'bima@example.com', password: 'pass1234', role: 'ADMIN' },

  // QC leads
  { name: 'Sari Wulandari', email: 'sari@example.com', password: 'pass1234', role: 'QC' },
  { name: 'Hendra Gunawan', email: 'hendra@example.com', password: 'pass1234', role: 'QC' },
  { name: 'Mira Kusuma', email: 'mira@example.com', password: 'pass1234', role: 'QC' },

  // Engineers
  { name: 'Andi Nugroho', email: 'andi@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Budi Santoso', email: 'budi@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Citra Ayu', email: 'citra@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Dimas Prasetyo', email: 'dimas@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Eka Putri', email: 'eka@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Fajar Ramadhan', email: 'fajar@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Gita Lestari', email: 'gita@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Hadi Wijaya', email: 'hadi@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Intan Permata', email: 'intan@example.com', password: 'pass1234', role: 'USER' },
  { name: 'Joko Susanto', email: 'joko@example.com', password: 'pass1234', role: 'USER' },

  // Blocked user (to test gated flows)
  { name: 'Kuro Diblokir', email: 'blocked@example.com', password: 'pass1234', role: 'USER', blocked: true },
]

async function seedUsers() {
  console.log('▶  Users...')
  const users: { id: string; email: string; name: string; role: Role }[] = []
  for (const u of USER_SEEDS) {
    const hashed = await hash(u.password)
    const rec = await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        password: hashed,
        role: u.role,
        blocked: u.blocked ?? false,
      },
    })
    users.push({ id: rec.id, email: rec.email, name: rec.name, role: rec.role })
  }
  for (const email of SUPER_ADMIN_EMAILS) {
    const existing = users.find((u) => u.email === email)
    if (existing) {
      await prisma.user.update({ where: { email }, data: { role: 'SUPER_ADMIN' } })
      existing.role = 'SUPER_ADMIN'
    } else {
      const rec = await prisma.user.create({
        data: { name: email.split('@')[0] ?? 'Admin', email, password: '', role: 'SUPER_ADMIN' },
      })
      users.push({ id: rec.id, email: rec.email, name: rec.name, role: rec.role })
    }
  }
  console.log(`   ${users.length} users\n`)
  return users
}

// ──────────────────────────────────────────────────────────────
// 3. PROJECTS (12 covering every status/priority/due variant)
// ──────────────────────────────────────────────────────────────
type ProjectSeed = {
  key: string
  name: string
  description: string
  status: ProjectStatus
  priority: ProjectPriority
  startsAtDays: number // negative = past
  endsAtDays: number | null
  originalEndAtDays?: number | null
  archived?: boolean
  githubRepo?: string
  ownerEmail: string
}

const PROJECT_SEEDS: ProjectSeed[] = [
  {
    key: 'pipeline',
    name: 'Pipeline Ingest v2',
    description: 'Realtime ingestion pipeline untuk event sensor lapangan.',
    status: 'ACTIVE',
    priority: 'CRITICAL',
    startsAtDays: -60,
    endsAtDays: -5, // past-due → red flag
    originalEndAtDays: -25,
    githubRepo: 'acme/pipeline-ingest',
    ownerEmail: 'dewi@example.com',
  },
  {
    key: 'mobile',
    name: 'Mobile App Redesign',
    description: 'Overhaul UX aplikasi mobile: onboarding, home, profile.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startsAtDays: -45,
    endsAtDays: 4, // ending soon
    originalEndAtDays: 10,
    githubRepo: 'acme/mobile-app',
    ownerEmail: 'bima@example.com',
  },
  {
    key: 'billing',
    name: 'Billing Platform Migration',
    description: 'Migrasi dari gateway lama ke stack baru dengan PCI compliance.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startsAtDays: -90,
    endsAtDays: 20,
    originalEndAtDays: 0,
    githubRepo: 'acme/billing-core',
    ownerEmail: 'ratna@example.com',
  },
  {
    key: 'reporting',
    name: 'Reporting Dashboard',
    description: 'Dashboard eksekutif dengan chart & export PDF mingguan.',
    status: 'ACTIVE',
    priority: 'MEDIUM',
    startsAtDays: -20,
    endsAtDays: 45, // healthy
    ownerEmail: 'dewi@example.com',
  },
  {
    key: 'auth',
    name: 'Auth Service Refresh',
    description: 'Rotasi library auth + audit compliance.',
    status: 'ACTIVE',
    priority: 'MEDIUM',
    startsAtDays: -14,
    endsAtDays: 30,
    ownerEmail: 'bima@example.com',
  },
  {
    key: 'marketing',
    name: 'Marketing Site Rewrite',
    description: 'Landing page baru dengan SEO & A/B testing.',
    status: 'ACTIVE',
    priority: 'LOW',
    startsAtDays: -7,
    endsAtDays: 60,
    ownerEmail: 'ratna@example.com',
  },
  {
    key: 'draft',
    name: 'Warehouse Analytics (Discovery)',
    description: 'Masih tahap discovery — scope belum disetujui.',
    status: 'DRAFT',
    priority: 'LOW',
    startsAtDays: 14,
    endsAtDays: 120,
    ownerEmail: 'dewi@example.com',
  },
  {
    key: 'hold',
    name: 'Legacy CMS Cleanup',
    description: 'On hold — menunggu keputusan vendor.',
    status: 'ON_HOLD',
    priority: 'LOW',
    startsAtDays: -50,
    endsAtDays: 60,
    ownerEmail: 'bima@example.com',
  },
  {
    key: 'compliance',
    name: 'Compliance Audit Q2',
    description: 'Audit internal quarterly, banyak deadline extension.',
    status: 'ACTIVE',
    priority: 'HIGH',
    startsAtDays: -70,
    endsAtDays: 3,
    originalEndAtDays: -30,
    ownerEmail: 'ratna@example.com',
  },
  {
    key: 'completed-early',
    name: 'Feature Flag Framework',
    description: 'Selesai lebih cepat dari rencana.',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    startsAtDays: -120,
    endsAtDays: -15,
    originalEndAtDays: -2,
    ownerEmail: 'dewi@example.com',
  },
  {
    key: 'completed-late',
    name: 'On-call Rotation Tool',
    description: 'Selesai dengan 2 kali extension.',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    startsAtDays: -180,
    endsAtDays: -30,
    originalEndAtDays: -70,
    ownerEmail: 'bima@example.com',
  },
  {
    key: 'cancelled',
    name: 'Internal Chatbot POC',
    description: 'POC dibatalkan karena prioritas berubah.',
    status: 'CANCELLED',
    priority: 'LOW',
    startsAtDays: -100,
    endsAtDays: -60,
    archived: true,
    ownerEmail: 'bima@example.com',
  },
]

async function seedProjects(users: { id: string; email: string }[]) {
  console.log('▶  Projects...')
  const byKey = new Map<string, { id: string; key: string; name: string; ownerId: string }>()
  for (const p of PROJECT_SEEDS) {
    const owner = users.find((u) => u.email === p.ownerEmail)
    if (!owner) throw new Error(`Owner ${p.ownerEmail} not seeded`)
    const rec = await prisma.project.create({
      data: {
        name: p.name,
        description: p.description,
        ownerId: owner.id,
        status: p.status,
        priority: p.priority,
        startsAt: daysAgo(-p.startsAtDays),
        endsAt: p.endsAtDays == null ? null : daysAgo(-p.endsAtDays),
        originalEndAt:
          p.originalEndAtDays == null
            ? p.endsAtDays == null
              ? null
              : daysAgo(-p.endsAtDays)
            : daysAgo(-p.originalEndAtDays),
        archivedAt: p.archived ? daysAgo(15) : null,
        githubRepo: p.githubRepo ?? null,
      },
    })
    byKey.set(p.key, { id: rec.id, key: p.key, name: p.name, ownerId: owner.id })
  }
  console.log(`   ${byKey.size} projects\n`)
  return byKey
}

// ──────────────────────────────────────────────────────────────
// 4. MEMBERS (wide coverage)
// ──────────────────────────────────────────────────────────────
async function seedMembers(
  projects: Map<string, { id: string; ownerId: string }>,
  users: { id: string; email: string; role: Role }[],
) {
  console.log('▶  Project members...')
  const byEmail = new Map(users.map((u) => [u.email, u.id] as const))
  // (projectKey, email, role)
  const rows: [string, string, ProjectMemberRole][] = [
    // Pipeline
    ['pipeline', 'dewi@example.com', 'OWNER'],
    ['pipeline', 'bima@example.com', 'PM'],
    ['pipeline', 'andi@example.com', 'MEMBER'],
    ['pipeline', 'budi@example.com', 'MEMBER'],
    ['pipeline', 'citra@example.com', 'MEMBER'],
    ['pipeline', 'sari@example.com', 'MEMBER'],
    ['pipeline', 'admin@example.com', 'MEMBER'],
    // Mobile
    ['mobile', 'bima@example.com', 'OWNER'],
    ['mobile', 'dewi@example.com', 'PM'],
    ['mobile', 'dimas@example.com', 'MEMBER'],
    ['mobile', 'eka@example.com', 'MEMBER'],
    ['mobile', 'fajar@example.com', 'MEMBER'],
    ['mobile', 'mira@example.com', 'MEMBER'],
    ['mobile', 'user@example.com', 'MEMBER'],
    // Billing
    ['billing', 'ratna@example.com', 'OWNER'],
    ['billing', 'bima@example.com', 'PM'],
    ['billing', 'gita@example.com', 'MEMBER'],
    ['billing', 'hadi@example.com', 'MEMBER'],
    ['billing', 'hendra@example.com', 'MEMBER'],
    ['billing', 'admin@example.com', 'MEMBER'],
    // Reporting
    ['reporting', 'dewi@example.com', 'OWNER'],
    ['reporting', 'intan@example.com', 'PM'],
    ['reporting', 'joko@example.com', 'MEMBER'],
    ['reporting', 'citra@example.com', 'MEMBER'],
    ['reporting', 'user@example.com', 'MEMBER'],
    // Auth
    ['auth', 'bima@example.com', 'OWNER'],
    ['auth', 'andi@example.com', 'PM'],
    ['auth', 'budi@example.com', 'MEMBER'],
    ['auth', 'sari@example.com', 'MEMBER'],
    // Marketing
    ['marketing', 'ratna@example.com', 'OWNER'],
    ['marketing', 'gita@example.com', 'PM'],
    ['marketing', 'eka@example.com', 'MEMBER'],
    ['marketing', 'intan@example.com', 'VIEWER'],
    // Draft
    ['draft', 'dewi@example.com', 'OWNER'],
    ['draft', 'joko@example.com', 'MEMBER'],
    // Hold
    ['hold', 'bima@example.com', 'OWNER'],
    ['hold', 'hadi@example.com', 'MEMBER'],
    ['hold', 'fajar@example.com', 'VIEWER'],
    // Compliance
    ['compliance', 'ratna@example.com', 'OWNER'],
    ['compliance', 'dewi@example.com', 'PM'],
    ['compliance', 'hendra@example.com', 'MEMBER'],
    ['compliance', 'mira@example.com', 'MEMBER'],
    ['compliance', 'admin@example.com', 'MEMBER'],
    // Completed early
    ['completed-early', 'dewi@example.com', 'OWNER'],
    ['completed-early', 'andi@example.com', 'MEMBER'],
    ['completed-early', 'citra@example.com', 'MEMBER'],
    // Completed late
    ['completed-late', 'bima@example.com', 'OWNER'],
    ['completed-late', 'dimas@example.com', 'MEMBER'],
    ['completed-late', 'budi@example.com', 'MEMBER'],
    // Cancelled
    ['cancelled', 'bima@example.com', 'OWNER'],
    ['cancelled', 'joko@example.com', 'MEMBER'],
  ]
  let count = 0
  for (const [key, email, role] of rows) {
    const proj = projects.get(key)
    const userId = byEmail.get(email)
    if (!proj || !userId) continue
    // Skip if this is the owner (already covered by Project.ownerId, but we still want an OWNER member row)
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: proj.id, userId } },
      update: { role },
      create: { projectId: proj.id, userId, role },
    })
    count++
  }
  console.log(`   ${count} memberships\n`)
}

// ──────────────────────────────────────────────────────────────
// 5. MILESTONES
// ──────────────────────────────────────────────────────────────
async function seedMilestones(projects: Map<string, { id: string }>) {
  console.log('▶  Milestones...')
  const rows: { key: string; title: string; dueDays: number; completed: boolean; order: number }[] = [
    { key: 'pipeline', title: 'Kafka consumer stabil', dueDays: -40, completed: true, order: 1 },
    { key: 'pipeline', title: 'Schema registry online', dueDays: -15, completed: true, order: 2 },
    { key: 'pipeline', title: 'Production cutover', dueDays: -5, completed: false, order: 3 },
    { key: 'mobile', title: 'Design system lock', dueDays: -20, completed: true, order: 1 },
    { key: 'mobile', title: 'Beta to staff', dueDays: 3, completed: false, order: 2 },
    { key: 'mobile', title: 'App Store submission', dueDays: 10, completed: false, order: 3 },
    { key: 'billing', title: 'PCI self-assessment', dueDays: -30, completed: true, order: 1 },
    { key: 'billing', title: 'Cutover in staging', dueDays: 7, completed: false, order: 2 },
    { key: 'billing', title: 'Production migration', dueDays: 20, completed: false, order: 3 },
    { key: 'reporting', title: 'v1 charts live', dueDays: 14, completed: false, order: 1 },
    { key: 'reporting', title: 'PDF export feature', dueDays: 30, completed: false, order: 2 },
    { key: 'auth', title: 'Library rotation', dueDays: 12, completed: false, order: 1 },
    { key: 'auth', title: 'Audit sign-off', dueDays: 25, completed: false, order: 2 },
    { key: 'compliance', title: 'Gap analysis', dueDays: -40, completed: true, order: 1 },
    { key: 'compliance', title: 'Remediation round 1', dueDays: -10, completed: true, order: 2 },
    { key: 'compliance', title: 'Final report', dueDays: 3, completed: false, order: 3 },
    { key: 'completed-early', title: 'Design done', dueDays: -30, completed: true, order: 1 },
    { key: 'completed-early', title: 'GA rollout', dueDays: -15, completed: true, order: 2 },
    { key: 'completed-late', title: 'PagerDuty sync', dueDays: -80, completed: true, order: 1 },
    { key: 'completed-late', title: 'Rotation live', dueDays: -30, completed: true, order: 2 },
  ]
  let count = 0
  for (const r of rows) {
    const proj = projects.get(r.key)
    if (!proj) continue
    await prisma.projectMilestone.create({
      data: {
        projectId: proj.id,
        title: r.title,
        dueAt: daysAgo(-r.dueDays),
        completedAt: r.completed ? daysAgo(-r.dueDays + rand(0, 3)) : null,
        order: r.order,
      },
    })
    count++
  }
  console.log(`   ${count} milestones\n`)
}

// ──────────────────────────────────────────────────────────────
// 6. EXTENSIONS (so health score can penalise projects with >2)
// ──────────────────────────────────────────────────────────────
async function seedExtensions(
  projects: Map<string, { id: string }>,
  users: { id: string; email: string }[],
) {
  console.log('▶  Extensions...')
  const byEmail = new Map(users.map((u) => [u.email, u.id] as const))
  const rows: { key: string; days: [number, number]; by: string; reason: string }[] = [
    // Compliance: 3 extensions (red flag >2)
    { key: 'compliance', days: [-30, -20], by: 'ratna@example.com', reason: 'Menunggu input vendor external' },
    { key: 'compliance', days: [-20, -10], by: 'ratna@example.com', reason: 'Remediasi audit tambahan' },
    { key: 'compliance', days: [-10, 3], by: 'ratna@example.com', reason: 'Final report butuh review legal' },
    // Pipeline: 2 extensions
    { key: 'pipeline', days: [-25, -15], by: 'dewi@example.com', reason: 'Backpressure di broker' },
    { key: 'pipeline', days: [-15, -5], by: 'dewi@example.com', reason: 'Schema registry upgrade delay' },
    // Billing: 1 extension
    { key: 'billing', days: [0, 20], by: 'ratna@example.com', reason: 'Butuh tambahan QA cycle' },
    // Mobile: 1 extension
    { key: 'mobile', days: [10, 4], by: 'bima@example.com', reason: 'Ditemukan bug crash di iOS 17' },
    // completed-late: 2 extensions (historical)
    { key: 'completed-late', days: [-70, -50], by: 'bima@example.com', reason: 'Tambah support alerting' },
    { key: 'completed-late', days: [-50, -30], by: 'bima@example.com', reason: 'Rewrite setelah user feedback' },
  ]
  let count = 0
  for (const r of rows) {
    const proj = projects.get(r.key)
    const authorId = byEmail.get(r.by)
    if (!proj) continue
    await prisma.projectExtension.create({
      data: {
        projectId: proj.id,
        extendedById: authorId,
        previousEndAt: daysAgo(-r.days[0]),
        newEndAt: daysAgo(-r.days[1]),
        reason: r.reason,
        createdAt: daysAgo(-r.days[0] + 1),
      },
    })
    count++
  }
  console.log(`   ${count} extensions\n`)
}

// ──────────────────────────────────────────────────────────────
// 7. TAGS
// ──────────────────────────────────────────────────────────────
async function seedTags(projects: Map<string, { id: string }>) {
  console.log('▶  Tags...')
  const tagByProject = new Map<string, { id: string; name: string }[]>()
  const template: [string, string][] = [
    ['frontend', 'indigo'],
    ['backend', 'teal'],
    ['infra', 'grape'],
    ['urgent', 'red'],
    ['tech-debt', 'gray'],
  ]
  for (const [key, proj] of projects.entries()) {
    const tags: { id: string; name: string }[] = []
    for (const [name, color] of template) {
      const t = await prisma.tag.create({
        data: { projectId: proj.id, name, color },
      })
      tags.push({ id: t.id, name: t.name })
    }
    tagByProject.set(key, tags)
  }
  console.log(`   ${tagByProject.size * template.length} tags\n`)
  return tagByProject
}

// ──────────────────────────────────────────────────────────────
// 8. TASKS (the heavy lifter — all variants)
// ──────────────────────────────────────────────────────────────
type TaskSeed = {
  projectKey: string
  kind: TaskKind
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  reporterEmail: string
  assigneeEmail: string | null
  startsAtDays?: number | null
  dueAtDays?: number | null
  estimateHours?: number | null
  progressPercent?: number | null
  closedAtDays?: number | null
  updatedAtDays?: number | null // for stale IN_PROGRESS detection
  tagNames?: string[]
  checklist?: { title: string; done: boolean }[]
  comments?: { by: string; body: string; daysAgo: number }[]
  evidence?: { kind: string; url: string; note?: string }[]
}

// Intentionally hand-authored to ensure every dashboard shows rich variety.
// Dates use negative=past, positive=future.
const TASK_SEEDS: TaskSeed[] = [
  // ───── Pipeline (past-due project, many open criticals) ─────
  {
    projectKey: 'pipeline',
    kind: 'BUG',
    title: 'Consumer crash saat backpressure > 5k msg/s',
    description: 'Kafka consumer crash dengan OOM saat lag > 5000.',
    status: 'IN_PROGRESS',
    priority: 'CRITICAL',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'andi@example.com',
    startsAtDays: -4,
    dueAtDays: -2, // overdue
    estimateHours: 12,
    progressPercent: 60,
    updatedAtDays: -1,
    tagNames: ['backend', 'urgent'],
    checklist: [
      { title: 'Reproduce di staging', done: true },
      { title: 'Tambah metrics lag per-partition', done: true },
      { title: 'Tune JVM heap + G1GC', done: false },
      { title: 'Validasi load test 10k msg/s', done: false },
    ],
    comments: [
      { by: 'dewi@example.com', body: 'Sudah di-page oncall dua kali minggu ini.', daysAgo: 2 },
      { by: 'andi@example.com', body: 'Dapat heap dump, sedang analisa.', daysAgo: 1 },
    ],
  },
  {
    projectKey: 'pipeline',
    kind: 'TASK',
    title: 'Rollout schema registry v2',
    description: 'Upgrade schema registry + migrasi topic producer.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'budi@example.com',
    startsAtDays: -10,
    dueAtDays: -3, // overdue
    estimateHours: 20,
    progressPercent: 45,
    updatedAtDays: -5, // stale
    tagNames: ['infra', 'backend'],
    checklist: [
      { title: 'Dry-run di staging', done: true },
      { title: 'Coordinate dengan producer teams', done: false },
    ],
  },
  {
    projectKey: 'pipeline',
    kind: 'QC',
    title: 'QC load test 10k msg/s end-to-end',
    description: 'Verifikasi throughput & error rate setelah tuning.',
    status: 'READY_FOR_QC',
    priority: 'HIGH',
    reporterEmail: 'sari@example.com',
    assigneeEmail: 'sari@example.com',
    startsAtDays: -2,
    dueAtDays: 1, // today-ish
    estimateHours: 8,
    tagNames: ['backend'],
  },
  {
    projectKey: 'pipeline',
    kind: 'BUG',
    title: 'Duplikat event setelah consumer restart',
    description: 'Offset commit race saat graceful shutdown.',
    status: 'REOPENED',
    priority: 'HIGH',
    reporterEmail: 'sari@example.com',
    assigneeEmail: 'citra@example.com',
    startsAtDays: -6,
    dueAtDays: 2,
    estimateHours: 6,
    progressPercent: 30,
    tagNames: ['backend', 'tech-debt'],
  },
  {
    projectKey: 'pipeline',
    kind: 'TASK',
    title: 'Dokumentasi runbook on-call',
    description: 'Runbook alerting + troubleshooting steps.',
    status: 'OPEN',
    priority: 'MEDIUM',
    reporterEmail: 'bima@example.com',
    assigneeEmail: null, // unassigned — visible in triage
    dueAtDays: 7,
    estimateHours: 4,
    tagNames: ['tech-debt'],
  },
  {
    projectKey: 'pipeline',
    kind: 'TASK',
    title: 'Dashboards Grafana consumer lag',
    description: 'Tambah panel per-partition lag + alert p95 latency.',
    status: 'CLOSED',
    priority: 'MEDIUM',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'admin@example.com',
    startsAtDays: -14,
    dueAtDays: -7,
    closedAtDays: -5,
    estimateHours: 6,
    tagNames: ['infra'],
    evidence: [{ kind: 'link', url: 'https://grafana.internal/d/kafka-lag', note: 'Dashboard live' }],
  },
  {
    projectKey: 'pipeline',
    kind: 'TASK',
    title: 'Refactor batch writer',
    description: 'Pindah batch writer ke worker pool.',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'andi@example.com',
    startsAtDays: -9,
    dueAtDays: 5,
    estimateHours: 16,
    progressPercent: 20,
    updatedAtDays: -6, // very stale
    tagNames: ['backend', 'tech-debt'],
  },

  // ───── Mobile (ending soon, mix of statuses) ─────
  {
    projectKey: 'mobile',
    kind: 'TASK',
    title: 'Redesign onboarding flow',
    description: '3 screen onboarding dengan animasi Lottie.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'dimas@example.com',
    startsAtDays: -12,
    dueAtDays: 2,
    estimateHours: 24,
    progressPercent: 70,
    updatedAtDays: 0,
    tagNames: ['frontend'],
    checklist: [
      { title: 'Welcome screen', done: true },
      { title: 'Permission prompts', done: true },
      { title: 'Animations', done: false },
    ],
  },
  {
    projectKey: 'mobile',
    kind: 'BUG',
    title: 'Crash iOS 17 saat open deep-link',
    description: 'Hanya terjadi pada iOS 17.0 dan 17.1.',
    status: 'OPEN',
    priority: 'CRITICAL',
    reporterEmail: 'mira@example.com',
    assigneeEmail: 'eka@example.com',
    dueAtDays: 1,
    estimateHours: 8,
    tagNames: ['frontend', 'urgent'],
    comments: [{ by: 'mira@example.com', body: 'Repro di semua iPhone 15 dev fleet.', daysAgo: 1 }],
  },
  {
    projectKey: 'mobile',
    kind: 'TASK',
    title: 'Home dashboard kartu revenue',
    description: 'Kartu revenue dengan drill-down.',
    status: 'READY_FOR_QC',
    priority: 'MEDIUM',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'fajar@example.com',
    startsAtDays: -7,
    dueAtDays: 0, // today
    estimateHours: 12,
    tagNames: ['frontend'],
  },
  {
    projectKey: 'mobile',
    kind: 'QC',
    title: 'QC regression iOS + Android',
    description: 'Full regression matrix device farm.',
    status: 'OPEN',
    priority: 'HIGH',
    reporterEmail: 'mira@example.com',
    assigneeEmail: 'mira@example.com',
    dueAtDays: 3,
    estimateHours: 10,
    tagNames: ['frontend', 'urgent'],
  },
  {
    projectKey: 'mobile',
    kind: 'TASK',
    title: 'Profile screen + avatar upload',
    description: 'Pilih foto dari gallery atau kamera.',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'user@example.com', // our "Ditugaskan ke saya" subject
    startsAtDays: -5,
    dueAtDays: -1, // overdue for user@
    estimateHours: 10,
    progressPercent: 40,
    updatedAtDays: -4, // ghost reminder candidate
    tagNames: ['frontend'],
  },
  {
    projectKey: 'mobile',
    kind: 'BUG',
    title: 'Avatar upload gagal di Android 10',
    description: 'Permission MANAGE_EXTERNAL_STORAGE tidak granted.',
    status: 'OPEN',
    priority: 'MEDIUM',
    reporterEmail: 'mira@example.com',
    assigneeEmail: 'user@example.com',
    dueAtDays: 2,
    estimateHours: 4,
    tagNames: ['frontend'],
  },
  {
    projectKey: 'mobile',
    kind: 'TASK',
    title: 'App icon + splash asli',
    description: 'Ganti asset brand refresh.',
    status: 'CLOSED',
    priority: 'LOW',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'fajar@example.com',
    startsAtDays: -20,
    dueAtDays: -15,
    closedAtDays: -14,
    estimateHours: 2,
    tagNames: ['frontend'],
  },

  // ───── Billing (big project, many closures) ─────
  {
    projectKey: 'billing',
    kind: 'TASK',
    title: 'Replace payment adapter Stripe → Xendit',
    description: 'Abstraksi PaymentGateway, refactor semua caller.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'gita@example.com',
    startsAtDays: -15,
    dueAtDays: 5,
    estimateHours: 30,
    progressPercent: 65,
    updatedAtDays: 0,
    tagNames: ['backend'],
    checklist: [
      { title: 'Interface abstraksi', done: true },
      { title: 'Adapter Xendit', done: true },
      { title: 'Migrasi caller', done: false },
      { title: 'Integration test', done: false },
    ],
  },
  {
    projectKey: 'billing',
    kind: 'BUG',
    title: 'Webhook Xendit signature mismatch intermittent',
    description: 'Hash mismatch 2-3% dari payload.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    reporterEmail: 'hadi@example.com',
    assigneeEmail: 'hadi@example.com',
    startsAtDays: -3,
    dueAtDays: 0, // due today
    estimateHours: 8,
    progressPercent: 50,
    updatedAtDays: 0,
    tagNames: ['backend', 'urgent'],
  },
  {
    projectKey: 'billing',
    kind: 'QC',
    title: 'QC PCI compliance pre-audit',
    description: 'Checklist PCI DSS quick-scan.',
    status: 'OPEN',
    priority: 'HIGH',
    reporterEmail: 'hendra@example.com',
    assigneeEmail: 'hendra@example.com',
    dueAtDays: 6,
    estimateHours: 12,
    tagNames: ['backend'],
  },
  {
    projectKey: 'billing',
    kind: 'TASK',
    title: 'Migration script v1 → v2',
    description: 'Script idempotent dengan rollback.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'gita@example.com',
    startsAtDays: -25,
    dueAtDays: -15,
    closedAtDays: -14,
    estimateHours: 16,
    tagNames: ['backend'],
    evidence: [{ kind: 'link', url: 'https://github.com/acme/billing-core/pull/142' }],
  },
  {
    projectKey: 'billing',
    kind: 'TASK',
    title: 'Audit log append-only',
    description: 'Semua mutasi harus landing di audit log.',
    status: 'CLOSED',
    priority: 'MEDIUM',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'admin@example.com',
    startsAtDays: -30,
    dueAtDays: -20,
    closedAtDays: -18,
    estimateHours: 6,
    tagNames: ['backend'],
  },
  {
    projectKey: 'billing',
    kind: 'TASK',
    title: 'Rate limit per-merchant',
    description: 'Rate limit redis-backed per merchant_id.',
    status: 'OPEN',
    priority: 'MEDIUM',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'admin@example.com',
    dueAtDays: 4,
    estimateHours: 8,
    tagNames: ['backend'],
  },
  {
    projectKey: 'billing',
    kind: 'BUG',
    title: 'Refund failure saat partial amount',
    description: 'Only full refund path works.',
    status: 'CLOSED',
    priority: 'MEDIUM',
    reporterEmail: 'hadi@example.com',
    assigneeEmail: 'gita@example.com',
    startsAtDays: -10,
    dueAtDays: -5,
    closedAtDays: -6,
    estimateHours: 4,
    tagNames: ['backend'],
  },

  // ───── Reporting (smaller, healthy) ─────
  {
    projectKey: 'reporting',
    kind: 'TASK',
    title: 'Chart revenue vs forecast',
    description: 'Echarts line dengan overlay forecast.',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    reporterEmail: 'intan@example.com',
    assigneeEmail: 'joko@example.com',
    startsAtDays: -5,
    dueAtDays: 6,
    estimateHours: 12,
    progressPercent: 35,
    updatedAtDays: -1,
    tagNames: ['frontend'],
  },
  {
    projectKey: 'reporting',
    kind: 'TASK',
    title: 'PDF export server-side',
    description: 'Render chart → PDF via Puppeteer.',
    status: 'OPEN',
    priority: 'MEDIUM',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: null,
    dueAtDays: 14,
    estimateHours: 10,
    tagNames: ['backend'],
  },
  {
    projectKey: 'reporting',
    kind: 'TASK',
    title: 'Schedule report mingguan',
    description: 'Email PDF setiap Senin 06:00 WIB.',
    status: 'OPEN',
    priority: 'LOW',
    reporterEmail: 'intan@example.com',
    assigneeEmail: 'citra@example.com',
    dueAtDays: 20,
    estimateHours: 6,
    tagNames: ['backend'],
  },
  {
    projectKey: 'reporting',
    kind: 'TASK',
    title: 'Design empty state dashboards',
    description: 'State saat belum ada data.',
    status: 'CLOSED',
    priority: 'LOW',
    reporterEmail: 'intan@example.com',
    assigneeEmail: 'joko@example.com',
    startsAtDays: -8,
    dueAtDays: -3,
    closedAtDays: -3,
    estimateHours: 3,
    tagNames: ['frontend'],
  },

  // ───── Auth (medium, mixed) ─────
  {
    projectKey: 'auth',
    kind: 'TASK',
    title: 'Bump bcrypt → argon2id',
    description: 'Migrasi hash existing user on next-login.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'andi@example.com',
    startsAtDays: -6,
    dueAtDays: 4,
    estimateHours: 10,
    progressPercent: 50,
    updatedAtDays: -1,
    tagNames: ['backend'],
  },
  {
    projectKey: 'auth',
    kind: 'BUG',
    title: 'Session cookie tidak invalidate setelah block',
    description: 'Edge case logout admin flow.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'sari@example.com',
    assigneeEmail: 'budi@example.com',
    startsAtDays: -7,
    dueAtDays: -2,
    closedAtDays: -2,
    estimateHours: 4,
    tagNames: ['backend', 'urgent'],
  },
  {
    projectKey: 'auth',
    kind: 'QC',
    title: 'QC OAuth Google edge cases',
    description: 'Matriks edge case OAuth.',
    status: 'READY_FOR_QC',
    priority: 'MEDIUM',
    reporterEmail: 'sari@example.com',
    assigneeEmail: 'sari@example.com',
    startsAtDays: -2,
    dueAtDays: 7,
    estimateHours: 6,
    tagNames: ['backend'],
  },

  // ───── Marketing (low priority, low pressure) ─────
  {
    projectKey: 'marketing',
    kind: 'TASK',
    title: 'Landing hero section',
    description: 'Copy + hero image.',
    status: 'IN_PROGRESS',
    priority: 'MEDIUM',
    reporterEmail: 'gita@example.com',
    assigneeEmail: 'eka@example.com',
    startsAtDays: -3,
    dueAtDays: 10,
    estimateHours: 8,
    progressPercent: 25,
    updatedAtDays: -1,
    tagNames: ['frontend'],
  },
  {
    projectKey: 'marketing',
    kind: 'TASK',
    title: 'SEO meta + OG tags',
    description: 'Semua route SEO ready.',
    status: 'OPEN',
    priority: 'LOW',
    reporterEmail: 'gita@example.com',
    assigneeEmail: null,
    dueAtDays: 30,
    estimateHours: 3,
    tagNames: ['frontend'],
  },
  {
    projectKey: 'marketing',
    kind: 'TASK',
    title: 'Blog content drop #1 (5 posts)',
    description: 'Drop konten pertama.',
    status: 'OPEN',
    priority: 'LOW',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'gita@example.com',
    dueAtDays: 25,
    estimateHours: 12,
    tagNames: [],
  },

  // ───── Compliance (extensions + urgent, few tasks) ─────
  {
    projectKey: 'compliance',
    kind: 'TASK',
    title: 'Gap analysis ISO 27001',
    description: 'Matriks control vs implementation.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'hendra@example.com',
    startsAtDays: -40,
    dueAtDays: -35,
    closedAtDays: -33,
    estimateHours: 16,
    tagNames: [],
  },
  {
    projectKey: 'compliance',
    kind: 'TASK',
    title: 'Remediation batch 1 (10 findings)',
    description: 'Closure finding prioritas tinggi.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'mira@example.com',
    startsAtDays: -25,
    dueAtDays: -12,
    closedAtDays: -11,
    estimateHours: 24,
    tagNames: [],
  },
  {
    projectKey: 'compliance',
    kind: 'TASK',
    title: 'Final audit report',
    description: 'Dokumen final + exec summary.',
    status: 'IN_PROGRESS',
    priority: 'HIGH',
    reporterEmail: 'ratna@example.com',
    assigneeEmail: 'admin@example.com',
    startsAtDays: -5,
    dueAtDays: 3,
    estimateHours: 12,
    progressPercent: 60,
    updatedAtDays: 0,
    tagNames: [],
  },

  // ───── Hold / Cancelled / Draft: minimal tasks ─────
  {
    projectKey: 'hold',
    kind: 'TASK',
    title: 'Vendor evaluation CMS',
    description: 'Comparison matrix 3 vendor.',
    status: 'OPEN',
    priority: 'LOW',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'hadi@example.com',
    dueAtDays: 60,
    estimateHours: 8,
    tagNames: [],
  },
  {
    projectKey: 'draft',
    kind: 'TASK',
    title: 'Define analytics scope',
    description: 'Draft RFC untuk persetujuan.',
    status: 'OPEN',
    priority: 'LOW',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'joko@example.com',
    dueAtDays: 30,
    estimateHours: 6,
    tagNames: [],
  },

  // ───── Completed projects: historical closed tasks (for velocity) ─────
  {
    projectKey: 'completed-early',
    kind: 'TASK',
    title: 'Design evaluator interface',
    description: 'Feature flag evaluator API.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'andi@example.com',
    startsAtDays: -90,
    dueAtDays: -70,
    closedAtDays: -68,
    estimateHours: 20,
    tagNames: [],
  },
  {
    projectKey: 'completed-early',
    kind: 'TASK',
    title: 'Rollout tooling',
    description: 'CLI + UI untuk ops.',
    status: 'CLOSED',
    priority: 'MEDIUM',
    reporterEmail: 'dewi@example.com',
    assigneeEmail: 'citra@example.com',
    startsAtDays: -60,
    dueAtDays: -30,
    closedAtDays: -25,
    estimateHours: 16,
    tagNames: [],
  },
  {
    projectKey: 'completed-late',
    kind: 'TASK',
    title: 'PagerDuty integration',
    description: 'Sync rotation → PD.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'dimas@example.com',
    startsAtDays: -150,
    dueAtDays: -90,
    closedAtDays: -85,
    estimateHours: 20,
    tagNames: [],
  },
  {
    projectKey: 'completed-late',
    kind: 'BUG',
    title: 'Timezone drift pada schedule',
    description: 'DST handling.',
    status: 'CLOSED',
    priority: 'HIGH',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'budi@example.com',
    startsAtDays: -120,
    dueAtDays: -80,
    closedAtDays: -78,
    estimateHours: 8,
    tagNames: [],
  },
  {
    projectKey: 'cancelled',
    kind: 'TASK',
    title: 'Prototype chatbot rasa',
    description: 'POC rasa NLU.',
    status: 'CLOSED',
    priority: 'LOW',
    reporterEmail: 'bima@example.com',
    assigneeEmail: 'joko@example.com',
    startsAtDays: -90,
    dueAtDays: -65,
    closedAtDays: -65,
    estimateHours: 10,
    tagNames: [],
  },
]

type CreatedTask = {
  id: string
  projectKey: string
  projectId: string
  title: string
  status: TaskStatus
  reporterId: string
  assigneeId: string | null
  createdAt: Date
  startsAt: Date | null
  closedAt: Date | null
}

async function seedTasks(
  projects: Map<string, { id: string }>,
  users: { id: string; email: string; role: Role }[],
  tagByProject: Map<string, { id: string; name: string }[]>,
) {
  console.log('▶  Tasks...')
  const byEmail = new Map(users.map((u) => [u.email, u.id] as const))
  const created: CreatedTask[] = []
  for (const t of TASK_SEEDS) {
    const proj = projects.get(t.projectKey)
    if (!proj) continue
    const reporterId = byEmail.get(t.reporterEmail)
    const assigneeId = t.assigneeEmail ? (byEmail.get(t.assigneeEmail) ?? null) : null
    if (!reporterId) continue

    // createdAt: before startsAtDays if set, else a day before dueAtDays, else 3d ago
    const createdDaysAgo =
      (t.startsAtDays != null ? -t.startsAtDays : t.dueAtDays != null ? -t.dueAtDays + 2 : 3) + 1
    const createdAt = daysAgo(createdDaysAgo)

    const rec = await prisma.task.create({
      data: {
        projectId: proj.id,
        kind: t.kind,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        reporterId,
        assigneeId,
        startsAt: t.startsAtDays != null ? daysAgo(-t.startsAtDays) : null,
        dueAt: t.dueAtDays != null ? daysAgo(-t.dueAtDays) : null,
        estimateHours: t.estimateHours ?? null,
        progressPercent: t.progressPercent ?? null,
        closedAt: t.closedAtDays != null ? daysAgo(-t.closedAtDays) : null,
        createdAt,
        updatedAt: t.updatedAtDays != null ? daysAgo(-t.updatedAtDays) : createdAt,
      },
    })
    created.push({
      id: rec.id,
      projectKey: t.projectKey,
      projectId: proj.id,
      title: rec.title,
      status: rec.status,
      reporterId,
      assigneeId,
      createdAt,
      startsAt: rec.startsAt,
      closedAt: rec.closedAt,
    })

    // tags
    const tagPool = tagByProject.get(t.projectKey) ?? []
    for (const name of t.tagNames ?? []) {
      const tag = tagPool.find((x) => x.name === name)
      if (tag) {
        await prisma.taskTag.create({ data: { taskId: rec.id, tagId: tag.id } })
      }
    }
    // checklist
    if (t.checklist) {
      for (let i = 0; i < t.checklist.length; i++) {
        const item = t.checklist[i]!
        await prisma.taskChecklistItem.create({
          data: { taskId: rec.id, title: item.title, done: item.done, order: i },
        })
      }
    }
    // comments (respect project member role for authorTag)
    for (const c of t.comments ?? []) {
      const authorId = byEmail.get(c.by) ?? null
      // derive member role tag cheaply: fall back to user role
      const author = users.find((u) => u.email === c.by)
      const tag = author?.role === 'SUPER_ADMIN' ? 'SUPER_ADMIN' : author?.role ?? 'MEMBER'
      await prisma.taskComment.create({
        data: {
          taskId: rec.id,
          authorId,
          authorTag: tag,
          body: c.body,
          createdAt: daysAgo(c.daysAgo),
        },
      })
    }
    // evidence
    for (const e of t.evidence ?? []) {
      await prisma.taskEvidence.create({
        data: { taskId: rec.id, kind: e.kind, url: e.url, note: e.note ?? null },
      })
    }
    // status change history: infer a reasonable walk
    const path: TaskStatus[] = statusHistoryFor(t.status)
    for (let i = 1; i < path.length; i++) {
      await prisma.taskStatusChange.create({
        data: {
          taskId: rec.id,
          authorId: assigneeId ?? reporterId,
          fromStatus: path[i - 1]!,
          toStatus: path[i]!,
          createdAt: new Date(createdAt.getTime() + i * 4 * HOUR + rand(0, 10) * MINUTE),
        },
      })
    }
  }
  console.log(`   ${created.length} tasks\n`)
  return created
}

function statusHistoryFor(final: TaskStatus): TaskStatus[] {
  switch (final) {
    case 'OPEN':
      return ['OPEN']
    case 'IN_PROGRESS':
      return ['OPEN', 'IN_PROGRESS']
    case 'READY_FOR_QC':
      return ['OPEN', 'IN_PROGRESS', 'READY_FOR_QC']
    case 'REOPENED':
      return ['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'CLOSED', 'REOPENED']
    case 'CLOSED':
      return ['OPEN', 'IN_PROGRESS', 'READY_FOR_QC', 'CLOSED']
  }
}

// ──────────────────────────────────────────────────────────────
// 9. DEPENDENCIES (a few chains within pipeline + billing)
// ──────────────────────────────────────────────────────────────
async function seedDependencies(tasks: CreatedTask[]) {
  console.log('▶  Dependencies...')
  const byKeyTitle = new Map<string, CreatedTask>()
  for (const t of tasks) byKeyTitle.set(`${t.projectKey}::${t.title}`, t)
  const links: [string, string][] = [
    // Pipeline: QC blocked by consumer crash fix
    ['pipeline::QC load test 10k msg/s end-to-end', 'pipeline::Consumer crash saat backpressure > 5k msg/s'],
    // Pipeline: rollout blocked by batch writer refactor
    ['pipeline::Rollout schema registry v2', 'pipeline::Refactor batch writer'],
    // Mobile: QC blocked by redesign
    ['mobile::QC regression iOS + Android', 'mobile::Redesign onboarding flow'],
    // Billing: PCI QC blocked by adapter swap
    ['billing::QC PCI compliance pre-audit', 'billing::Replace payment adapter Stripe → Xendit'],
    // Auth: QC blocked by argon2 migration
    ['auth::QC OAuth Google edge cases', 'auth::Bump bcrypt → argon2id'],
  ]
  let count = 0
  for (const [depKey, blockerKey] of links) {
    const task = byKeyTitle.get(depKey)
    const blocker = byKeyTitle.get(blockerKey)
    if (!task || !blocker) continue
    await prisma.taskDependency.create({
      data: { taskId: task.id, blockedById: blocker.id },
    })
    count++
  }
  console.log(`   ${count} dependency links\n`)
}

// ──────────────────────────────────────────────────────────────
// 10. AGENTS + ACTIVITY EVENTS (pm-watch data for effort tracking)
// ──────────────────────────────────────────────────────────────
async function seedAgents(users: { id: string; email: string }[]) {
  console.log('▶  Agents + activity events...')
  const byEmail = new Map(users.map((u) => [u.email, u.id] as const))
  type AgentSeed = {
    agentId: string
    hostname: string
    osUser: string
    status: 'PENDING' | 'APPROVED' | 'REVOKED'
    claimedByEmail: string | null
    lastSeenHoursAgo: number | null
    events: { title: string; app: string; daysAgo: number; durationSec: number }[]
  }
  const seeds: AgentSeed[] = [
    {
      agentId: 'aw-dev-andi-01',
      hostname: 'andi-macbook.local',
      osUser: 'andi',
      status: 'APPROVED',
      claimedByEmail: 'andi@example.com',
      lastSeenHoursAgo: 1,
      events: buildEvents('Consumer crash saat backpressure', 'Code', [1, 2, 3, 4, 5, 6, 7]),
    },
    {
      agentId: 'aw-dev-budi-01',
      hostname: 'budi-thinkpad.local',
      osUser: 'budi',
      status: 'APPROVED',
      claimedByEmail: 'budi@example.com',
      lastSeenHoursAgo: 12,
      events: buildEvents('schema-registry', 'Terminal', [2, 3, 5, 7, 9]),
    },
    {
      agentId: 'aw-dev-gita-01',
      hostname: 'gita-mbp.local',
      osUser: 'gita',
      status: 'APPROVED',
      claimedByEmail: 'gita@example.com',
      lastSeenHoursAgo: 3,
      events: buildEvents('billing-core', 'Code', [0, 1, 2, 3, 4, 5]),
    },
    {
      agentId: 'aw-dev-dimas-01',
      hostname: 'dimas-mbp.local',
      osUser: 'dimas',
      status: 'APPROVED',
      claimedByEmail: 'dimas@example.com',
      lastSeenHoursAgo: 2,
      events: buildEvents('mobile-app onboarding', 'Figma', [1, 2, 3, 4]),
    },
    {
      agentId: 'aw-dev-pending-01',
      hostname: 'unknown-device.local',
      osUser: 'devops',
      status: 'PENDING',
      claimedByEmail: null,
      lastSeenHoursAgo: 0,
      events: [],
    },
    {
      agentId: 'aw-dev-offline-01',
      hostname: 'ex-contractor.local',
      osUser: 'contractor',
      status: 'REVOKED',
      claimedByEmail: null,
      lastSeenHoursAgo: 24 * 15,
      events: [],
    },
  ]

  let evCount = 0
  for (const s of seeds) {
    const claimedById = s.claimedByEmail ? (byEmail.get(s.claimedByEmail) ?? null) : null
    const agent = await prisma.agent.create({
      data: {
        agentId: s.agentId,
        hostname: s.hostname,
        osUser: s.osUser,
        status: s.status,
        claimedById,
        lastSeenAt: s.lastSeenHoursAgo != null ? hoursAgo(s.lastSeenHoursAgo) : null,
      },
    })
    let eventId = 1
    const bucketId = `aw-watcher-window_${s.hostname}`
    for (const ev of s.events) {
      await prisma.activityEvent.create({
        data: {
          agentId: agent.id,
          bucketId,
          eventId: eventId++,
          timestamp: daysAgo(ev.daysAgo),
          duration: ev.durationSec,
          data: { app: ev.app, title: ev.title },
        },
      })
      evCount++
    }
  }
  console.log(`   ${seeds.length} agents, ${evCount} activity events\n`)
}

function buildEvents(
  titleSeed: string,
  app: string,
  days: number[],
): { title: string; app: string; daysAgo: number; durationSec: number }[] {
  const out: { title: string; app: string; daysAgo: number; durationSec: number }[] = []
  for (const d of days) {
    // 3-6 events per day, 15-90 min each
    const n = rand(3, 6)
    for (let i = 0; i < n; i++) {
      out.push({
        title: `${titleSeed} — session ${i + 1}`,
        app,
        daysAgo: d + i * 0.05, // slight spread so timestamps differ
        durationSec: rand(15 * 60, 90 * 60),
      })
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────
// 11. WEBHOOK TOKENS + REQUEST LOGS
// ──────────────────────────────────────────────────────────────
async function seedWebhooks(users: { id: string; email: string }[]) {
  console.log('▶  Webhook tokens + logs...')
  const superAdmin = users.find((u) => u.email === 'superadmin@example.com')
  if (!superAdmin) return
  const tokens = [
    { name: 'pm-watch prod', prefix: 'whk_a1b2', status: 'ACTIVE' as const, expiresDaysAhead: null as number | null },
    { name: 'pm-watch staging', prefix: 'whk_c3d4', status: 'ACTIVE' as const, expiresDaysAhead: 90 },
    { name: 'deprecated laptop fleet', prefix: 'whk_e5f6', status: 'DISABLED' as const, expiresDaysAhead: null },
    { name: 'revoked (leaked)', prefix: 'whk_x9y9', status: 'REVOKED' as const, expiresDaysAhead: null },
  ]
  const tokenRecs: { id: string; name: string }[] = []
  for (const t of tokens) {
    const rec = await prisma.webhookToken.create({
      data: {
        name: t.name,
        tokenHash: `fakehash_${t.prefix}_${Math.random().toString(36).slice(2)}`,
        tokenPrefix: t.prefix,
        status: t.status,
        expiresAt: t.expiresDaysAhead != null ? daysAhead(t.expiresDaysAhead) : null,
        lastUsedAt: t.status === 'ACTIVE' ? minutesAgo(rand(5, 120)) : null,
        createdById: superAdmin.id,
      },
    })
    tokenRecs.push({ id: rec.id, name: rec.name })
  }

  // Request logs (last 7 days)
  const agents = await prisma.agent.findMany({ where: { status: 'APPROVED' } })
  let count = 0
  for (let i = 0; i < 60; i++) {
    const tok = pick(tokenRecs, i)
    const ag = agents.length > 0 ? pick(agents, i) : null
    const succ = Math.random() < 0.8
    const auth = !succ && Math.random() < 0.3
    const statusCode = succ ? 200 : auth ? 403 : 500
    await prisma.webhookRequestLog.create({
      data: {
        tokenId: tok.id,
        agentId: ag?.id,
        statusCode,
        reason: succ ? 'ok' : auth ? 'invalid-token' : 'upstream-error',
        ip: `10.0.${rand(0, 3)}.${rand(1, 254)}`,
        eventsIn: succ ? rand(10, 300) : 0,
        createdAt: hoursAgo(rand(0, 24 * 7)),
      },
    })
    count++
  }
  console.log(`   ${tokenRecs.length} tokens, ${count} request logs\n`)
}

// ──────────────────────────────────────────────────────────────
// 12. GITHUB EVENTS (for linked projects)
// ──────────────────────────────────────────────────────────────
async function seedGithub(
  projects: Map<string, { id: string }>,
  users: { id: string; email: string; name: string }[],
) {
  console.log('▶  GitHub events...')
  const linked: { key: string; actors: string[] }[] = [
    { key: 'pipeline', actors: ['andi@example.com', 'budi@example.com', 'citra@example.com'] },
    { key: 'mobile', actors: ['dimas@example.com', 'eka@example.com', 'fajar@example.com'] },
    { key: 'billing', actors: ['gita@example.com', 'hadi@example.com', 'admin@example.com'] },
  ]
  let count = 0
  for (const l of linked) {
    const proj = projects.get(l.key)
    if (!proj) continue
    // 15 commits over last 14 days
    for (let i = 0; i < 15; i++) {
      const actorEmail = pick(l.actors, i)
      const user = users.find((u) => u.email === actorEmail)
      const sha = `sha${l.key}${i.toString(16).padStart(6, '0')}`
      await prisma.projectGithubEvent.create({
        data: {
          projectId: proj.id,
          kind: 'PUSH_COMMIT',
          actorLogin: user?.name.replace(/\s+/g, '').toLowerCase() ?? 'unknown',
          actorEmail,
          matchedUserId: user?.id ?? null,
          title: `fix: iteration ${i + 1} on ${l.key}`,
          url: `https://github.com/acme/${l.key}/commit/${sha}`,
          sha,
          metadata: { additions: rand(5, 200), deletions: rand(1, 100) },
          createdAt: daysAgo(i * 0.8),
        },
      })
      count++
    }
    // PRs: 5 opened, 3 merged, 1 closed-without-merge
    for (let i = 0; i < 5; i++) {
      const actorEmail = pick(l.actors, i)
      const user = users.find((u) => u.email === actorEmail)
      const prNumber = 100 + i
      await prisma.projectGithubEvent.create({
        data: {
          projectId: proj.id,
          kind: 'PR_OPENED',
          actorLogin: user?.name.replace(/\s+/g, '').toLowerCase() ?? 'unknown',
          actorEmail,
          matchedUserId: user?.id ?? null,
          title: `[${l.key}] feat: PR #${prNumber}`,
          url: `https://github.com/acme/${l.key}/pull/${prNumber}`,
          prNumber,
          createdAt: daysAgo(2 + i * 1.2),
        },
      })
      count++
      if (i < 3) {
        await prisma.projectGithubEvent.create({
          data: {
            projectId: proj.id,
            kind: 'PR_MERGED',
            actorLogin: user?.name.replace(/\s+/g, '').toLowerCase() ?? 'unknown',
            actorEmail,
            matchedUserId: user?.id ?? null,
            title: `[${l.key}] feat: PR #${prNumber}`,
            url: `https://github.com/acme/${l.key}/pull/${prNumber}`,
            prNumber,
            createdAt: daysAgo(1 + i * 1.1),
          },
        })
        count++
      } else if (i === 3) {
        await prisma.projectGithubEvent.create({
          data: {
            projectId: proj.id,
            kind: 'PR_CLOSED',
            actorLogin: user?.name.replace(/\s+/g, '').toLowerCase() ?? 'unknown',
            actorEmail,
            matchedUserId: user?.id ?? null,
            title: `[${l.key}] feat: PR #${prNumber}`,
            url: `https://github.com/acme/${l.key}/pull/${prNumber}`,
            prNumber,
            createdAt: daysAgo(1 + i * 1.1),
          },
        })
        count++
      }
      // Reviews (only on PRs 1 and 2)
      if (i < 2) {
        const reviewerEmail = pick(l.actors, i + 1)
        const reviewer = users.find((u) => u.email === reviewerEmail)
        await prisma.projectGithubEvent.create({
          data: {
            projectId: proj.id,
            kind: 'PR_REVIEWED',
            actorLogin: reviewer?.name.replace(/\s+/g, '').toLowerCase() ?? 'unknown',
            actorEmail: reviewerEmail,
            matchedUserId: reviewer?.id ?? null,
            title: `[${l.key}] review on PR #${prNumber}`,
            url: `https://github.com/acme/${l.key}/pull/${prNumber}#pullrequestreview`,
            prNumber,
            metadata: { state: 'APPROVED' },
            createdAt: daysAgo(1.5 + i),
          },
        })
        count++
      }
    }
    // GithubWebhookLog
    for (let i = 0; i < 8; i++) {
      await prisma.githubWebhookLog.create({
        data: {
          projectId: proj.id,
          deliveryId: `delivery-${l.key}-${i}`,
          event: pick(['push', 'pull_request', 'pull_request_review', 'ping'], i),
          statusCode: 200,
          ip: `140.82.${rand(100, 120)}.${rand(1, 254)}`,
          eventsIn: rand(1, 5),
          createdAt: daysAgo(i * 0.5),
        },
      })
    }
  }
  console.log(`   ${count} github events\n`)
}

// ──────────────────────────────────────────────────────────────
// 13. NOTIFICATIONS (for pm Overview aktivitas terbaru)
// ──────────────────────────────────────────────────────────────
async function seedNotifications(
  users: { id: string; email: string }[],
  tasks: CreatedTask[],
) {
  console.log('▶  Notifications...')
  const byEmail = new Map(users.map((u) => [u.email, u.id] as const))
  // Heavy bias toward user@ (our demo subject) + admin@
  const recipients = ['user@example.com', 'admin@example.com', 'andi@example.com', 'gita@example.com', 'dimas@example.com']
  const kinds: NotificationKind[] = [
    'TASK_ASSIGNED',
    'TASK_COMMENTED',
    'TASK_STATUS_CHANGED',
    'TASK_DUE_SOON',
    'TASK_OVERDUE',
    'TASK_MENTIONED',
  ]
  const titles: Record<NotificationKind, string> = {
    TASK_ASSIGNED: 'Task baru ditugaskan ke kamu',
    TASK_COMMENTED: 'Komentar baru di task kamu',
    TASK_STATUS_CHANGED: 'Status task berubah',
    TASK_DUE_SOON: 'Task segera jatuh tempo',
    TASK_OVERDUE: 'Task melewati deadline',
    TASK_MENTIONED: 'Kamu di-mention di task',
  }
  let count = 0
  for (let i = 0; i < 40; i++) {
    const recipientId = byEmail.get(pick(recipients, i))
    if (!recipientId) continue
    const kind = pick(kinds, i)
    const task = pick(tasks, i + 3)
    const actor = pick(users.filter((u) => u.email !== pick(recipients, i)), i)
    await prisma.notification.create({
      data: {
        recipientId,
        actorId: actor.id,
        kind,
        taskId: task.id,
        projectId: task.projectId,
        title: titles[kind],
        body: `${kind === 'TASK_COMMENTED' ? 'Ada update terbaru' : 'Task'}: ${task.title}`,
        readAt: Math.random() < 0.3 ? hoursAgo(rand(1, 48)) : null,
        createdAt: hoursAgo(rand(0, 72)),
      },
    })
    count++
  }
  console.log(`   ${count} notifications\n`)
}

// ──────────────────────────────────────────────────────────────
// 14. AUDIT LOGS
// ──────────────────────────────────────────────────────────────
async function seedAuditLogs(users: { id: string; email: string }[]) {
  console.log('▶  Audit logs...')
  const actions = ['LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'ROLE_CHANGED', 'BLOCKED', 'UNBLOCKED']
  let count = 0
  for (let i = 0; i < 80; i++) {
    const u = pick(users, i)
    const action = pick(actions, i)
    await prisma.auditLog.create({
      data: {
        userId: u.id,
        action,
        detail:
          action === 'ROLE_CHANGED'
            ? 'USER → ADMIN'
            : action === 'BLOCKED'
              ? 'blocked by super-admin'
              : action === 'LOGIN_FAILED'
                ? 'wrong password'
                : null,
        ip: `192.168.${rand(0, 10)}.${rand(1, 254)}`,
        createdAt: hoursAgo(rand(0, 24 * 30)),
      },
    })
    count++
  }
  console.log(`   ${count} audit logs\n`)
}

// ──────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────
async function main() {
  const start = Date.now()
  await wipe()
  const users = await seedUsers()
  const projects = await seedProjects(users)
  await seedMembers(projects, users)
  await seedMilestones(projects)
  await seedExtensions(projects, users)
  const tagByProject = await seedTags(projects)
  const tasks = await seedTasks(projects, users, tagByProject)
  await seedDependencies(tasks)
  await seedAgents(users)
  await seedWebhooks(users)
  await seedGithub(projects, users)
  await seedNotifications(users, tasks)
  await seedAuditLogs(users)
  console.log(`✓  Seed selesai dalam ${((Date.now() - start) / 1000).toFixed(1)}s`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
