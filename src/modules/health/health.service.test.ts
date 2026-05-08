import { describe, expect, it } from 'vitest'
import { HealthService } from './health.service'

describe('HealthService', () => {
  it('returns an ok status payload', () => {
    const service = new HealthService()
    const result = service.getStatus()

    expect(result.status).toBe('ok')
    expect(result.service).toBe('contex360-backend')
    expect(typeof result.timestamp).toBe('string')
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date')
    expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0)
  })
})

