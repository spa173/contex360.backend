import { Injectable, OnModuleInit, OnApplicationShutdown } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'
import { AsyncLocalStorage } from 'async_hooks'
import { hashSync } from 'bcryptjs'

function safeLogFragment(value: unknown) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 240)
}

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
    // Autoseed desactivado para producción
  }

  async onApplicationShutdown() {
    await this.$disconnect()
  }

  async ensureSeedData() {
    console.log('Seed data injection is disabled.');
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
