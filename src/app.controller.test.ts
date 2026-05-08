import { Test } from '@nestjs/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppController } from './app.controller'
import { AppService } from './app.service'

describe('AppController', () => {
  let controller: AppController
  let appService: { getInfo: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    appService = {
      getInfo: vi.fn(() => ({
        name: 'Contex360 Backend',
        status: 'ok',
      })),
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: appService,
        },
      ],
    }).compile()

    controller = moduleRef.get(AppController)
  })

  it('delegates the info response to the service', () => {
    expect(controller.getInfo()).toEqual({
      name: 'Contex360 Backend',
      status: 'ok',
    })
    expect(appService.getInfo).toHaveBeenCalledTimes(1)
  })
})

