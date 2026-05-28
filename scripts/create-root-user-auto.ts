import { PrismaClient, UserStatus } from '@prisma/client'
import { hash } from 'bcryptjs'
import { randomUUID } from 'crypto'

const prisma = new PrismaClient()

async function createRootUser() {
  try {
    const email = process.env.ROOT_EMAIL || 'root@contex360.local'
    const credential = process.env.ROOT_PASSWORD // NOSONAR: read from env, not hardcoded
    const name = process.env.ROOT_NAME || 'Root Administrator'

    if (!credential) {
      console.error('❌ Debes proporcionar la contraseña via variable de entorno ROOT_PASSWORD')
      console.error('   Ejemplo: ROOT_PASSWORD=MiClave123! npx ts-node scripts/create-root-user-auto.ts')
      process.exit(1)
    }

    console.log('🔐 Creando usuario root...\n')

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    })

    if (existingUser) {
      console.log(`⚠️  El usuario con email ${email} ya existe`)
      console.log(`   ID: ${existingUser.id}`)
      console.log(`   Nombre: ${existingUser.name}`)
      process.exit(0)
    }

    // Hash credential
    const saltRounds = 10
    const passwordHash = await hash(credential, saltRounds)
    const passwordSalt = randomUUID()

    // Create root user with system owner privileges
    const user = await prisma.user.create({
      data: {
        email,
        name,
        title: 'System Administrator',
        status: UserStatus.active,
        isSystemOwner: true,
        emailVerified: true,
        passwordHash,
        passwordSalt,
        termsAcceptedAt: new Date(),
        privacyConsentAt: new Date(),
        policyAcceptedAt: new Date(),
        policyVersion: '1.0.0',
        privacyConsentVersion: '1.0.0',
      },
    })

    // Create security profile
    await prisma.userSecurityProfile.create({
      data: {
        userId: user.id,
        twoFactorEnabled: false,
        twoFactorRequired: false,
        passwordHistory: [],
        trustedFingerprints: [],
        riskLevel: 'low',
      },
    })

    // Create system tenant for root user
    const tenant = await prisma.tenant.create({
      data: {
        name: 'System Tenant',
        prefix: 'SYS',
        securitySettings: {},
      },
    })

    // Create membership
    await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: 'administrator',
      },
    })

    console.log('✅ Usuario root creado exitosamente\n')
    console.log('📋 Detalles:')
    console.log(`   Email: ${email}`)
    console.log(`   Nombre: ${name}`)
    console.log(`   ID de usuario: ${user.id}`)
    console.log(`   Rol: System Owner`)
    console.log(`   Tenant: ${tenant.id}\n`)
    console.log('🎉 Ya puedes iniciar sesión en la aplicación\n')

    process.exit(0)
  } catch (error) {
    console.error('❌ Error creando usuario:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

createRootUser()
