import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common'
import { Observable } from 'rxjs'
import { AuthenticatedRequest } from '../../modules/auth/auth.types'
import { rlsContextStorage } from '../../modules/database/prisma.service'

/**
 * Propaga el usuario autenticado al AsyncLocalStorage de RLS.
 * Registrar globalmente en AppModule para que todos los endpoints
 * dispongan del contexto sin cambios en los servicios.
 *
 * Nota: con service_role (DATABASE_URL de Prisma), Postgres ignora las
 * políticas RLS via BYPASSRLS. Este interceptor sólo tiene efecto cuando
 * se usan conexiones con roles sin ese privilegio (ej. PrismaService.runAsUser).
 */
@Injectable()
export class RlsContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    const authUser = request.authUser

    if (!authUser) {
      return next.handle()
    }

    return new Observable((subscriber) => {
      rlsContextStorage.run(
        { userId: authUser.sub, isSystemOwner: authUser.isSystemOwner },
        () => {
          next.handle().subscribe({
            next: (value) => subscriber.next(value),
            error: (err) => subscriber.error(err),
            complete: () => subscriber.complete(),
          })
        },
      )
    })
  }
}
