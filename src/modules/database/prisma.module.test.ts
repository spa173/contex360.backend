import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'
import { PrismaModule } from './prisma.module'

describe('PrismaModule', () => {
  it('compiles as a module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile()

    expect(moduleRef).toBeDefined()
  })
})
