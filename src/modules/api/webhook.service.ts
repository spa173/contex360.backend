import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../database/prisma.service'
import * as crypto from 'crypto'

const MAX_RETRIES = 5
const RETRY_DELAYS = [60, 300, 900, 3600, 14400]

export interface WebhookEvent {
  event: string
  tenantId: string
  data: Record<string, unknown>
  timestamp: string
  signature?: string
}

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name)

  constructor(private readonly prisma: PrismaService) {}

  async createWebhook(tenantId: string, data: { name: string; url: string; events: string[] }) {
    const secret = crypto.randomBytes(32).toString('hex')
    return this.prisma.webhook.create({
      data: { tenantId, ...data, secret },
      select: { id: true, name: true, url: true, events: true, active: true, createdAt: true },
    })
  }

  async listWebhooks(tenantId: string) {
    return this.prisma.webhook.findMany({
      where: { tenantId },
      select: { id: true, name: true, url: true, events: true, active: true, lastSent: true, lastStatus: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
  }

  async updateWebhook(tenantId: string, id: string, data: { name?: string; url?: string; events?: string[]; active?: boolean }) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id, tenantId } })
    if (!webhook) throw new Error('Webhook no encontrado')
    return this.prisma.webhook.update({ where: { id }, data })
  }

  async deleteWebhook(tenantId: string, id: string) {
    const webhook = await this.prisma.webhook.findFirst({ where: { id, tenantId } })
    if (!webhook) throw new Error('Webhook no encontrado')
    return this.prisma.webhook.delete({ where: { id } })
  }

  async dispatch(event: string, tenantId: string, data: Record<string, unknown>) {
    const webhooks = await this.prisma.webhook.findMany({
      where: { tenantId, active: true, events: { has: event } },
    })

    const payload: WebhookEvent = {
      event,
      tenantId,
      data,
      timestamp: new Date().toISOString(),
    }

    for (const wh of webhooks) {
      payload.signature = crypto
        .createHmac('sha256', wh.secret || '')
        .update(JSON.stringify(payload))
        .digest('hex')

      this.sendWithRetry(wh.id, wh.url, wh.secret, payload, 0)
    }

    if (webhooks.length > 0) {
      this.logger.log(`Webhook "${event}" dispatched to ${webhooks.length} endpoint(s) for tenant ${tenantId}`)
    }
  }

  private async sendWithRetry(webhookId: string, url: string, secret: string | null, payload: WebhookEvent, attempt: number) {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': payload.signature || '',
        'X-Webhook-Event': payload.event,
        'X-Webhook-Timestamp': payload.timestamp,
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (response.ok) {
        await this.prisma.webhook.update({
          where: { id: webhookId },
          data: { lastSent: new Date(), lastStatus: `HTTP ${response.status}`, retryCount: 0 },
        })
      } else {
        throw new Error(`HTTP ${response.status}`)
      }
    } catch (err: any) {
      const nextAttempt = attempt + 1
      if (nextAttempt <= MAX_RETRIES) {
        const delay = RETRY_DELAYS[attempt] || RETRY_DELAYS[RETRY_DELAYS.length - 1]
        this.logger.warn(`Webhook ${webhookId} failed (attempt ${nextAttempt}/${MAX_RETRIES}), retrying in ${delay}s: ${err.message}`)
        await this.prisma.webhook.update({
          where: { id: webhookId },
          data: { retryCount: nextAttempt, lastStatus: `error: ${err.message?.slice(0, 100)}` },
        })
        setTimeout(() => this.sendWithRetry(webhookId, url, secret, payload, nextAttempt), delay * 1000)
      } else {
        this.logger.error(`Webhook ${webhookId} failed after ${MAX_RETRIES} attempts, giving up`)
        await this.prisma.webhook.update({
          where: { id: webhookId },
          data: { active: false, retryCount: MAX_RETRIES, lastStatus: 'failed after max retries' },
        })
      }
    }
  }

  async replayFailed(tenantId: string, event?: string) {
    const where: any = { tenantId, active: false, lastStatus: { contains: 'failed' } }
    if (event) where.events = { has: event }

    const failed = await this.prisma.webhook.findMany({ where })
    for (const wh of failed) {
      await this.prisma.webhook.update({ where: { id: wh.id }, data: { active: true, retryCount: 0 } })
    }
    return { reactivated: failed.length }
  }

  @Cron('0 5 * * *', { timeZone: 'America/Bogota' })
  async retryFailedWebhooks() {
    const failedHooks = await this.prisma.webhook.findMany({
      where: { active: true, retryCount: { gt: 0, lt: MAX_RETRIES } },
    })
    for (const wh of failedHooks) {
      this.sendWithRetry(wh.id, wh.url, wh.secret, { event: 'retry', tenantId: wh.tenantId, data: {}, timestamp: new Date().toISOString() }, wh.retryCount)
    }
    if (failedHooks.length > 0) this.logger.log(`Retrying ${failedHooks.length} failed webhook(s)`)
  }
}
