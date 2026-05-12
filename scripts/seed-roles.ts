import { PrismaClient } from '@prisma/client'
import { hashSync } from 'bcryptjs'

const prisma = new PrismaClient()

const TENANT_ID = 'tenant-001'
const TENANT_NAME = 'Contex360'

const users = [
  { role: 'owner',           email: 'owner@contex360.com',     name: 'Owner Contex360',     password: 'Owner123!' },
  { role: 'Administrador',   email: 'admin@contex360.com',     name: 'Admin Contex360',     password: 'Admin123!' },
  { role: 'Contador',        email: 'contador@contex360.com',  name: 'Contador Contex360',  password: 'Contador123!' },
  { role: 'Auxiliar contable', email: 'auxiliar@contex360.com', name: 'Auxiliar Contex360', password: 'Auxiliar123!' },
  { role: 'Usuario nomina',  email: 'nomina@contex360.com',    name: 'Nomina Contex360',    password: 'Nomina123!' },
  { role: 'Gerencia',        email: 'gerencia@contex360.com',  name: 'Gerencia Contex360',  password: 'Gerencia123!' },
  { role: 'Visor',           email: 'visor@contex360.com',     name: 'Visor Contex360',     password: 'Visor123!' },
]

async function main() {
  console.log('🔍 Buscando o creando tenant...')

  let tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } })
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: TENANT_ID,
        name: TENANT_NAME,
        prefix: 'CTX',
        securitySettings: {},
      },
    })
    console.log(`✅ Tenant creado: ${tenant.name}`)
  } else {
    console.log(`✅ Tenant existente: ${tenant.name} (${tenant.id})`)
  }

  for (const u of users) {
    const passwordHash = hashSync(u.password, 10)

    const existing = await prisma.user.findUnique({ where: { email: u.email } })
    if (existing) {
      console.log(`⚠️  Usuario ya existe: ${u.email} — actualizando contraseña`)
      await prisma.user.update({
        where: { email: u.email },
        data: { passwordHash, status: 'active' },
      })
    } else {
      const user = await prisma.user.create({
        data: {
          name: u.name,
          email: u.email,
          title: u.role,
          passwordHash,
          passwordSalt: 'bcryptjs',
          status: 'active',
        },
      })

      await prisma.membership.create({
        data: {
          userId: user.id,
          tenantId: tenant.id,
          role: u.role,
        },
      })

      await prisma.userSecurityProfile.create({
        data: {
          userId: user.id,
          passwordResetRequired: false,
          passwordHistory: [],
          trustedFingerprints: [],
        },
      })

      console.log(`✅ Creado: ${u.email} | rol: ${u.role} | pass: ${u.password}`)
    }
  }

  console.log('\n📋 Resumen de credenciales:')
  console.log('─'.repeat(60))
  for (const u of users) {
    console.log(`  ${u.role.padEnd(20)} ${u.email.padEnd(30)} ${u.password}`)
  }
  console.log('─'.repeat(60))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
