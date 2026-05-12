import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const updated = await prisma.user.update({
    where: { email: 'owner@contex360.com' },
    data: { isSystemOwner: true },
  })
  console.log(`✅ ${updated.email} → isSystemOwner: ${updated.isSystemOwner}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
