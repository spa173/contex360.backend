import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import TelegramBot from 'node-telegram-bot-api';

@Injectable()
export class TelegramService {
  private bot: TelegramBot;
  private chatId: string;

  constructor(private readonly configService: ConfigService) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    this.chatId = this.configService.get<string>('TELEGRAM_CHAT_ID') || '';

    if (token) {
      this.bot = new TelegramBot(token, { polling: false });
    }
  }

  async sendMessage(message: string): Promise<boolean> {
    if (!this.bot || !this.chatId) {
      console.warn('Telegram bot not configured');
      return false;
    }

    try {
      await this.bot.sendMessage(this.chatId, message, { parse_mode: 'HTML' });
      return true;
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return false;
    }
  }

  async sendDemoNotification(data: {
    nombre: string;
    empresa: string;
    correo: string;
    telefono?: string;
    mensaje?: string;
  }): Promise<boolean> {
    const message = `
🔔 <b>Nueva solicitud de demo</b>

👤 <b>Nombre:</b> ${data.nombre}
🏢 <b>Empresa:</b> ${data.empresa}
📧 <b>Correo:</b> ${data.correo}
${data.telefono ? `📱 <b>Teléfono:</b> ${data.telefono}` : ''}
${data.mensaje ? `💬 <b>Mensaje:</b> ${data.mensaje}` : ''}

📅 <b>Fecha:</b> ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
    `.trim();

    return this.sendMessage(message);
  }
}
