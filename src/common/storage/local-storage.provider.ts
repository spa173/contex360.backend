import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IStorageProvider, UploadedFile } from './storage.interface'

/**
 * Local disk storage provider — development fallback.
 * Saves files under OS temp dir. Files are ephemeral across container restarts.
 * In production, configure R2_ENDPOINT to activate R2StorageProvider instead.
 */
@Injectable()
export class LocalStorageProvider implements IStorageProvider {
  private readonly logger = new Logger(LocalStorageProvider.name)
  private readonly baseDir: string
  private readonly baseUrl: string

  constructor(private readonly config: ConfigService) {
    this.baseDir = join(process.cwd(), 'uploads')
    this.baseUrl = config.get<string>('LOCAL_STORAGE_BASE_URL', 'http://localhost:3000/uploads')
  }

  async upload(key: string, buffer: Buffer, mimeType: string): Promise<UploadedFile> {
    const filePath = join(this.baseDir, key.replaceAll('/', '_'))

    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true })
    }

    await writeFile(filePath, buffer)
    this.logger.debug(`LocalStorage: saved ${key} (${buffer.length} bytes)`)

    return {
      url: `${this.baseUrl}/${key}`,
      key,
      mimeType,
      sizeBytes: buffer.length,
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.baseDir, key.replaceAll('/', '_'))
    try {
      await unlink(filePath)
    } catch {
      // Tolerant — file may not exist
    }
  }

  buildKey(tenantId: string, folder: string, uuid: string, ext: string): string {
    const month = new Date().toISOString().slice(0, 7) // 2026-05
    return `tenants/${tenantId}/${folder}/${month}/${uuid}.${ext}`
  }
}
