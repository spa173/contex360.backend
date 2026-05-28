import { PrismaClient, UserStatus } from '@prisma/client'
import { hash } from 'bcryptjs'
import { randomUUID } from 'crypto'
import * as readline from 'readline'

const prisma = new PrismaClient()

async function createRootUser() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => {
      rl.question(prompt, resolve)
    })
  }

  try {
    console.log('\n🔐 Creador de Usuario Root\n')

    const email = await question('Correo electrónico (default: root@contex360.local): ')
    const finalEmail = email.trim() || 'root@contex360.local'

    const password = await question('Contraseña: ')
    if (!password || password.length < 8) {
      console.error('❌ La contraseña debe tener al menos 8 caracteres')
      process.exit(1)
    }

    const name = await question('Nombre (default: Root Administrator): ')
    const finalName = name.trim() || 'Root Administrator'

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: finalEmail },
    })

    if (existingUser) {
      console.error(`❌ El usuario con email ${finalEmail} ya existe`)
      process.exit(1)
    }

    // Hash password
    const saltRounds = 10
    const passwordHash = await hash(password, saltRounds)
    const passwordSalt = randomUUID()

    // Create root user with system owner privileges
    const user = await prisma.user.create({
      data: {
        email: finalEmail,
        name: finalName,
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
      },
    })

    // Create system tenant for root user
    const tenant = await prisma.tenant.create({
      data: {
        name: 'System Tenant',
        type: 'system',
        status: 'active',
      },
    })

    // Create membership
    await prisma.membership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: 'administrator',
        status: 'active',
        inviteToken: null,
        inviteTokenExpiresAt: null,
      },
    })

    console.log('\n✅ Usuario root creado exitosamente\n')
    console.log('📋 Detalles:')
    console.log(`   Email: ${finalEmail}`)
    console.log(`   Nombre: ${finalName}`)
    console.log(`   ID de usuario: ${user.id}`)
    console.log(`   Rol: System Owner`)
    console.log(`   Tenant: ${tenant.id}\n`)

    rl.close()
    process.exit(0)
  } catch (error) {
    console.error('❌ Error creando usuario:', error)
    rl.close()
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

createRootUser()
