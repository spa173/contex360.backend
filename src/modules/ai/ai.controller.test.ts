import { Test, TestingModule } from '@nestjs/testing'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'

import { PrismaService } from '../database/prisma.service'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'

describe('AiController', () => {
  let controller: AiController
  let service: AiService

  const mockAiService = {
    processChat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'test' })
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AiController],
      providers: [
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: Reflector, useValue: {} },
        {
          provide: AiService,
          useValue: mockAiService,
        },
      ],
    }).compile()

    controller = module.get<AiController>(AiController)
    service = module.get<AiService>(AiService)
  })

  it('should be defined', () => {
    expect(controller).toBeDefined()
  })

  it('should call chat', async () => {
    const res = await controller.chat('t1', 'hello')
    expect(res).toEqual({ role: 'assistant', content: 'test' })
    expect(service.processChat).toHaveBeenCalledWith('t1', 'hello')
  })
})
