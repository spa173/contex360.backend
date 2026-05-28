import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'

@Injectable()
export class OnboardingService {
  constructor(private prisma: PrismaService) {}

  async getStatus(userId: string) {
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

    await this.prisma.tenant.update({
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

    return { success: true }
  }
}
