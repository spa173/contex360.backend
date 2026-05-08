import { Test } from '@nestjs/testing'
import { AiService } from './ai.service'
import { PrismaService } from '../database/prisma.service'
import { AnalyticsService } from '../analytics/analytics.service'
import { ConfigService } from '@nestjs/config'
import { describe, expect, it, beforeEach, vi } from 'vitest'

let mockGenerateContent = vi.fn()

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel() {
      return {
        generateContent: (...args: any[]) => mockGenerateContent(...args)
      }
    }
  }
}))

describe('AiService', () => {
  let service: AiService
  let analytics: { getDashboardKpis: any }

  beforeEach(async () => {
    analytics = {
      getDashboardKpis: vi.fn(),
    }

    const module = await Test.createTestingModule({
      providers: [
        AiService,
        { 
          provide: PrismaService, 
          useValue: { 
            product: { findMany: vi.fn().mockResolvedValue([]) },
            invoice: { findMany: vi.fn().mockResolvedValue([]) }
          } 
        },
        { provide: AnalyticsService, useValue: analytics },
        {
          provide: ConfigService,
          useValue: { get: vi.fn().mockReturnValue('mock-api-key') }
        },
      ],
    }).compile()

    service = module.get<AiService>(AiService)
  })

  it('responds to sales queries', async () => {
    analytics.getDashboardKpis.mockResolvedValue({ totalSales: 1500000, lowStockAlerts: 0 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Has vendido un total de $1.500.000. Mira los reportes.' }
    })
    
    const result = await service.processChat('tenant-1', '¿Cuánto he vendido?')
    
    expect(result.content).toContain('$1.500.000')
    expect(result.suggestedAction).toBe('view_reports')
  })

  it('responds to stock queries with alerts', async () => {
    analytics.getDashboardKpis.mockResolvedValue({ totalSales: 0, lowStockAlerts: 3, totalStockItems: 50 })
    mockGenerateContent.mockResolvedValue({
      response: { text: () => 'Tienes 3 productos por debajo del stock mínimo. Revisa el inventario.' }
    })
    
    const result = await service.processChat('tenant-1', '¿Cómo está mi inventario?')
    
    expect(result.content).toContain('3 productos por debajo del stock mínimo')
    expect(result.suggestedAction).toBe('manage_inventory')
  })

  it('handles Gemini API errors gracefully', async () => {
    analytics.getDashboardKpis.mockResolvedValue({ totalSales: 0, lowStockAlerts: 0 })
    mockGenerateContent.mockRejectedValue(new Error('API Down'))
    
    const result = await service.processChat('tenant-1', 'hola')
    
    expect(result.content).toContain('problema al conectar')
    expect(result.suggestedAction).toBeUndefined()
  })
})
