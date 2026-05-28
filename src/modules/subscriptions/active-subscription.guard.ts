import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class ActiveSubscriptionGuard implements CanActivate {
  private readonly logger = new Logger(ActiveSubscriptionGuard.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authUser = request.authUser;

    if (!authUser) {
      return true;
    }

    if (authUser.isSystemOwner) {
      return true;
    }

    const tenantId = request.headers['x-tenant-id'] || authUser.tenantId;
    if (!tenantId || tenantId === 'system') {
      return true;
    }

    const subscription = await this.prisma.subscription.findUnique({
      where: { tenantId },
      select: {
        active: true,
        trialEndsAt: true,
        planType: true,
      },
    });

    if (!subscription) {
      return true;
    }

    if (subscription.trialEndsAt && new Date(subscription.trialEndsAt) <= new Date() && !subscription.active) {
      const method = request.method;
      if (method !== 'GET' && method !== 'OPTIONS' && method !== 'HEAD') {
        throw new ForbiddenException({
          message: 'Tu período de prueba ha expirado. Por favor, activa un plan para continuar usando el sistema.',
          code: 'TRIAL_EXPIRED',
          requiresSubscription: true,
        });
      }
    }

    if (!subscription.active && !subscription.trialEndsAt) {
      throw new ForbiddenException({
        message: 'Tu suscripción no está activa. Por favor, renueva tu plan para continuar.',
        code: 'SUBSCRIPTION_INACTIVE',
        requiresSubscription: true,
      });
    }

    return true;
  }
}