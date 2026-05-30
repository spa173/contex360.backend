import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { OcrUploadDto, OcrListQueryDto, OcrRetryDto } from './ocr.dto'
import { describe, it, expect } from 'vitest'

describe('OCR DTOs', () => {
  it('should validate and transform OcrUploadDto', async () => {
    const plain = { autoCreatePurchase: 'true', notes: 'some notes' }
    const dto = plainToInstance(OcrUploadDto, plain)
    expect(dto.autoCreatePurchase).toBe(true)
    const errors = await validate(dto)
    expect(errors.length).toBe(0)
  })

  it('should validate and transform OcrListQueryDto', async () => {
    const plain = { page: '2', limit: '15', status: 'pending' }
    const dto = plainToInstance(OcrListQueryDto, plain)
    expect(dto.page).toBe(2)
    expect(dto.limit).toBe(15)
    const errors = await validate(dto)
    expect(errors.length).toBe(0)
  })

  it('should validate and transform OcrRetryDto', async () => {
    const plain = { autoCreatePurchase: 'true' }
    const dto = plainToInstance(OcrRetryDto, plain)
    expect(dto.autoCreatePurchase).toBe(true)
    const errors = await validate(dto)
    expect(errors.length).toBe(0)
  })
})
