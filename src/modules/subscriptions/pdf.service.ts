import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

export interface SubscriptionInvoicePdfData {
  invoiceNumber: string;
  amount: number;
  tax: number;
  total: number;
  planType: string;
  billing: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  createdAt: Date;
  cufe: string | null;
  dianStatus: string | null;
  items?: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    taxAmount?: number;
    total?: number;
  }>;
}

export interface SupplierData {
  name: string;
  nit: string;
  address?: string;
  phone?: string;
  resolution?: string;
  resolutionFrom?: Date | null;
  resolutionTo?: Date | null;
  operationCode?: string;
  environment?: string;
}

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  async generateInvoicePdf(
    invoice: SubscriptionInvoicePdfData,
    supplier: SupplierData,
  ): Promise<string> {
    const tmpDir = join(process.cwd(), 'tmp');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 60, left: 50, right: 50 },
      info: {
        Title: `Factura de Suscripción ${invoice.invoiceNumber}`,
        Author: supplier.name || 'Contex360 SAS',
        Subject: 'Factura de Venta Electrónica',
      },
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));

    const pdfBuffer = await new Promise<Buffer>((resolve) => {
      doc.on('end', () => resolve(Buffer.concat(buffers)));

      // ─── HEADER: Supplier Info ───
      this.renderSupplierHeader(doc, supplier);

      // ─── INVOICE TITLE & NUMBER ───
      doc.moveDown(0.5);
      this.renderInvoiceTitle(doc, invoice);

      // ─── RESOLUTION INFO ───
      if (supplier.resolution) {
        this.renderResolution(doc, supplier);
      }

      // ─── CLIENT INFO ───
      doc.moveDown(0.5);
      this.renderClientInfo(doc, invoice, supplier);

      // ─── ITEMS TABLE ───
      doc.moveDown(1);
      this.renderItemsTable(doc, invoice);

      // ─── TOTALS ───
      doc.moveDown(0.5);
      this.renderTotals(doc, invoice);

      // ─── PAYMENT INFO ───
      doc.moveDown(1);
      this.renderPaymentInfo(doc, invoice);

      // ─── CUFE & QR ───
      doc.moveDown(1);
      this.renderCufeSection(doc, invoice);

      // ─── FOOTER ───
      doc.moveDown(1);
      this.renderFooter(doc, supplier);

      doc.end();
    });

    const filePath = join(tmpDir, `factura_${invoice.invoiceNumber}.pdf`);
    writeFileSync(filePath, pdfBuffer);
    return filePath;
  }

  private renderSupplierHeader(doc: PDFKit.PDFDocument, supplier: SupplierData) {
    // Company name
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .fillColor('#1E3A5F')
      .text(supplier.name || 'Contex360 SAS', { align: 'left' });

    // NIT
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#4A5568')
      .text(`NIT: ${supplier.nit || '900000000'}`);

    // Address & phone
    if (supplier.address || supplier.phone) {
      const parts = [supplier.address, supplier.phone].filter(Boolean);
      doc.text(parts.join(' — '));
    }

    // Divider
    doc.moveDown(0.3);
    const y = doc.y;
    doc
      .strokeColor('#E2E8F0')
      .lineWidth(1)
      .moveTo(50, y)
      .lineTo(doc.page.width - 50, y)
      .stroke();
  }

  private renderInvoiceTitle(doc: PDFKit.PDFDocument, invoice: SubscriptionInvoicePdfData) {
    const y = doc.y + 10;

    // Title badge
    doc
      .rect(50, y, 180, 32)
      .fill('#EBF4FF');

    doc
      .font('Helvetica-Bold')
      .fontSize(16)
      .fillColor('#1E40AF')
      .text('FACTURA DE VENTA', 60, y + 8, { width: 160 });

    // Invoice number (right side)
    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .fillColor('#1E3A5F')
      .text(invoice.invoiceNumber, doc.page.width - 200, y + 10, {
        width: 150,
        align: 'right',
      });

    // Date
    const issueDate = invoice.paidAt || invoice.createdAt;
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#4A5568')
      .text(
        `Fecha de emisión: ${this.formatDate(issueDate)}`,
        doc.page.width - 200,
        y + 26,
        { width: 150, align: 'right' },
      );

    doc.y = y + 42;
  }

  private renderResolution(doc: PDFKit.PDFDocument, supplier: SupplierData) {
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#6B7280');

    let resText = `Resolución DIAN: ${supplier.resolution}`;
    if (supplier.resolutionFrom && supplier.resolutionTo) {
      resText += ` | Rango: ${this.formatDate(supplier.resolutionFrom)} a ${this.formatDate(supplier.resolutionTo)}`;
    }
    if (supplier.operationCode) {
      resText += ` | Código de operación: ${supplier.operationCode}`;
    }
    if (supplier.environment) {
      resText += ` | Ambiente: ${supplier.environment === 'production' ? 'Producción' : 'Pruebas'}`;
    }

    doc.text(resText);
  }

  private renderClientInfo(
    doc: PDFKit.PDFDocument,
    invoice: SubscriptionInvoicePdfData,
    supplier: SupplierData,
  ) {
    const y = doc.y + 5;

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#6B7280')
      .text('CLIENTE', 50, y);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#1E3A5F')
      .text(`Empresa: ${supplier.name || 'N/A'}`, 50, y + 14)
      .text(`NIT: ${supplier.nit || 'N/A'}`, 50, y + 28);

    // Plan details on the right
    const planNames: Record<string, string> = {
      starter: 'Starter',
      pyme: 'Pyme',
      enterprise: 'Enterprise',
      trial: 'Prueba',
    };

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#6B7280')
      .text('DETALLE DEL SERVICIO', doc.page.width / 2 + 20, y);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#1E3A5F')
      .text(
        `Plan: ${planNames[invoice.planType] || invoice.planType}`,
        doc.page.width / 2 + 20,
        y + 14,
      )
      .text(
        `Facturación: ${invoice.billing === 'annual' ? 'Anual' : 'Mensual'}`,
        doc.page.width / 2 + 20,
        y + 28,
      )
      .text(
        `Período: ${this.formatDate(invoice.periodStart)} — ${this.formatDate(invoice.periodEnd)}`,
        doc.page.width / 2 + 20,
        y + 42,
      );

    doc.y = y + 58;
  }

  private renderItemsTable(doc: PDFKit.PDFDocument, invoice: SubscriptionInvoicePdfData) {
    const y = doc.y;
    const colWidths = { desc: 260, qty: 50, price: 90, tax: 70, total: 80 };
    const startX = 50;

    // Table header
    doc
      .rect(startX, y, doc.page.width - 100, 22)
      .fill('#F1F5F9');

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#475569')
      .text('Descripción', startX + 8, y + 6, { width: colWidths.desc })
      .text('Cant.', startX + colWidths.desc + 5, y + 6, { width: colWidths.qty, align: 'center' })
      .text('Valor Unit.', startX + colWidths.desc + colWidths.qty + 10, y + 6, { width: colWidths.price, align: 'right' })
      .text('IVA', startX + colWidths.desc + colWidths.qty + colWidths.price + 15, y + 6, { width: colWidths.tax, align: 'right' })
      .text('Total', startX + colWidths.desc + colWidths.qty + colWidths.price + colWidths.tax + 20, y + 6, { width: colWidths.total, align: 'right' });

    let rowY = y + 28;

    // Items
    const items = invoice.items || [
      {
        productName: `Suscripción ${invoice.planType} — ${invoice.billing === 'annual' ? 'Anual' : 'Mensual'}`,
        quantity: 1,
        unitPrice: invoice.amount,
        taxAmount: invoice.tax,
        total: invoice.total,
      },
    ];

    for (const item of items) {
      const itemTotal = item.total ?? item.unitPrice * item.quantity;
      const itemTax = item.taxAmount ?? 0;

      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#1E293B')
        .text(item.productName, startX + 8, rowY, { width: colWidths.desc })
        .text(String(item.quantity), startX + colWidths.desc + 5, rowY, { width: colWidths.qty, align: 'center' })
        .text(this.formatCurrency(item.unitPrice), startX + colWidths.desc + colWidths.qty + 10, rowY, { width: colWidths.price, align: 'right' })
        .text(this.formatCurrency(itemTax), startX + colWidths.desc + colWidths.qty + colWidths.price + 15, rowY, { width: colWidths.tax, align: 'right' })
        .text(this.formatCurrency(itemTotal), startX + colWidths.desc + colWidths.qty + colWidths.price + colWidths.tax + 20, rowY, { width: colWidths.total, align: 'right' });

      rowY += 16;
    }

    // Bottom border
    doc
      .strokeColor('#E2E8F0')
      .lineWidth(0.5)
      .moveTo(startX, rowY + 4)
      .lineTo(doc.page.width - 50, rowY + 4)
      .stroke();

    doc.y = rowY + 12;
  }

  private renderTotals(doc: PDFKit.PDFDocument, invoice: SubscriptionInvoicePdfData) {
    const startX = doc.page.width - 230;
    const colVal = 130;

    // Subtotal
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#4A5568')
      .text('Subtotal:', startX, doc.y)
      .text(this.formatCurrency(invoice.amount), startX + colVal, doc.y - 14, { align: 'right', width: colVal });

    // IVA
    doc
      .text('IVA (19%):', startX, doc.y + 2)
      .text(this.formatCurrency(invoice.tax), startX + colVal, doc.y - 12, { align: 'right', width: colVal });

    // Divider
    const divY = doc.y + 6;
    doc
      .strokeColor('#1E3A5F')
      .lineWidth(1)
      .moveTo(startX, divY)
      .lineTo(doc.page.width - 50, divY)
      .stroke();

    // Total
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor('#1E3A5F')
      .text('TOTAL:', startX, divY + 8)
      .text(this.formatCurrency(invoice.total), startX + colVal, divY + 6, { align: 'right', width: colVal });

    doc.y = divY + 28;
  }

  private renderPaymentInfo(doc: PDFKit.PDFDocument, invoice: SubscriptionInvoicePdfData) {
    const y = doc.y;

    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#6B7280')
      .text('FORMA DE PAGO', 50, y);

    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#1E3A5F')
      .text('Pago electrónico — Wompi', 50, y + 14)
      .text(
        `Estado: ${invoice.paidAt ? 'Pagado' : 'Pendiente'}`,
        50,
        y + 28,
      );

    if (invoice.paidAt) {
      doc.text(`Fecha de pago: ${this.formatDate(invoice.paidAt)}`, 50, y + 42);
    }

    doc.y = y + 58;
  }

  private renderCufeSection(doc: PDFKit.PDFDocument, invoice: SubscriptionInvoicePdfData) {
    if (!invoice.cufe) {
      doc
        .font('Helvetica-Oblique')
        .fontSize(9)
        .fillColor('#9CA3AF')
        .text('CUFE pendiente de generación por la DIAN.', 50, doc.y);
      doc.y += 10;
      return;
    }

    const y = doc.y;

    // QR Code (left side)
    const qrUrl = `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${invoice.cufe}`;

    QRCode.toDataURL(qrUrl, { width: 100, margin: 1 }, (err, dataUrl) => {
      if (!err && dataUrl) {
        try {
          const qrBuffer = Buffer.from(dataUrl.split(',')[1], 'base64');
          doc.image(qrBuffer, 50, y, { width: 80, height: 80 });
        } catch (_e) {
          // QR generation failed silently
        }
      }
    });

    // CUFE text (right side)
    const textX = 150;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#6B7280')
      .text('CUFE (SHA-384):', textX, y);

    // Wrap CUFE text
    doc
      .font('Courier')
      .fontSize(7.5)
      .fillColor('#374151')
      .text(invoice.cufe, textX, y + 14, { width: doc.page.width - 210 });

    // DIAN status badge
    const statusColors: Record<string, string> = {
      accepted: '#059669',
      sent: '#D97706',
      pending: '#6B7280',
      rejected: '#DC2626',
    };
    const statusLabels: Record<string, string> = {
      accepted: 'Aceptado por DIAN',
      sent: 'Enviado a DIAN',
      pending: 'Pendiente de envío',
      rejected: 'Rechazado por DIAN',
    };

    const status = invoice.dianStatus || 'pending';
    const statusColor = statusColors[status] || '#6B7280';
    const statusLabel = statusLabels[status] || status;

    const badgeY = y + 60;
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(statusColor)
      .text(`● ${statusLabel}`, textX, badgeY);

    doc.y = y + 90;
  }

  private renderFooter(doc: PDFKit.PDFDocument, supplier: SupplierData) {
    const y = doc.y;

    // Divider
    doc
      .strokeColor('#E2E8F0')
      .lineWidth(0.5)
      .moveTo(50, y)
      .lineTo(doc.page.width - 50, y)
      .stroke();

    // Legal text
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#9CA3AF')
      .text(
        'Este documento es una factura electrónica generada por el sistema de facturación de Contex360 SAS. ' +
        'La reproducción alterada o ilegible no tiene validez. ' +
        'Para verificar la autenticidad de esta factura consulte el CUFE en el catálogo de la DIAN: ' +
        'https://catalogo-vpfe.dian.gov.co/',
        50,
        y + 8,
        { width: doc.page.width - 100 },
      );

    // Environment notice
    if (supplier.environment === 'test') {
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor('#D97706')
        .text(
          '⚠ DOCUMENTO DE PRUEBA — Sin validez fiscal',
          50,
          doc.y + 6,
          { align: 'center' },
        );
    }

    // System footer
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#CBD5E1')
      .text(
        `Generado por Contex360 — ${new Date().toISOString()}`,
        50,
        doc.y + 8,
        { align: 'center' },
      );
  }

  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private formatCurrency(value: number): string {
    return '$' + value.toLocaleString('es-CO');
  }
}
