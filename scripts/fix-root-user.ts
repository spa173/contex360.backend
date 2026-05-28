import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixRootUser() {
  try {
    console.log('🔐 Configurando usuario root como administrador del sistema...\n')

    // Find root user
    const rootUser = await prisma.user.findUnique({
      where: { email: 'root@contex360.local' },
      include: { memberships: true },
    })

    if (!rootUser) {
      console.error('❌ Usuario root no encontrado')
      process.exit(1)
    }

    // Delete all memberships
    if (rootUser.memberships.length > 0) {
      await prisma.membership.deleteMany({
        where: { userId: rootUser.id },
      })
      console.log(`✅ Eliminadas ${rootUser.memberships.length} memberships`)
    }

    // Ensure isSystemOwner is true
    if (!rootUser.isSystemOwner) {
      await prisma.user.update({
        where: { id: rootUser.id },
        data: { isSystemOwner: true },
      })
      console.log('✅ Usuario marcado como System Owner')
    }

    console.log('\n🎉 Usuario root configurado correctamente\n')
    console.log('📋 Configuración final:')
    console.log(`   Email: root@contex360.local`)
    console.log(`   Contraseña: (la configurada via ROOT_PASSWORD)`)
    console.log(`   Rol: System Owner (sin empresa vinculada)`)
    console.log(`   Acceso: A todas las empresas del sistema\n`)

    process.exit(0)
  } catch (error) {
    console.error('❌ Error:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

fixRootUser()
