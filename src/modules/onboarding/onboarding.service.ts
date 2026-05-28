import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  async getStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSystemOwner: true },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    // System owners don't require onboarding
    if (user.isSystemOwner) {
      return { completed: true }
    }

    const membership = await this.prisma.membership.findFirst({
      where: { userId },
      select: { tenant: { select: { onboardingCompletedAt: true } } },
    })

    if (!membership) {
      throw new NotFoundException('Membership not found for user')
    }

    return {
      completed: !!membership.tenant.onboardingCompletedAt,
    }
  }

  async complete(userId: string, dto: any) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId },
    })

    if (!membership) {
      throw new NotFoundException('Membership not found for user')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.tenant.update({
        where: { id: membership.tenantId },
        data: {
          name: dto.companyName || undefined,
          address: dto.address || undefined,
          phone: dto.phone || undefined,
          nit: dto.nit || undefined,
          sector: dto.sector || undefined,
          city: dto.city || undefined,
          onboardingCompletedAt: new Date(),
        },
      })

      const hashConsent = require('crypto').randomBytes(16).toString('hex')

      if (dto.acceptedTerms) {
        await tx.consentimiento.create({
          data: {
            tenantId: membership.tenantId,
            userId,
            type: 'terminosCondiciones',
            estado: 'aceptado',
            fecha: new Date(),
            hashConsent,
          },
        })
      }

      if (dto.acceptedPrivacy) {
        await tx.consentimiento.create({
          data: {
            tenantId: membership.tenantId,
            userId,
            type: 'politicaPrivacidad',
            estado: 'aceptado',
            fecha: new Date(),
            hashConsent,
          },
        })
      }

      if (dto.acceptedDataProcessing) {
        await tx.consentimiento.create({
          data: {
            tenantId: membership.tenantId,
            userId,
            type: 'procesamientoDatos',
            estado: 'aceptado',
            fecha: new Date(),
            hashConsent,
          },
        })
      }
    })

    return { success: true }
  }
}
