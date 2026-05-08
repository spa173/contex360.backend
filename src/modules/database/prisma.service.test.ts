import { describe, expect, it, vi } from 'vitest'
import { PrismaService } from './prisma.service'

describe('PrismaService', () => {
  it('disconnects when the app shuts down', async () => {
    const service = new PrismaService()
    const disconnectSpy = vi.spyOn(service, '$disconnect').mockResolvedValue(undefined)

    await service.onApplicationShutdown()

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })
})

