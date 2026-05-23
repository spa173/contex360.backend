import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../database/prisma.service';

export interface SendInvoiceMailPayload {
  tenantId: string;
  invoiceId: string;
  clientEmail: string;
  clientName: string;
  invoiceNumber: string;
  cufe: string;
  total: number;
  xmlFileName: string;
  xmlBase64: string;
}

@Injectable()
export class InvoiceMailerService {
  private readonly logger = new Logger(InvoiceMailerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generatePdf(payload: SendInvoiceMailPayload, tenantName: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        // Header
        doc.fontSize(20).text(tenantName, { align: 'center' });
        doc.moveDown();
        doc.fontSize(14).text(`Factura Electrónica de Venta: ${payload.invoiceNumber}`, { align: 'center' });
        doc.moveDown();

        // Info
        doc.fontSize(12).text(`Cliente: ${payload.clientName}`);
        doc.text(`Total: $${payload.total.toLocaleString('es-CO')}`);
        doc.text(`CUFE: ${payload.cufe}`);
        doc.moveDown();
        doc.fillColor('grey').text(`Esta es una representación gráfica básica de la factura electrónica.`, { align: 'center' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  async sendInvoice(payload: SendInvoiceMailPayload) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: payload.tenantId } });
    if (!tenant) return;

    if (!tenant.smtpHost || !tenant.smtpPort || !tenant.smtpUser || !tenant.smtpPassword || !tenant.smtpFromEmail) {
      this.logger.warn(`Tenant ${tenant.name} no tiene configurado el SMTP. No se enviará la factura por correo.`);
      return;
    }

    const pdfBuffer = await this.generatePdf(payload, tenant.name);
    const xmlBuffer = Buffer.from(payload.xmlBase64, 'base64');

    const transporter = nodemailer.createTransport({
      host: tenant.smtpHost,
      port: tenant.smtpPort,
      secure: tenant.smtpPort === 465,
      auth: {
        user: tenant.smtpUser,
        pass: tenant.smtpPassword,
      },
    });

    const html = `
      <div style="font-family: sans-serif; color: #333;">
        <h2>Hola ${payload.clientName},</h2>
        <p>Adjunto a este correo encontrará la Factura Electrónica <strong>${payload.invoiceNumber}</strong> emitida por <strong>${tenant.name}</strong> por un valor de <strong>$${payload.total.toLocaleString('es-CO')}</strong>.</p>
        <p>El Código Único de Factura Electrónica (CUFE) es: <br/><code>${payload.cufe}</code></p>
        <p>Gracias por su compra.</p>
        <br/>
        <p>Atentamente,<br/>El equipo de ${tenant.name}</p>
      </div>
    `;

    try {
      await transporter.sendMail({
        from: `"${tenant.name}" <${tenant.smtpFromEmail}>`,
        to: payload.clientEmail,
        subject: `Factura Electrónica ${payload.invoiceNumber} - ${tenant.name}`,
        html,
        attachments: [
          {
            filename: `Factura_${payload.invoiceNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
          {
            filename: payload.xmlFileName,
            content: xmlBuffer,
            contentType: 'application/xml',
          },
        ],
      });
      this.logger.log(`Factura ${payload.invoiceNumber} enviada exitosamente a ${payload.clientEmail} usando SMTP de ${tenant.name}`);
    } catch (err) {
      this.logger.error(`Error enviando factura por SMTP para tenant ${tenant.name}:`, err);
    }
  }
}
