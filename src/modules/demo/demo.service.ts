import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
  ) {}

  async createDemoRequest(data: {
    nombre: string;
    empresa: string;
    correo: string;
    telefono?: string;
    mensaje?: string;
  }) {
    const demoRequest = await this.prisma.demoRequest.create({
      data: {
        nombre: data.nombre,
        empresa: data.empresa,
        correo: data.correo,
        telefono: data.telefono,
        mensaje: data.mensaje,
        estado: 'nuevo',
      },
    });

    // Send Telegram notification
    await this.telegramService.sendDemoNotification(data).catch((err) => {
      console.error('Failed to send Telegram notification:', err);
    });

    return {
      ok: true,
      message: 'Solicitud enviada correctamente. Nuestro equipo te contactará pronto.',
      data: demoRequest,
    };
  }

  async getAllDemoRequests() {
    const requests = await this.prisma.demoRequest.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return {
      ok: true,
      data: requests,
    };
  }

  async updateDemoRequestStatus(id: string, estado: string) {
    const request = await this.prisma.demoRequest.update({
      where: { id },
      data: { estado: estado as any },
    });

    return {
      ok: true,
      data: request,
    };
  }
}
