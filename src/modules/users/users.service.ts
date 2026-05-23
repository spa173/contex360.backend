import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import * as crypto from 'crypto'
import * as bcrypt from 'bcryptjs'

export interface CreateUserDto {
  name: string
  email: string
  title?: string
  tenantId?: string
  role?: string
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  generateTemporaryPassword(): string {
    return crypto.randomBytes(6).toString('base64').slice(0, 8)
  }

  async hashPassword(password: string) {
    const salt = await bcrypt.genSalt(10)
    const hash = await bcrypt.hash(password, salt)
    return { hash, salt }
  }

  async createUser(dto: CreateUserDto) {
    const normalizedEmail = String(dto.email || '').trim().toLowerCase()
    const existing = await this.prisma.user.findUnique({ where: { email: normalizedEmail } })
    if (existing) {
      throw new BadRequestException('El correo ya está registrado.')
    }

    const tempPassword = this.generateTemporaryPassword()
    const { hash, salt } = await this.hashPassword(tempPassword)

    return await this.prisma.$transaction(async (tx) => {
      // 1. Create User
      const user = await tx.user.create({
        data: {
          name: dto.name,
          email: normalizedEmail,
          title: dto.title || '',
          status: 'active',
          isSystemOwner: false,
          isDemoAccount: false,
          passwordHash: hash,
          passwordSalt: salt,
        }
      })

      // 2. Create Security Profile
      await tx.userSecurityProfile.create({
        data: {
          userId: user.id,
          passwordResetRequired: true,
          twoFactorEnabled: false,
          twoFactorRequired: false,
          passwordHistory: [],
          trustedFingerprints: []
        }
      })

      // 3. Optional: Create Membership if tenantId is provided
      if (dto.tenantId && dto.role) {
        await tx.membership.create({
          data: {
            userId: user.id,
            tenantId: dto.tenantId,
            role: dto.role,
          }
        })
      }

      return { user, tempPassword }
    })
  }
}
