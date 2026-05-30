import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { LocalStorageProvider } from './local-storage.provider'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('LocalStorageProvider', () => {
  let provider: LocalStorageProvider
  const mockConfig = {
    get: vi.fn().mockReturnValue('http://localhost:3000/uploads'),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        LocalStorageProvider,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    provider = module.get(LocalStorageProvider)
  })

  afterEach(async () => {
    // Clean up local uploads directory created during test if exists
    const uploadsDir = join(process.cwd(), 'uploads')
    if (existsSync(uploadsDir)) {
      await rm(uploadsDir, { recursive: true, force: true })
    }
  })

  it('should be defined', () => {
    expect(provider).toBeDefined()
  })

  it('should upload a file and return correct metadata', async () => {
    const key = 'test-file.txt'
    const buffer = Buffer.from('hello world')
    const mimeType = 'text/plain'

    const result = await provider.upload(key, buffer, mimeType)

    expect(result.url).toBe('http://localhost:3000/uploads/test-file.txt')
    expect(result.key).toBe(key)
    expect(result.mimeType).toBe(mimeType)
    expect(result.sizeBytes).toBe(buffer.length)

    // Verify file actually written to local disk
    const filePath = join(process.cwd(), 'uploads', key)
    expect(existsSync(filePath)).toBe(true)
    const content = await readFile(filePath, 'utf8')
    expect(content).toBe('hello world')
  })

  it('should delete an uploaded file', async () => {
    const key = 'test-delete.txt'
    const buffer = Buffer.from('delete me')
    const mimeType = 'text/plain'

    await provider.upload(key, buffer, mimeType)
    const filePath = join(process.cwd(), 'uploads', key)
    expect(existsSync(filePath)).toBe(true)

    await provider.delete(key)
    expect(existsSync(filePath)).toBe(false)
  })

  it('should build key correctly', () => {
    const key = provider.buildKey('tenant-1', 'ocr', 'uuid-123', 'pdf')
    expect(key).toContain('tenants/tenant-1/ocr/')
    expect(key.endsWith('uuid-123.pdf')).toBe(true)
  })
})
