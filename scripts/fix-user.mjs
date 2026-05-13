import { PrismaClient } from '@prisma/client'
const p = new PrismaClient()

const email = 'brayancmm173@gmail.com'

const users = await p.user.findMany({
  where: { email },
  include: { memberships: true }
})

console.log('Users found:', JSON.stringify(users, null, 2))

if (users.length > 0) {
  for (const u of users) {
    await p.userSecurityProfile.deleteMany({ where: { userId: u.id } })
    await p.membership.deleteMany({ where: { userId: u.id } })
    await p.user.delete({ where: { id: u.id } })
    console.log('Deleted user:', u.email)
  }
}

await p.$disconnect()
