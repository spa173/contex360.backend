import { describe, expect, it } from 'vitest'
import { AppService } from './app.service'

describe('AppService', () => {
  it('returns the basic backend metadata', () => {
    const service = new AppService()

    expect(service.getInfo()).toEqual({
      name: 'Contex360 Backend',
      status: 'ok',
      message: 'Backend scaffold ready.',
      endpoints: {
        health: '/health',
        docs: '/docs',
      },
    })
  })
})

