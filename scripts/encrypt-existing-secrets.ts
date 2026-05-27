/**
 * Script para migrar secrets existentes a formato encriptado.
 * Ejecutar una sola vez: npx ts-node scripts/encrypt-existing-secrets.ts
 * 
 * Requiere ENCRYPTION_KEY en .env
 */

import { PrismaClient } from '@prisma/client'
import { createCipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const ENCRYPTED_PREFIX = 'enc:'

function encrypt(plaintext: string, key: Buffer): string {
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  let encrypted = cipher.update(plaintext, 'utf8', 'base64')
  encrypted += cipher.final('base64')

  const authTag = cipher.getAuthTag()

  return `${ENCRYPTED_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`
}

async function main() {
  const hexKey = process.env.ENCRYPTION_KEY
  if (!hexKey) {
    console.error('❌ ENCRYPTION_KEY no está configurada en .env')
    process.exit(1)
  }

  const key = Buffer.from(hexKey, 'hex')
  if (key.length !== 32) {
    console.error('❌ ENCRYPTION_KEY debe ser de 32 bytes (64 caracteres hex)')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  let migrated = 0

  try {
    // 1. Encriptar DIAN certificate passwords
    const tenants = await prisma.tenant.findMany({
      where: { dianCertificatePassword: { not: null } },
      select: { id: true, name: true, dianCertificatePassword: true },
    })

    for (const tenant of tenants) {
      if (tenant.dianCertificatePassword && !tenant.dianCertificatePassword.startsWith(ENCRYPTED_PREFIX)) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { dianCertificatePassword: encrypt(tenant.dianCertificatePassword, key) },
        })
        console.log(`✅ DIAN password encriptado para tenant: ${tenant.name}`)
        migrated++
      }
    }

    // 2. Encriptar SMTP passwords
    const smtpTenants = await prisma.tenant.findMany({
      where: { smtpPassword: { not: null } },
      select: { id: true, name: true, smtpPassword: true },
    })

    for (const tenant of smtpTenants) {
      if (tenant.smtpPassword && !tenant.smtpPassword.startsWith(ENCRYPTED_PREFIX)) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { smtpPassword: encrypt(tenant.smtpPassword, key) },
        })
        console.log(`✅ SMTP password encriptado para tenant: ${tenant.name}`)
        migrated++
      }
    }

    // 3. Encriptar TOTP secrets
    const profiles = await prisma.userSecurityProfile.findMany({
      where: { totpSecret: { not: null } },
      select: { userId: true, totpSecret: true },
    })

    for (const profile of profiles) {
      if (profile.totpSecret && !profile.totpSecret.startsWith(ENCRYPTED_PREFIX)) {
        await prisma.userSecurityProfile.update({
          where: { userId: profile.userId },
          data: { totpSecret: encrypt(profile.totpSecret, key) },
        })
        console.log(`✅ TOTP secret encriptado para user: ${profile.userId}`)
        migrated++
      }
    }

    // 4. Encriptar Gmail OAuth tokens
    const credentials = await prisma.integrationCredential.findMany({
      where: {
        OR: [
          { accessToken: { not: null } },
          { refreshToken: { not: null } },
        ],
      },
    })

    for (const cred of credentials) {
      const updates: any = {}
      if (cred.accessToken && !cred.accessToken.startsWith(ENCRYPTED_PREFIX)) {
        updates.accessToken = encrypt(cred.accessToken, key)
      }
      if (cred.refreshToken && !cred.refreshToken.startsWith(ENCRYPTED_PREFIX)) {
        updates.refreshToken = encrypt(cred.refreshToken, key)
      }
      if (Object.keys(updates).length > 0) {
        await prisma.integrationCredential.update({
          where: { id: cred.id },
          data: updates,
        })
        console.log(`✅ OAuth tokens encriptados para integración: ${cred.provider}`)
        migrated++
      }
    }

    console.log(`\n✅ Migración completada. ${migrated} registros encriptados.`)
  } catch (error) {
    console.error('❌ Error durante la migración:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
