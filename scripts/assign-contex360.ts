import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const EMAILS = [
  { email: 'owner@contex360.com',    role: 'owner' },
  { email: 'admin@contex360.com',    role: 'Administrador' },
  { email: 'contador@contex360.com', role: 'Contador' },
  { email: 'auxiliar@contex360.com', role: 'Auxiliar contable' },
  { email: 'nomina@contex360.com',   role: 'Usuario nomina' },
  { email: 'gerencia@contex360.com', role: 'Gerencia' },
  { email: 'visor@contex360.com',    role: 'Visor' },
]

async function main() {
  // 1. Buscar o crear tenant Contex360
  let tenant = await prisma.tenant.findFirst({ where: { name: 'Contex360' } })

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: 'Contex360',
        prefix: 'CTX',
        securitySettings: {},
      },
    })
    console.log(`✅ Tenant creado: ${tenant.name} (${tenant.id})`)
  } else {
    console.log(`✅ Tenant existente: ${tenant.name} (${tenant.id})`)
  }

  // 2. Asignar cada usuario al tenant Contex360
  for (const u of EMAILS) {
    const user = await prisma.user.findUnique({ where: { email: u.email } })
    if (!user) {
      console.log(`⚠️  Usuario no encontrado: ${u.email}`)
      continue
    }

    const existing = await prisma.membership.findFirst({
      where: { userId: user.id, tenantId: tenant.id },
    })

    if (existing) {
      console.log(`ℹ️  Ya tiene membresía en Contex360: ${u.email}`)
    } else {
      await prisma.membership.create({
        data: { userId: user.id, tenantId: tenant.id, role: u.role },
      })
      console.log(`✅ Asignado a Contex360: ${u.email} | ${u.role}`)
    }
  }

  console.log('\n✔ Todos los usuarios asignados a Contex360')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
