import { Injectable, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { SupportTicketPriority } from '@prisma/client'

@Injectable()
export class SupportService {
  constructor(private readonly prisma: PrismaService) {}

  async createTicket(data: {
    tenantId?: string | null
    userId?: string | null
    userName: string
    userEmail: string
    subject: string
    description: string
    priority?: SupportTicketPriority
  }) {
    if (!data.subject?.trim()) throw new BadRequestException('El asunto es requerido.')
    if (!data.description?.trim()) throw new BadRequestException('La descripción es requerida.')

    const ticket = await this.prisma.supportTicket.create({
      data: {
        tenantId: data.tenantId ?? null,
        userId: data.userId ?? null,
        userName: data.userName,
        userEmail: data.userEmail,
        subject: data.subject.trim(),
        description: data.description.trim(),
        priority: data.priority ?? 'media',
        status: 'abierto',
      },
    })

    return { ok: true, message: 'Ticket creado. Nuestro equipo te contactará pronto.', data: ticket }
  }

  async getAllTickets() {
    const tickets = await this.prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return { ok: true, data: tickets }
  }

  async updateTicketStatus(id: string, status: string) {
    const ticket = await this.prisma.supportTicket.update({
      where: { id },
      data: { status: status as any },
    })
    return { ok: true, data: ticket }
  }
}
