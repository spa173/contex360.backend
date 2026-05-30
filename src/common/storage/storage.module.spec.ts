import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { STORAGE_PROVIDER } from './storage.interface'
import { LocalStorageProvider } from './local-storage.provider'
import { R2StorageProvider } from './r2-storage.provider'
import { StorageModule } from './storage.module'
import { describe, it, expect, vi } from 'vitest'

describe('StorageModule', () => {
  it('should use R2StorageProvider if R2 credentials are configured', async () => {
    const mockConfig = {
      get: vi.fn((key: string) => {
        const configMap: Record<string, string> = {
          R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
          R2_ACCESS_KEY_ID: 'test-access-key-id',
          R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
          R2_BUCKET: 'test-bucket',
          R2_PUBLIC_URL: 'https://files.test.com',
        }
        return configMap[key]
      }),
      getOrThrow: vi.fn((key: string) => 'test-value'),
    }

    const module = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfig)
      .compile()

    const storageProvider = module.get(STORAGE_PROVIDER)
    expect(storageProvider).toBeInstanceOf(R2StorageProvider)
  })

  it('should use LocalStorageProvider if R2 credentials are not configured', async () => {
    const mockConfig = {
      get: vi.fn((key: string) => undefined),
      getOrThrow: vi.fn((key: string) => {
        if (key === 'UPLOADS_PUBLIC_URL') return 'http://localhost:3000/uploads'
        return 'test-value'
      }),
    }

    const module = await Test.createTestingModule({
      imports: [StorageModule],
    })
      .overrideProvider(ConfigService)
      .useValue(mockConfig)
      .compile()

    const storageProvider = module.get(STORAGE_PROVIDER)
    expect(storageProvider).toBeInstanceOf(LocalStorageProvider)
  })
})
