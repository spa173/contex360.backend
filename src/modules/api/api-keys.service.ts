import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'
import * as crypto from 'crypto'

@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name)

  constructor(private readonly prisma: PrismaService) {}

  async createKey(tenantId: string, name: string, expiresInDays?: number) {
    const key = `ctx_${crypto.randomBytes(24).toString('hex')}`
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const existing = await this.prisma.apiKey.findFirst({ where: { tenantId, name } })
    if (existing) throw new ConflictException(`Ya existe una API key con el nombre "${name}"`)

    return this.prisma.apiKey.create({
      data: { tenantId, name, key, expiresAt },
      select: { id: true, name: true, key: true, expiresAt: true, active: true, createdAt: true },
    })
  }

  async listKeys(tenantId: string) {
    return this.prisma.apiKey.findMany({
      where: { tenantId },
      select: { id: true, name: true, key: true, expiresAt: true, lastUsed: true, active: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async revokeKey(tenantId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({ where: { id, tenantId } })
    if (!key) throw new NotFoundException('API key no encontrada')
    return this.prisma.apiKey.update({ where: { id }, data: { active: false } })
  }

  async validateKey(key: string) {
    return this.prisma.apiKey.findUnique({ where: { key } })
  }

  async touchLastUsed(key: string) {
    await this.prisma.apiKey.update({ where: { key }, data: { lastUsed: new Date() } }).catch(() => {})
  }

  @Cron('0 6 * * *', { timeZone: 'America/Bogota' })
  async expireOldKeys() {
    const result = await this.prisma.apiKey.updateMany({
      where: { expiresAt: { lte: new Date() }, active: true },
      data: { active: false },
    })
    if (result.count > 0) this.logger.log(`${result.count} API key(s) expiradas automáticamente`)
  }
}
