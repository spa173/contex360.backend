import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, createHash } from 'node:crypto'
import type { IStorageProvider, UploadedFile } from './storage.interface'

/**
 * Cloudflare R2 storage provider using S3-compatible API.
 * Signs requests with AWS Signature V4 — no external SDK required.
 *
 * Required env vars:
 *   R2_ENDPOINT      = https://<account>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID = Cloudflare R2 access key
 *   R2_SECRET_ACCESS_KEY = Cloudflare R2 secret key
 *   R2_BUCKET        = bucket name
 *   R2_PUBLIC_URL    = https://files.contex360.com (public domain/CDN URL)
 */
@Injectable()
export class R2StorageProvider implements IStorageProvider {
  private readonly logger = new Logger(R2StorageProvider.name)
  private readonly endpoint: string
  private readonly accessKeyId: string
  private readonly secretAccessKey: string
  private readonly bucket: string
  private readonly publicUrl: string
  private readonly region = 'auto'

  constructor(private readonly config: ConfigService) {
    this.endpoint = config.get<string>('R2_ENDPOINT') || ''
    this.accessKeyId = config.get<string>('R2_ACCESS_KEY_ID') || ''
    this.secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY') || ''
    this.bucket = config.get<string>('R2_BUCKET') || ''
    this.publicUrl = config.get<string>('R2_PUBLIC_URL') || ''
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadedFile> {
    const url = `${this.endpoint}/${this.bucket}/${key}`
    const headers = await this.signRequest('PUT', key, mimeType, buffer)

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: buffer as any,
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`R2 upload failed (${response.status}): ${body.slice(0, 200)}`)
    }

    this.logger.log(`R2: uploaded ${key} (${buffer.length} bytes, ${mimeType})`)

    return {
      url: `${this.publicUrl}/${key}`,
      key,
      mimeType,
      sizeBytes: buffer.length,
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const url = `${this.endpoint}/${this.bucket}/${key}`
      const headers = await this.signRequest('DELETE', key, '', Buffer.alloc(0))
      await fetch(url, { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) })
    } catch (e: any) {
      this.logger.warn(`R2: delete failed for ${key}: ${e.message}`)
    }
  }

  buildKey(tenantId: string, folder: string, uuid: string, ext: string): string {
    const month = new Date().toISOString().slice(0, 7)
    return `tenants/${tenantId}/${folder}/${month}/${uuid}.${ext}`
  }

  // ── AWS Signature V4 ────────────────────────────────────────────────────────

  private async signRequest(
    method: string,
    key: string,
    contentType: string,
    body: Buffer,
  ): Promise<Record<string, string>> {
    const now = new Date()
    const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z' // 20260529T143000Z
    const dateOnly = dateStr.slice(0, 8) // 20260529

    const bodyHash = createHash('sha256').update(body).digest('hex')
    const host = new URL(this.endpoint).host

    const canonicalHeaders = [
      `content-type:${contentType}`,
      `host:${host}`,
      `x-amz-content-sha256:${bodyHash}`,
      `x-amz-date:${dateStr}`,
    ].join('\n') + '\n'

    const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'

    const canonicalRequest = [
      method,
      `/${this.bucket}/${key}`,
      '',
      canonicalHeaders,
      signedHeaders,
      bodyHash,
    ].join('\n')

    const credentialScope = `${dateOnly}/${this.region}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      dateStr,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n')

    const signingKey = this.deriveSigningKey(dateOnly)
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`

    return {
      'Content-Type': contentType,
      'Host': host,
      'X-Amz-Content-Sha256': bodyHash,
      'X-Amz-Date': dateStr,
      'Authorization': authorization,
    }
  }

  private deriveSigningKey(dateOnly: string): Buffer {
    const kDate    = createHmac('sha256', `AWS4${this.secretAccessKey}`).update(dateOnly).digest()
    const kRegion  = createHmac('sha256', kDate).update(this.region).digest()
    const kService = createHmac('sha256', kRegion).update('s3').digest()
    return createHmac('sha256', kService).update('aws4_request').digest()
  }
}
