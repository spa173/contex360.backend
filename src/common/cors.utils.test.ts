import { describe, expect, it } from 'vitest'
import { parseCorsOrigin } from './cors.utils'

describe('parseCorsOrigin', () => {
  it('allows every origin when the value is empty or wildcard', () => {
    expect(parseCorsOrigin(undefined)).toBe(true)
    expect(parseCorsOrigin('')).toBe(true)
    expect(parseCorsOrigin('   *   ')).toBe(true)
  })

  it('returns a single origin unchanged', () => {
    expect(parseCorsOrigin('http://localhost:5173')).toBe('http://localhost:5173')
  })

  it('returns multiple origins as an array', () => {
    expect(parseCorsOrigin('http://localhost:5173, http://127.0.0.1:5173')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ])
  })
})

