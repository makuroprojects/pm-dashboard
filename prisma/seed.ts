import { PrismaClient } from '../generated/prisma'

const prisma = new PrismaClient()

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAIL ?? '').split(',').map(e => e.trim()).filter(Boolean)

async function main() {
  const users = [
    { name: 'Super Admin', email: 'superadmin@example.com', password: 'superadmin123', role: 'SUPER_ADMIN' as const },
    { name: 'Admin', email: 'admin@example.com', password: 'admin123', role: 'ADMIN' as const },
    { name: 'User', email: 'user@example.com', password: 'user123', role: 'USER' as const },
  ]

  for (const u of users) {
    const hashed = await Bun.password.hash(u.password, { algorithm: 'bcrypt' })
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, password: hashed, role: u.role },
      create: { name: u.name, email: u.email, password: hashed, role: u.role },
    })
    console.log(`Seeded: ${u.email} (${u.role})`)
  }

  // Ensure super-admin emails from env exist and are promoted.
  // Creates with empty password so Google OAuth path remains the only credential.
  for (const email of SUPER_ADMIN_EMAILS) {
    await prisma.user.upsert({
      where: { email },
      update: { role: 'SUPER_ADMIN' },
      create: { name: email.split('@')[0], email, password: '', role: 'SUPER_ADMIN' },
    })
    console.log(`Ensured SUPER_ADMIN: ${email}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
