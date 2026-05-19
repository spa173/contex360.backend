import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { PLANS } from './plans.config';

@Injectable()
export class WompiService {
  private readonly wompiUrl = 'https://api.wompi.co/v1';

  private get publicKey() {
    return process.env.WOMPI_PUBLIC_KEY || 'pub_test_fake_public_key';
  }

  private get privateKey() {
    return process.env.WOMPI_PRIVATE_KEY || 'prv_test_fake_private_key';
  }

  private get webhookSecret() {
    return process.env.WOMPI_WEBHOOK_SECRET || 'wsec_test_fake_webhook_secret';
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

    try {
      const response = await axios.post(
        `${this.wompiUrl}/payment_links`,
        {
          name: `Suscripción Contex360 - ${plan.name} (${billing === 'annual' ? 'Anual' : 'Mensual'})`,
          description: `Pago de suscripción para tenant ${tenantId}`,
          single_use: true,
          amount_in_cents: amountInCents,
          currency: 'COP',
          redirect_url: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
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
      concatenatedString += String(body.timestamp);

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
