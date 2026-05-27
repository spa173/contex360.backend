import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'node:crypto';
import { PLANS } from './plans.config';

@Injectable()
export class WompiService {
  private get wompiUrl() {
    return process.env.WOMPI_API_URL || 'https://production.wompi.co/v1';
  }

  private get publicKey() {
    const key = process.env.WOMPI_PUBLIC_KEY;
    if (!key) throw new HttpException('WOMPI_PUBLIC_KEY no configurado en producción', HttpStatus.INTERNAL_SERVER_ERROR);
    return key;
  }

  private get privateKey() {
    const key = process.env.WOMPI_PRIVATE_KEY;
    if (!key) throw new HttpException('WOMPI_PRIVATE_KEY no configurado en producción', HttpStatus.INTERNAL_SERVER_ERROR);
    return key;
  }

  private get webhookSecret() {
    const secret = process.env.WOMPI_EVENTS_SECRET || process.env.WOMPI_WEBHOOK_SECRET;
    if (!secret) throw new HttpException('WOMPI_EVENTS_SECRET no configurado en producción', HttpStatus.INTERNAL_SERVER_ERROR);
    return secret;
  }

  async createPaymentLink(
    planType: 'starter' | 'pyme' | 'enterprise',
    billing: 'monthly' | 'annual',
    tenantId: string
  ) {
    const plan = PLANS[planType];
    if (!plan) {
      throw new HttpException('Plan inválido', HttpStatus.BAD_REQUEST);
    }

    const price = billing === 'annual' ? plan.priceAnnual : plan.priceMonthly;
    const amountInCents = price * 100;
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5173';
    const redirectUrl = `${frontendBase.replace(/\/$/, '')}/pago-exitoso?planType=${planType}&billing=${billing}`;

    try {
      const response = await axios.post(
        `${this.wompiUrl}/payment_links`,
        {
          name: `Suscripción Contex360 - ${plan.name} (${billing === 'annual' ? 'Anual' : 'Mensual'})`,
          description: `Pago de suscripción para tenant ${tenantId}`,
          single_use: true,
          amount_in_cents: amountInCents,
          currency: 'COP',
          redirect_url: redirectUrl,
          sku: `${planType}_${billing}_${tenantId}`
        },
        {
          headers: {
            Authorization: `Bearer ${this.publicKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.data;
    } catch (error: any) {
      throw new HttpException(
        error.response?.data?.error?.reason || 'Error al crear el link de pago en Wompi',
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  verifyWebhook(signature: string, body: any): boolean {
    if (!signature && !body?.signature?.checksum) return false;

    try {
      const properties = body.signature?.properties || [];
      const receivedChecksum = body.signature?.checksum || signature;
      if (!properties.length || !receivedChecksum) {
        return false;
      }

      const getNestedValue = (obj: any, path: string) => {
        return path.split('.').reduce((acc, part) => acc && acc[part], obj);
      };

      let concatenatedString = '';
      for (const prop of properties) {
        const val = getNestedValue(body.data, prop);
        concatenatedString += val !== undefined ? String(val) : '';
      }

      // Concatenate timestamp
      concatenatedString += String(body.timestamp || body?.data?.timestamp || body?.data?.transaction?.updated_at || '');

      // Concatenate secret
      concatenatedString += this.webhookSecret;

      // Compute SHA-256
      const hash = crypto.createHash('sha256').update(concatenatedString).digest('hex');

      return hash === receivedChecksum;
    } catch (e) {
      return false;
    }
  }
}
