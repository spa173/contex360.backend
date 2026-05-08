import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ThirdPartyKind } from '@prisma/client'

@Injectable()
export class ThirdPartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, kind?: ThirdPartyKind) {
    return this.prisma.thirdParty.findMany({
      where: {
        tenantId,
        ...(kind ? { kind } : {}),
      },
      orderBy: { name: 'asc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const thirdParty = await this.prisma.thirdParty.findFirst({
      where: { id, tenantId },
    })

    if (!thirdParty) {
      throw new NotFoundException('Tercero no encontrado')
    }

    return thirdParty
  }

  async create(tenantId: string, data: {
    name: string
    nit: string
    email: string
    kind: ThirdPartyKind
    taxProfile: string
  }) {
    return this.prisma.thirdParty.create({
      data: {
        ...data,
        tenantId,
      },
    })
  }

  async update(tenantId: string, id: string, data: Partial<{
    name: string
    nit: string
    email: string
    kind: ThirdPartyKind
    taxProfile: string
  }>) {
    await this.findOne(tenantId, id)

    return this.prisma.thirdParty.update({
      where: { id },
      data,
    })
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)

    return this.prisma.thirdParty.delete({
      where: { id },
    })
  }
}
