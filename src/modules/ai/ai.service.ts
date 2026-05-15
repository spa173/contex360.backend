import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from '../database/prisma.service'
import { AnalyticsService } from '../analytics/analytics.service'
import { LOGISTIC_BRAIN_PROMPT } from './ai.prompts'

@Injectable()
export class AiService {
  private readonly genAI: GoogleGenerativeAI

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
    private readonly config: ConfigService,
  ) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    this.genAI = new GoogleGenerativeAI(apiKey || '')
  }

  async processChat(tenantId: string, isSystemOwner: boolean, message: string, history: any[] = []) {
    const now = new Date()
    const formattedDate = now.toLocaleDateString('es-CO', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    })
    const formattedTime = now.toLocaleTimeString('es-CO', { 
      hour: '2-digit', minute: '2-digit' 
    })

    const systemPrompt = LOGISTIC_BRAIN_PROMPT(tenantId, isSystemOwner, formattedDate, formattedTime)

    const tools = [
      {
        functionDeclarations: [
          {
            name: 'get_company_summary',
            description: 'Obtiene el resumen financiero (ventas, alertas) y la lista de colaboradores/empleados de la empresa.',
            parameters: {
              type: 'OBJECT',
              properties: {
                targetTenantId: {
                  type: 'STRING',
                  description: 'ID de la empresa a consultar. Opcional (por defecto usa la activa).',
                },
              },
            },
          },
          {
            name: 'get_inventory_status',
            description: 'Consulta el estado actual del inventario, productos y alertas de stock.',
            parameters: {
              type: 'OBJECT',
              properties: {
                query: {
                  type: 'STRING',
                  description: 'Filtro de búsqueda o categoría (opcional).',
                },
              },
            },
          },
        ],
      },
    ]

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.0-flash-exp',
        systemInstruction: systemPrompt,
        tools: tools as any,
      })

      const chat = model.startChat({
        history: history,
      })

      let result = await chat.sendMessage(message)
      let responseText = ''

      // Manejo de Function Calling
      const parts = result.response.candidates?.[0]?.content?.parts || []
      const call = parts.find(p => p.functionCall)
      
      if (call?.functionCall) {
        const { name, args } = call.functionCall
        // Validar permisos para targetTenantId si el usuario no es Root
        const effectiveTenantId = (isSystemOwner && (args as any).targetTenantId) ? (args as any).targetTenantId : tenantId
        
        const functionResult = await this.executeTool(name, args, effectiveTenantId)
        
        const response = await chat.sendMessage([
          {
            functionResponse: {
              name,
              response: functionResult
            }
          }
        ])
        responseText = response.response.text().trim()
      } else {
        responseText = result.response.text().trim()
      }

      return this.formatResponse(responseText)
    } catch (error: any) {
      console.error('Gemini Error:', error.message)
      return {
        role: 'assistant',
        content: 'Hubo un problema al procesar la solicitud con el cerebro de IA.',
      }
    }
  }

  private async executeTool(name: string, args: any, tenantId: string) {
    try {
      if (name === 'get_company_summary') {
        const [stats, memberships] = await Promise.all([
          this.analytics.getDashboardKpis(tenantId),
          this.prisma.membership.findMany({
            where: { tenantId },
            include: { user: { select: { name: true, email: true, title: true } } }
          })
        ])

        return {
          financials: {
            totalSales: stats.totalSales,
            lowStockAlerts: stats.lowStockAlerts,
            currency: 'COP'
          },
          employees: memberships.map(m => ({
            name: m.user.name,
            role: m.role,
            position: m.user.title
          }))
        }
      }

      if (name === 'get_inventory_status') {
        const products = await this.prisma.product.findMany({
          where: { tenantId },
          take: 30,
          select: { name: true, stock: true, sku: true, price: true }
        })
        return { products }
      }

      return { error: 'Herramienta no reconocida' }
    } catch (error: any) {
      return { error: `Error ejecutando herramienta: ${error.message}` }
    }
  }

  private formatResponse(responseText: string) {
    let suggestedAction: string | undefined = undefined
    const lowerRes = responseText.toLowerCase()
    if (lowerRes.includes('facturación') || lowerRes.includes('factura')) {
      suggestedAction = 'view_billing'
    } else if (lowerRes.includes('inventario') || lowerRes.includes('stock')) {
      suggestedAction = 'manage_inventory'
    } else if (lowerRes.includes('venta') || lowerRes.includes('reporte')) {
      suggestedAction = 'view_reports'
    }

    return {
      role: 'assistant',
      content: responseText,
      suggestedAction
    }
  }
}
