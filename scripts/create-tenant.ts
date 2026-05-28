import { PrismaClient } from '@prisma/client'
import * as readline from 'readline'

const prisma = new PrismaClient()

async function createTenant() {
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
    console.log('\n🏢 Creador de Nueva Empresa\n')

    const name = await question('Nombre de la empresa: ')
    const nit = await question('NIT (ej: 900123456-7): ')
    const prefix = await question('Prefijo (ej: FAC, para facturas): ')
    const address = await question('Dirección (opcional): ')
    const phone = await question('Teléfono (opcional): ')
    const city = await question('Ciudad (opcional): ')
    const sector = await question('Sector (opcional): ')

    if (!name.trim() || !nit.trim() || !prefix.trim()) {
      console.error('❌ Nombre, NIT y Prefijo son obligatorios')
      process.exit(1)
    }

    console.log('\n⏳ Creando empresa...')

    const tenant = await prisma.tenant.create({
      data: {
        name: name.trim(),
        nit: nit.trim(),
        prefix: prefix.trim().toUpperCase(),
        address: address.trim() || undefined,
        phone: phone.trim() || undefined,
        city: city.trim() || undefined,
        sector: sector.trim() || undefined,
        securitySettings: {},
        invoicePrefix: prefix.trim().toUpperCase(),
        invoiceResolution: null,
        dianStatus: null,
      },
    })

    console.log('\n✅ Empresa creada exitosamente\n')
    console.log('📋 Detalles:')
    console.log(`   ID: ${tenant.id}`)
    console.log(`   Nombre: ${tenant.name}`)
    console.log(`   NIT: ${tenant.nit}`)
    console.log(`   Prefijo: ${tenant.prefix}`)
    console.log(`   Dirección: ${tenant.address || 'No configurada'}`)
    console.log(`   Teléfono: ${tenant.phone || 'No configurado'}`)
    console.log(`   Ciudad: ${tenant.city || 'No configurada'}`)
    console.log(`   Sector: ${tenant.sector || 'No configurado'}\n`)

    console.log('🔗 Para vincular usuarios a esta empresa:')
    console.log(`   ID de Tenant: ${tenant.id}\n`)

    rl.close()
    process.exit(0)
  } catch (error) {
    console.error('❌ Error:', error)
    rl.close()
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

createTenant()
