import { OCR_EXTRACTION_PROMPT, OCR_QUALITY_CHECK_PROMPT } from './ocr.prompts'
import { describe, it, expect } from 'vitest'

describe('OCR Prompts', () => {
  it('should export OCR_EXTRACTION_PROMPT as a string', () => {
    expect(typeof OCR_EXTRACTION_PROMPT).toBe('string')
    expect(OCR_EXTRACTION_PROMPT.length).toBeGreaterThan(0)
  })

  it('should generate quality check prompt with extracted text', () => {
    const text = '{"vendor": "Test"}'
    const prompt = OCR_QUALITY_CHECK_PROMPT(text)
    expect(prompt).toContain('El siguiente JSON fue extraído')
    expect(prompt).toContain(text)
  })
})
