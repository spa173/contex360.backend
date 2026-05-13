import { Prisma, PrismaClient, ThirdPartyKind, UserStatus } from '@prisma/client'
import { hashSync } from 'bcryptjs'

const prisma = new PrismaClient()

const seedPassword = (email: string) => `${email}!A1`

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
  if (process.env.NODE_ENV === 'production') {
    console.error('ERROR: Seed script cannot be run in production environment.')
    return
  }
  const accountantPasswordHash = hashSync(seedPassword('contador@contex360.local'), 10)
  const visorPasswordHash = hashSync(seedPassword('visor@contex360.local'), 10)
  const retailAdminPasswordHash = hashSync(seedPassword('retail.admin@contex360.local'), 10)
  const payrollPasswordHash = hashSync(seedPassword('nomina@contex360.local'), 10)

  const tenantA = await prisma.tenant.upsert({
    where: { prefix: 'CL' },
    update: {},
    create: {
      id: 'tenant-a',
      name: 'Contex Labs SAS',
      prefix: 'CL',
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
      allowNegativeStock: true,
      sector: 'Comercio minorista',
      city: 'Medellin',
      dianStatus: 'Pendiente revision',
      securitySettings: defaultSecuritySettings,
    },
  })


  const accountantUser = await prisma.user.upsert({
    where: { email: 'contador@contex360.local' },
    update: {
      name: 'Daniela Rojas',
      title: 'Contador senior',
      status: UserStatus.active,
      passwordHash: accountantPasswordHash,
      passwordSalt: 'bcryptjs',
    },
    create: {
      id: 'user-accountant',
      name: 'Daniela Rojas',
      email: 'contador@contex360.local',
      title: 'Contador senior',
      status: UserStatus.active,
      isDemoAccount: true,
      isSystemOwner: false,
      passwordHash: accountantPasswordHash,
      passwordSalt: 'bcryptjs',
    },
  })

  const visorUser = await prisma.user.upsert({
    where: { email: 'visor@contex360.local' },
    update: {
      name: 'Santiago Velez',
      title: 'Visor operativo',
      status: UserStatus.active,
      passwordHash: visorPasswordHash,
      passwordSalt: 'bcryptjs',
    },
    create: {
      id: 'user-visor',
      name: 'Santiago Velez',
      email: 'visor@contex360.local',
      title: 'Visor operativo',
      status: UserStatus.active,
      isDemoAccount: true,
      isSystemOwner: false,
      passwordHash: visorPasswordHash,
      passwordSalt: 'bcryptjs',
    },
  })

  const retailAdminUser = await prisma.user.upsert({
    where: { email: 'retail.admin@contex360.local' },
    update: {
      name: 'Valeria Pinto',
      title: 'Admin retail',
      status: UserStatus.active,
      passwordHash: retailAdminPasswordHash,
      passwordSalt: 'bcryptjs',
    },
    create: {
      id: 'user-retail-admin',
      name: 'Valeria Pinto',
      email: 'retail.admin@contex360.local',
      title: 'Admin retail',
      status: UserStatus.active,
      isDemoAccount: true,
      isSystemOwner: false,
      passwordHash: retailAdminPasswordHash,
      passwordSalt: 'bcryptjs',
    },
  })

  const payrollUser = await prisma.user.upsert({
    where: { email: 'nomina@contex360.local' },
    update: {
      name: 'Laura Bernal',
      title: 'Coordinacion de nomina',
      status: UserStatus.active,
      passwordHash: payrollPasswordHash,
      passwordSalt: 'bcryptjs',
    },
    create: {
      id: 'user-payroll',
      name: 'Laura Bernal',
      email: 'nomina@contex360.local',
      title: 'Coordinacion de nomina',
      status: UserStatus.active,
      isDemoAccount: true,
      isSystemOwner: false,
      passwordHash: payrollPasswordHash,
      passwordSalt: 'bcryptjs',
    },
  })


  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: accountantUser.id,
        tenantId: tenantA.id,
      },
    },
    update: {
      role: 'Contador',
    },
    create: {
      userId: accountantUser.id,
      tenantId: tenantA.id,
      role: 'Contador',
    },
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: visorUser.id,
        tenantId: tenantB.id,
      },
    },
    update: {
      role: 'Visor',
    },
    create: {
      userId: visorUser.id,
      tenantId: tenantB.id,
      role: 'Visor',
    },
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: retailAdminUser.id,
        tenantId: tenantB.id,
      },
    },
    update: {
      role: 'Administrador',
    },
    create: {
      userId: retailAdminUser.id,
      tenantId: tenantB.id,
      role: 'Administrador',
    },
  })

  await prisma.membership.upsert({
    where: {
      userId_tenantId: {
        userId: payrollUser.id,
        tenantId: tenantA.id,
      },
    },
    update: {
      role: 'Usuario nomina',
    },
    create: {
      userId: payrollUser.id,
      tenantId: tenantA.id,
      role: 'Usuario nomina',
    },
  })


  await prisma.userSecurityProfile.upsert({
    where: { userId: accountantUser.id },
    update: {
      twoFactorEnabled: true,
      twoFactorRequired: true,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-18T14:30:00.000Z'),
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
    create: {
      userId: accountantUser.id,
      twoFactorEnabled: true,
      twoFactorRequired: true,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-18T14:30:00.000Z'),
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
  })

  await prisma.userSecurityProfile.upsert({
    where: { userId: visorUser.id },
    update: {
      twoFactorEnabled: false,
      twoFactorRequired: false,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-10T10:00:00.000Z'),
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
    create: {
      userId: visorUser.id,
      twoFactorEnabled: false,
      twoFactorRequired: false,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-10T10:00:00.000Z'),
      resetRequestedAt: null,
      tempPasswordExpiresAt: null,
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
  })

  await prisma.userSecurityProfile.upsert({
    where: { userId: retailAdminUser.id },
    update: {
      twoFactorEnabled: true,
      twoFactorRequired: true,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-19T11:10:00.000Z'),
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
    create: {
      userId: retailAdminUser.id,
      twoFactorEnabled: true,
      twoFactorRequired: true,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-19T11:10:00.000Z'),
      resetRequestedAt: null,
      tempPasswordExpiresAt: null,
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
  })

  await prisma.userSecurityProfile.upsert({
    where: { userId: payrollUser.id },
    update: {
      twoFactorEnabled: false,
      twoFactorRequired: false,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-09T12:00:00.000Z'),
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
    create: {
      userId: payrollUser.id,
      twoFactorEnabled: false,
      twoFactorRequired: false,
      passwordResetRequired: false,
      passwordUpdatedAt: new Date('2026-04-09T12:00:00.000Z'),
      resetRequestedAt: null,
      tempPasswordExpiresAt: null,
      riskLevel: 'low',
      passwordHistory: [],
      failedLoginAttempts: 0,
      lockedUntil: null,
      trustedFingerprints: [],
    },
  })

  await prisma.thirdParty.upsert({
    where: {
      tenantId_nit: {
        tenantId: tenantA.id,
        nit: '900123456-7',
      },
    },
    update: {
      name: 'Constructora Altos SAS',
      email: 'contabilidad@altos.co',
      kind: ThirdPartyKind.client,
      taxProfile: 'Responsable de IVA',
    },
    create: {
      tenantId: tenantA.id,
      name: 'Constructora Altos SAS',
      nit: '900123456-7',
      email: 'contabilidad@altos.co',
      kind: ThirdPartyKind.client,
      taxProfile: 'Responsable de IVA',
    },
  })

  await prisma.thirdParty.upsert({
    where: {
      tenantId_nit: {
        tenantId: tenantA.id,
        nit: '830456789-1',
      },
    },
    update: {
      name: 'Suministros Andinos SAS',
      email: 'ventas@andinos.co',
      kind: ThirdPartyKind.provider,
      taxProfile: 'Gran contribuyente',
    },
    create: {
      tenantId: tenantA.id,
      name: 'Suministros Andinos SAS',
      nit: '830456789-1',
      email: 'ventas@andinos.co',
      kind: ThirdPartyKind.provider,
      taxProfile: 'Gran contribuyente',
    },
  })

  const decimal = (value: string) => new Prisma.Decimal(value)

  const product = await prisma.product.upsert({
    where: {
      tenantId_sku: {
        tenantId: tenantA.id,
        sku: 'PRD-001',
      },
    },
    update: {
      name: 'Servicio de implementacion',
      price: decimal('1500000.00'),
      cost: decimal('900000.00'),
      taxRate: decimal('19.00'),
    },
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

  await prisma.invoice.upsert({
    where: {
      id: 'seed-invoice-1',
    },
    update: {
      tenantId: tenantA.id,
      clientId: (await prisma.thirdParty.findUnique({
        where: {
          tenantId_nit: {
            tenantId: tenantA.id,
            nit: '900123456-7',
          },
        },
      }))?.id,
      status: 'emitted',
      subtotal: decimal('1500000.00'),
      taxTotal: decimal('285000.00'),
      total: decimal('1785000.00'),
      paymentTermDays: 30,
      notes: 'Factura semilla para desarrollo.',
      dueAt: new Date('2026-05-20T00:00:00.000Z'),
      timeline: [],
    },
    create: {
      id: 'seed-invoice-1',
      tenantId: tenantA.id,
      clientId: (
        await prisma.thirdParty.findUnique({
          where: {
            tenantId_nit: {
              tenantId: tenantA.id,
              nit: '900123456-7',
            },
          },
        })
      )?.id,
      status: 'emitted',
      subtotal: decimal('1500000.00'),
      taxTotal: decimal('285000.00'),
      total: decimal('1785000.00'),
      paymentTermDays: 30,
      notes: 'Factura semilla para desarrollo.',
      dueAt: new Date('2026-05-20T00:00:00.000Z'),
      timeline: [],
      items: {
        create: [
          {
            lineNumber: 1,
            productId: product.id,
            productName: product.name,
            quantity: 1,
            unitPrice: decimal('1500000.00'),
            unitCost: decimal('900000.00'),
            taxRate: decimal('19.00'),
            subtotal: decimal('1500000.00'),
            taxAmount: decimal('285000.00'),
          },
        ],
      },
    },
  })

  process.stdout.write(
    [
      'Seed completed.',
      `Tenants: ${tenantA.prefix}, ${tenantB.prefix}`,
      `Users: ${accountantUser.email}, ${visorUser.email}, ${retailAdminUser.email}, ${payrollUser.email}`,
      `Accountant password: ${seedPassword(accountantUser.email)}`,
    ].join('\n') + '\n',
  )
}

main()
  .catch(async (error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
