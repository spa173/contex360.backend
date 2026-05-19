import { Prisma, PrismaClient, ThirdPartyKind, UserStatus } from '@prisma/client'
import { hashSync } from 'bcryptjs'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()

if (process.env.NODE_ENV === 'production') {
  process.stderr.write('ERROR: seed cannot run in production.\n')
  process.exit(1)
}

const generatedPasswords = new Map<string, string>()

const seedPassword = (email: string): string => {
  const existing = generatedPasswords.get(email)
  if (existing) return existing
  const pwd = randomBytes(12).toString('base64url') + 'A1!'
  generatedPasswords.set(email, pwd)
  return pwd
}

const defaultSecuritySettings = {
  passwordPolicy: {
    minLength: 10,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    maxAgeDays: 90,
    preventReuse: 5,
    failedAttemptsThreshold: 5,
    lockoutMinutes: 30,
  },
  ipWhitelist: [],
  sessionPolicy: {
    singleSessionOnly: false,
  },
}

async function main() {
  // if (process.env.NODE_ENV === 'production') {
  //   console.error('ERROR: Seed script cannot be run in production environment.')
  //   return
  // }

  // --- Tenants ---
  const tenantA = await prisma.tenant.upsert({
    where: { prefix: 'CL' },
    update: {},
    create: {
      id: 'tenant-a',
      name: 'Contex Labs SAS',
      prefix: 'CL',
      nit: '900111222-1',
      allowNegativeStock: false,
      sector: 'Servicios profesionales',
      city: 'Bogota',
      dianStatus: 'Configurado',
      securitySettings: defaultSecuritySettings,
    },
  })

  const tenantB = await prisma.tenant.upsert({
    where: { prefix: 'NR' },
    update: {},
    create: {
      id: 'tenant-b',
      name: 'Nova Retail SAS',
      prefix: 'NR',
      nit: '800333444-2',
      allowNegativeStock: true,
      sector: 'Comercio minorista',
      city: 'Medellin',
      dianStatus: 'Pendiente revision',
      securitySettings: defaultSecuritySettings,
    },
  })

  // --- Users ---
  const usersToCreate = [
    {
      id: 'user-root',
      email: 'root@contex360.local',
      name: 'Super Administrador',
      title: 'Global Root',
      isSystemOwner: true,
      role: null,
      tenantId: null,
    },
    {
      id: 'user-admin-labs',
      email: 'admin.labs@contex360.local',
      name: 'Admin Labs',
      title: 'Administrador Contex Labs',
      isSystemOwner: false,
      role: 'Administrador',
      tenantId: tenantA.id,
    },
    {
      id: 'user-admin-retail',
      email: 'admin.retail@contex360.local',
      name: 'Admin Retail',
      title: 'Administrador Nova Retail',
      isSystemOwner: false,
      role: 'Administrador',
      tenantId: tenantB.id,
    },
    {
      id: 'user-operator-labs',
      email: 'operator.labs@contex360.local',
      name: 'Operador Labs',
      title: 'Operador Contex Labs',
      isSystemOwner: false,
      role: 'Operador',
      tenantId: tenantA.id,
    },
    {
      id: 'user-operator-retail',
      email: 'operator.retail@contex360.local',
      name: 'Operador Retail',
      title: 'Operador Nova Retail',
      isSystemOwner: false,
      role: 'Operador',
      tenantId: tenantB.id,
    },
  ]

  for (const u of usersToCreate) {
    const passwordHash = hashSync(seedPassword(u.email), 10)
    
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        title: u.title,
        status: UserStatus.active,
        passwordHash,
        passwordSalt: 'bcryptjs',
        isSystemOwner: u.isSystemOwner,
      },
      create: {
        id: u.id,
        name: u.name,
        email: u.email,
        title: u.title,
        status: UserStatus.active,
        isDemoAccount: true,
        isSystemOwner: u.isSystemOwner,
        passwordHash,
        passwordSalt: 'bcryptjs',
      },
    })

    if (u.tenantId && u.role) {
      await prisma.membership.upsert({
        where: {
          userId_tenantId: {
            userId: user.id,
            tenantId: u.tenantId,
          },
        },
        update: { role: u.role },
        create: {
          userId: user.id,
          tenantId: u.tenantId,
          role: u.role,
        },
      })
    }

    await prisma.userSecurityProfile.upsert({
      where: { userId: user.id },
      update: {
        passwordUpdatedAt: new Date(),
        passwordResetRequired: false,
      },
      create: {
        userId: user.id,
        twoFactorEnabled: false,
        twoFactorRequired: false,
        passwordResetRequired: false,
        passwordUpdatedAt: new Date(),
        riskLevel: 'low',
        passwordHistory: [],
        failedLoginAttempts: 0,
        lockedUntil: null,
        trustedFingerprints: [],
      },
    })
  }

  // --- Data for Tenant A ---
  const decimal = (value: string) => new Prisma.Decimal(value)

  await prisma.thirdParty.upsert({
    where: { tenantId_nit: { tenantId: tenantA.id, nit: '900123456-7' } },
    update: {},
    create: {
      tenantId: tenantA.id,
      name: 'Constructora Altos SAS',
      nit: '900123456-7',
      email: 'contabilidad@altos.co',
      kind: ThirdPartyKind.client,
      taxProfile: 'Responsable de IVA',
    },
  })

  const product = await prisma.product.upsert({
    where: { tenantId_sku: { tenantId: tenantA.id, sku: 'PRD-001' } },
    update: {},
    create: {
      tenantId: tenantA.id,
      sku: 'PRD-001',
      name: 'Servicio de implementacion',
      price: decimal('1500000.00'),
      cost: decimal('900000.00'),
      taxRate: decimal('19.00'),
      stock: 100,
      stockByLocation: {},
      minStock: 10,
      maxStock: 500,
      location: 'Bodega Principal',
      category: 'Servicios',
      barcode: '770000000001',
      isInventoriable: true,
      productType: 'standard',
      unit: 'und',
    },
  })

  const lines = [
    'Seed completed successfully.',
    `Tenants: ${tenantA.name} (${tenantA.id}), ${tenantB.name} (${tenantB.id})`,
    'Generated passwords (save these — shown only once):',
    ...Array.from(generatedPasswords.entries()).map(([email, pwd]) => `  ${email} => ${pwd}`),
  ]
  process.stdout.write(lines.join('\n') + '\n')
}

main()
  .catch(async (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
