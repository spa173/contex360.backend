import { Test } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { R2StorageProvider } from './r2-storage.provider'
import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('R2StorageProvider', () => {
  let provider: R2StorageProvider
  const mockConfig = {
    getOrThrow: vi.fn((key: string) => {
      const configMap: Record<string, string> = {
        R2_ENDPOINT: 'https://test-account.r2.cloudflarestorage.com',
        R2_ACCESS_KEY_ID: 'test-access-key-id',
        R2_SECRET_ACCESS_KEY: 'test-secret-access-key',
        R2_BUCKET: 'test-bucket',
        R2_PUBLIC_URL: 'https://files.test.com',
      }
      return configMap[key]
    }),
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    const module = await Test.createTestingModule({
      providers: [
        R2StorageProvider,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile()

    provider = module.get(R2StorageProvider)
  })

  it('should be defined', () => {
    expect(provider).toBeDefined()
  })

  it('should upload a file successfully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('OK', { status: 200, statusText: 'OK' }))
    )

    const key = 'test-key.txt'
    const buffer = Buffer.from('hello r2')
    const mimeType = 'text/plain'

    const result = await provider.upload(key, buffer, mimeType)

    expect(fetchSpy).toHaveBeenCalled()
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://test-account.r2.cloudflarestorage.com/test-bucket/test-key.txt')
    expect(calledOptions.method).toBe('PUT')
    expect(calledOptions.body).toBe(buffer)
    expect(calledOptions.headers).toBeDefined()
    expect(calledOptions.headers?.['Authorization']).toContain('AWS4-HMAC-SHA256')

    expect(result.url).toBe('https://files.test.com/test-key.txt')
    expect(result.key).toBe(key)
    expect(result.mimeType).toBe(mimeType)
    expect(result.sizeBytes).toBe(buffer.length)

    fetchSpy.mockRestore()
  })

  it('should throw an error if upload fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response('Error message', { status: 400, statusText: 'Bad Request' }))
    )

    const key = 'test-key.txt'
    const buffer = Buffer.from('hello r2')
    const mimeType = 'text/plain'

    await expect(provider.upload(key, buffer, mimeType)).rejects.toThrow(
      'R2 upload failed (400): Error message'
    )

    fetchSpy.mockRestore()
  })

  it('should delete a file successfully', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 204 }))
    )

    const key = 'test-key.txt'
    await provider.delete(key)

    expect(fetchSpy).toHaveBeenCalled()
    const [calledUrl, calledOptions] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(calledUrl).toBe('https://test-account.r2.cloudflarestorage.com/test-bucket/test-key.txt')
    expect(calledOptions.method).toBe('DELETE')

    fetchSpy.mockRestore()
  })

  it('should log warning but not throw when delete fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.reject(new Error('Network Error'))
    )

    const key = 'test-key.txt'
    // Should not throw
    await expect(provider.delete(key)).resolves.not.toThrow()

    fetchSpy.mockRestore()
  })

  it('should build key correctly', () => {
    const key = provider.buildKey('tenant-xyz', 'invoices', 'uuid-999', 'xml')
    expect(key).toContain('tenants/tenant-xyz/invoices/')
    expect(key.endsWith('uuid-999.xml')).toBe(true)
  })
})
