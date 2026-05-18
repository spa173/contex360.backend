import { Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { AsyncLocalStorage } from 'async_hooks'
import { hashSync } from 'bcryptjs'

export interface RlsUserContext {
  userId: string
  isSystemOwner: boolean
}

// Almacén de contexto por request (propagado via AsyncLocalStorage)
export const rlsContextStorage = new AsyncLocalStorage<RlsUserContext>()

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit() {
    await this.$connect()
    await this.ensureSeedData()
  }

  async onApplicationShutdown() {
    await this.$disconnect()
  }

  async ensureSeedData() {
    try {
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
        sessionPolicy: { singleSessionOnly: false },
      }

      const tenantSystem = await this.tenant.upsert({
        where: { prefix: 'SYS' },
        update: {},
        create: {
          id: 'system',
          name: 'Contex360 Global Cloud',
          prefix: 'SYS',
          nit: '800000000-1',
          allowNegativeStock: true,
          sector: 'Tecnología / Plataforma',
          city: 'Global',
          dianStatus: 'Sistema',
          securitySettings: defaultSecuritySettings,
        },
      })

      const tenantA = await this.tenant.upsert({
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

      const tenantB = await this.tenant.upsert({
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

      const usersToCreate = [
        { id: 'user-root', email: 'root@contex360.local', name: 'Super Administrador', title: 'Global Root', isSystemOwner: true, role: null, tenantId: null },
        { id: 'user-admin-labs', email: 'admin.labs@contex360.local', name: 'Admin Labs', title: 'Administrador Contex Labs', isSystemOwner: false, role: 'Administrador', tenantId: tenantA.id },
        { id: 'user-admin-retail', email: 'admin.retail@contex360.local', name: 'Admin Retail', title: 'Administrador Nova Retail', isSystemOwner: false, role: 'Administrador', tenantId: tenantB.id },
        { id: 'user-operator-labs', email: 'operator.labs@contex360.local', name: 'Operador Labs', title: 'Operador Contex Labs', isSystemOwner: false, role: 'Operador', tenantId: tenantA.id },
        { id: 'user-operator-retail', email: 'operator.retail@contex360.local', name: 'Operador Retail', title: 'Operador Nova Retail', isSystemOwner: false, role: 'Operador', tenantId: tenantB.id },
      ]

      for (const u of usersToCreate) {
        const passwordHash = hashSync(`${u.email}!A1`, 10)
        
        const existingByEmail = await this.user.findUnique({ where: { email: u.email } })
        if (existingByEmail && existingByEmail.id !== u.id) {
          await this.user.update({
            where: { id: existingByEmail.id },
            data: { email: `archived-${Date.now()}-${existingByEmail.email}` },
          })
        }

        const user = await this.user.upsert({
          where: { id: u.id },
          update: {
            email: u.email,
            name: u.name,
            title: u.title,
            status: 'active',
            passwordHash,
            passwordSalt: 'bcryptjs',
            isSystemOwner: u.isSystemOwner,
          },
          create: {
            id: u.id,
            name: u.name,
            email: u.email,
            title: u.title,
            status: 'active',
            isDemoAccount: true,
            isSystemOwner: u.isSystemOwner,
            passwordHash,
            passwordSalt: 'bcryptjs',
          },
        })

        if (u.tenantId && u.role) {
          await this.membership.upsert({
            where: { userId_tenantId: { userId: user.id, tenantId: u.tenantId } },
            update: { role: u.role },
            create: { userId: user.id, tenantId: u.tenantId, role: u.role },
          })
        }

        await this.userSecurityProfile.upsert({
          where: { userId: user.id },
          update: { passwordUpdatedAt: new Date(), passwordResetRequired: false },
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

      await this.thirdParty.upsert({
        where: { tenantId_nit: { tenantId: tenantA.id, nit: '900123456-7' } },
        update: {},
        create: {
          tenantId: tenantA.id,
          name: 'Constructora Altos SAS',
          nit: '900123456-7',
          email: 'contabilidad@altos.co',
          kind: 'client',
          taxProfile: 'Responsable de IVA',
        },
      })

      await this.product.upsert({
        where: { tenantId_sku: { tenantId: tenantA.id, sku: 'PRD-001' } },
        update: {},
        create: {
          tenantId: tenantA.id,
          sku: 'PRD-001',
          name: 'Servicio de implementacion',
          price: 1500000.00,
          cost: 900000.00,
          taxRate: 19.00,
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

      console.log('Automatic seed verification completed on module startup.')
    } catch (err) {
      console.error('Error during automatic seed verification:', err)
    }
  }

  /**
   * Ejecuta `fn` dentro de una transacción con el contexto de usuario activo
   * para que las políticas RLS puedan leer app.user_id y app.is_system_owner.
   *
   * Úsalo cuando necesitas que RLS se aplique a nivel de base de datos
   * (conexiones sin BYPASSRLS). Con service_role, las políticas son
   * ignoradas automaticamente por Postgres.
   */
  async runAsUser<T>(
    context: RlsUserContext,
    fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return rlsContextStorage.run(context, () =>
      this.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT
            set_config('app.user_id',         ${context.userId},                    true),
            set_config('app.is_system_owner',  ${String(context.isSystemOwner)},    true)
        `
        return fn(tx)
      }),
    )
  }
}
