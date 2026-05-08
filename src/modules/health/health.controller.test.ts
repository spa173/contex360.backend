import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HealthController } from './health.controller'
import { HealthService } from './health.service'

describe('HealthController', () => {
  let controller: HealthController
  let healthService: { getStatus: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    healthService = {
      getStatus: vi.fn(() => ({
        status: 'ok',
        service: 'contex360-backend',
      })),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthService,
          useValue: healthService,
        },
      ],
    }).compile()

    controller = moduleRef.get(HealthController)
  })

  it('delegates the health check to the service', () => {
    expect(controller.check()).toEqual({
      status: 'ok',
      service: 'contex360-backend',
    })
    expect(healthService.getStatus).toHaveBeenCalledTimes(1)
  })
})

