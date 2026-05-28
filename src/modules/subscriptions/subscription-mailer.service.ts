import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { PrismaService } from '../database/prisma.service';
import { PdfService } from './pdf.service';
import { UsageService } from '../usage/usage.service';

@Injectable()
export class SubscriptionMailerService {
  private readonly logger = new Logger(SubscriptionMailerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pdfService: PdfService,
    private readonly usageService: UsageService,
  ) {}

  async sendInvoiceEmail(subscriptionInvoiceId: string) {
    const invoice = await this.prisma.subscriptionInvoice.findUnique({
      where: { id: subscriptionInvoiceId },
      include: {
        tenant: {
          select: {
            name: true,
            memberships: {
              include: { user: { select: { email: true, name: true } } },
            },
          },
        },
        payment: true,
      },
    });

    if (!invoice) {
      this.logger.warn(`Factura ${subscriptionInvoiceId} no encontrada`);
      return;
    }

    const admin = invoice.tenant.memberships.find(
      (m) => m.role === 'Administrador' || m.role === 'owner',
    )?.user;

    if (!admin?.email) {
      this.logger.warn(`No se encontró admin para tenant ${invoice.tenantId}`);
      return;
    }

    const pdfPath = await this.pdfService.generateInvoicePdf(
      {
        invoiceNumber: invoice.invoiceNumber,
        amount: invoice.amount,
        tax: invoice.tax,
        total: invoice.total,
        planType: invoice.planType,
        billing: invoice.billing,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        paidAt: invoice.paidAt,
        createdAt: invoice.createdAt,
        cufe: invoice.cufe,
        dianStatus: invoice.dianStatus,
        items: [{
          productName: `Suscripción ${invoice.planType} (${invoice.billing})`,
          quantity: 1,
          unitPrice: invoice.amount,
          taxAmount: invoice.tax,
          total: invoice.total,
        }],
      },
      {
        name: invoice.tenant.name,
        nit: '',
      },
    );

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #18181B; font-size: 20px; margin: 0;">Factura de Suscripción</h1>
          <p style="color: #71717A; font-size: 14px;">${invoice.invoiceNumber}</p>
        </div>
        <div style="background: #F4F4F5; border-radius: 12px; padding: 20px;">
          <h3 style="color: #18181B; font-size: 14px; margin: 0 0 12px 0;">Resumen</h3>
          <p style="color: #71717A; font-size: 13px; margin: 4px 0;"><strong>Plan:</strong> ${invoice.planType}</p>
          <p style="color: #71717A; font-size: 13px; margin: 4px 0;"><strong>Período:</strong> ${invoice.periodStart.toLocaleDateString('es-CO')} — ${invoice.periodEnd.toLocaleDateString('es-CO')}</p>
          <p style="color: #71717A; font-size: 13px; margin: 4px 0;"><strong>Subtotal:</strong> $${invoice.amount.toLocaleString('es-CO')}</p>
          <p style="color: #71717A; font-size: 13px; margin: 4px 0;"><strong>IVA:</strong> $${invoice.tax.toLocaleString('es-CO')}</p>
          <p style="color: #18181B; font-size: 16px; font-weight: bold; margin: 8px 0 0;"><strong>Total:</strong> $${invoice.total.toLocaleString('es-CO')}</p>
          ${invoice.cufe ? `<p style="color: #A1A1AA; font-size: 10px; margin-top: 8px;">CUFE: ${invoice.cufe}</p>` : ''}
        </div>
        <p style="color: #A1A1AA; font-size: 12px; text-align: center; margin-top: 24px;">
          Contex360 — ERP inteligente para empresas colombianas
        </p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: `"Contex360" <${process.env.SMTP_FROM || 'noreply@contex360.com'}>`,
        to: admin.email,
        subject: `Factura ${invoice.invoiceNumber} — Contex360`,
        html,
        attachments: [
          {
            filename: `Factura_${invoice.invoiceNumber}.pdf`,
            path: pdfPath,
            contentType: 'application/pdf',
          },
        ],
      });

      this.logger.log(`Factura ${invoice.invoiceNumber} enviada a ${admin.email}`);
      this.usageService.recordUsage(invoice.tenantId, 'email_sent');
    } catch (err) {
      this.logger.error(`Error enviando factura ${invoice.invoiceNumber}:`, err);
    }
  }
}
