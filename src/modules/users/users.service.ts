import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import * as crypto from 'crypto'

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

  // Simplified hash for demo/mock logic; in a real app use bcrypt
  async hashPassword(password: string) {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')
    return { hash, salt }
  }

  async createUser(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } })
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
          email: dto.email,
          title: dto.title || '',
          status: 'active',
          isSystemOwner: false,
          isDemoAccount: false,
        }
      })

      // 2. Create Security Profile
      await tx.userSecurityProfile.create({
        data: {
          userId: user.id,
          passwordHash: hash,
          passwordSalt: salt,
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
