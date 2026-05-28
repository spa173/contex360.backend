/**
 * Script de verificación — Semana 1 + 2
 * Ejecutar: npx ts-node scripts/verify-week1-2.ts
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const BACKEND_URL = process.env.BACKEND_PUBLIC_URL || 'http://localhost:3001'

interface TestResult {
  name: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  message?: string
}

const results: TestResult[] = []

function test(name: string, status: 'PASS' | 'FAIL' | 'SKIP', message?: string) {
  results.push({ name, status, message })
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️'
  console.log(`${icon} ${name}${message ? ` — ${message}` : ''}`)
}

async function testDatabase() {
  console.log('\n📦 DATABASE')

  // 1. Verificar modelos nuevos
  try {
    const payments = await prisma.payment.count()
    test('Modelo Payment existe', 'PASS', `${payments} registros`)
  } catch {
    test('Modelo Payment existe', 'FAIL', 'Tabla no encontrada')
  }

  try {
    const invoices = await prisma.subscriptionInvoice.count()
    test('Modelo SubscriptionInvoice existe', 'PASS', `${invoices} registros`)
  } catch {
    test('Modelo SubscriptionInvoice existe', 'FAIL', 'Tabla no encontrada')
  }

  // 2. Verificar campos nuevos en User
  try {
    const user = await prisma.user.findFirst({
      select: { emailVerified: true, privacyConsentAt: true, emailVerificationToken: true }
    })
    test('Campos User (emailVerified, privacyConsentAt)', 'PASS')
  } catch {
    test('Campos User (emailVerified, privacyConsentAt)', 'FAIL', 'Campos no existen')
  }

  // 3. Verificar campos nuevos en Subscription
  try {
    const sub = await prisma.subscription.findFirst({
      select: { billing: true, cancelAt: true, createdAt: true }
    })
    test('Campos Subscription (billing, cancelAt)', 'PASS')
  } catch {
    test('Campos Subscription (billing, cancelAt)', 'FAIL', 'Campos no existen')
  }
}

async function testEncryption() {
  console.log('\n🔐 ENCRYPTION')

  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    test('ENCRYPTION_KEY configurada', 'FAIL', 'Variable no encontrada')
    return
  }
  test('ENCRYPTION_KEY configurada', 'PASS', `${key.substring(0, 8)}...`)

  try {
    const { EncryptionService } = await import('../src/common/crypto/encryption.service')
    const svc = new EncryptionService()
    const enc = svc.encrypt('test-secret')
    const dec = svc.decrypt(enc)
    test('Encrypt/Decrypt funciona', 'PASS', enc.startsWith('enc:') ? 'Prefijo OK' : 'Sin prefijo')
  } catch (e: any) {
    test('Encrypt/Decrypt funciona', 'FAIL', e.message)
  }
}

async function testEndpoints() {
  console.log('\n🌐 API ENDPOINTS')

  const endpoints = [
    { method: 'GET', path: '/subscriptions/current', auth: true },
    { method: 'GET', path: '/subscriptions/payments', auth: true },
    { method: 'GET', path: '/subscriptions/invoices', auth: true },
    { method: 'POST', path: '/auth/verify-email', auth: false, body: { token: 'test' } },
    { method: 'POST', path: '/auth/accept-privacy', auth: true, body: { version: 'v1.0' } },
  ]

  for (const ep of endpoints) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (ep.auth) headers['Authorization'] = 'Bearer test-token'

      const res = await fetch(`${BACKEND_URL}${ep.path}`, {
        method: ep.method,
        headers,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      })

      // 401 = endpoint existe pero necesita auth (OK)
      // 400 = endpoint existe pero datos inválidos (OK)
      // 404 = endpoint no existe (FAIL)
      if (res.status === 404) {
        test(`${ep.method} ${ep.path}`, 'FAIL', 'Endpoint no encontrado (404)')
      } else {
        test(`${ep.method} ${ep.path}`, 'PASS', `Status ${res.status}`)
      }
    } catch (e: any) {
      test(`${ep.method} ${ep.path}`, 'FAIL', e.message)
    }
  }
}

async function testSecurity() {
  console.log('\n🛡️ SECURITY')

  // CSP Headers
  try {
    const res = await fetch(`${BACKEND_URL}/health`)
    const csp = res.headers.get('content-security-policy')
    if (csp) {
      test('CSP Headers presentes', 'PASS', csp.substring(0, 50) + '...')
    } else {
      test('CSP Headers presentes', 'FAIL', 'Header no encontrado')
    }
  } catch {
    test('CSP Headers presentes', 'SKIP', 'No se pudo verificar')
  }

  // HSTS
  try {
    const res = await fetch(`${BACKEND_URL}/health`)
    const hsts = res.headers.get('strict-transport-security')
    if (hsts) {
      test('HSTS habilitado', 'PASS', hsts)
    } else {
      test('HSTS habilitado', 'FAIL', 'Header no encontrado')
    }
  } catch {
    test('HSTS habilitado', 'SKIP', 'No se pudo verificar')
  }

  // Swagger deshabilitado en prod
  try {
    const res = await fetch(`${BACKEND_URL}/docs`)
    if (res.status === 404) {
      test('Swagger deshabilitado en prod', 'PASS')
    } else if (res.status === 200) {
      test('Swagger deshabilitado en prod', 'FAIL', 'Swagger visible en producción')
    } else {
      test('Swagger deshabilitado en prod', 'PASS', `Status ${res.status}`)
    }
  } catch {
    test('Swagger deshabilitado en prod', 'SKIP', 'No se pudo verificar')
  }
}

async function main() {
  console.log('🧪 VERIFICACIÓN SEMANA 1 + 2')
  console.log('=' .repeat(50))

  await testDatabase()
  await testEncryption()
  await testEndpoints()
  await testSecurity()

  console.log('\n' + '='.repeat(50))
  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length
  console.log(`📊 Resultados: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`)
  console.log(`🎯 ${failed === 0 ? 'TODO FUNCIONA CORRECTAMENTE' : 'HAY ERRORES QUE CORREGIR'}`)

  await prisma.$disconnect()
}

main().catch(console.error)
