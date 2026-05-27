import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';
import { REQUIRE_ACTIVE_SUBSCRIPTION_KEY } from './subscription.decorator';

@Injectable()
export class TrialGuard implements CanActivate {
  private readonly logger = new Logger(TrialGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Solo aplica si el endpoint tiene el decorador @RequireActiveSubscription()
    const requireSubscription = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_ACTIVE_SUBSCRIPTION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requireSubscription) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const tenantId = request.headers['x-tenant-id'];

    if (!tenantId) {
      return true;
    }

    // System owners bypass trial check
    const authUser = request.authUser;
    if (authUser?.isSystemOwner) {
      return true;
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        active: true,
        trialEndsAt: true,
        renewsAt: true,
        cancelAt: true,
        planType: true,
      },
    });

    // Sin suscripción = trial activo (nuevos tenants)
    if (!subscription) {
      return true;
    }

    // Si tiene cancelAt programado y ya pasó la fecha, desactivar
    if (subscription.cancelAt && new Date(subscription.cancelAt) <= new Date()) {
      await this.prisma.subscription.update({
        where: { tenantId },
        data: { active: false, cancelAt: null },
      });
      throw new ForbiddenException(
        'Su suscripción ha sido desactivada. Por favor, renueve su plan para continuar.'
      );
    }

    // Si no está activa y no tiene trial
    if (!subscription.active && !subscription.trialEndsAt) {
      throw new ForbiddenException(
        'Su suscripción no está activa. Por favor, active un plan para continuar.'
      );
    }

    // Si tiene trial activo, verificar si expiró
    if (subscription.trialEndsAt && new Date(subscription.trialEndsAt) <= new Date()) {
      const method = request.method;
      if (method !== 'GET' && method !== 'OPTIONS') {
        throw new ForbiddenException(
          'Su período de prueba ha expirado. Por favor, active un plan para continuar usando el sistema.'
        );
      }
    }

    return true;
  }
}
