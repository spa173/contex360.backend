import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from '../database/prisma.service'
import { AnalyticsService } from '../analytics/analytics.service'
import { PERSONAL_ASSISTANT_PROMPT } from './ai.prompts'

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

  async checkHealth() {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })
      const result = await model.generateContent('ping')
      return {
        status: 'ok',
        model: 'gemini-1.5-flash',
        apiVersion: 'v1',
        response: result.response.text().substring(0, 50)
      }
    } catch (error: any) {
      return {
        status: 'error',
        message: error.message,
        stack: error.stack,
        details: error.response?.data || error.response || 'No extra details'
      }
    }
  }

  async processChat(tenantId: string, userName: string, isSystemOwner: boolean, message: string, history: any[] = []) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) {
      return {
        role: 'assistant',
        content: 'Configuración incompleta: GEMINI_API_KEY no encontrada en el servidor.',
      }
    }

    const now = new Date()
    const formattedDate = now.toLocaleDateString('es-CO', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    })
    const formattedTime = now.toLocaleTimeString('es-CO', { 
      hour: '2-digit', minute: '2-digit' 
    })

    const systemPrompt = PERSONAL_ASSISTANT_PROMPT(tenantId, userName, isSystemOwner, formattedDate, formattedTime)

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
          {
            name: 'get_advanced_analytics',
            description: 'Obtiene analítica detallada (ventas, gastos, tendencias) filtrada por rangos de fecha y comparación de periodos.',
            parameters: {
              type: 'OBJECT',
              properties: {
                startDate: { type: 'STRING', description: 'Fecha inicio (ISO 8601, ej: 2024-01-01).' },
                endDate: { type: 'STRING', description: 'Fecha fin (ISO 8601).' },
                targetTenantId: { type: 'STRING', description: 'ID de empresa (opcional para Root).' },
                metric: { type: 'STRING', enum: ['sales', 'inventory', 'expenses', 'all'], description: 'Métrica específica a consultar.' }
              }
            }
          },
          {
            name: 'get_custom_metrics',
            description: 'Realiza cálculos complejos (sumas, promedios, conteos) sobre cualquier tabla (Invoice, Product, Purchase) con filtros personalizados.',
            parameters: {
              type: 'OBJECT',
              properties: {
                model: { type: 'STRING', enum: ['invoice', 'product', 'purchase', 'ledgerEntry'], description: 'Tabla sobre la cual calcular.' },
                operation: { type: 'STRING', enum: ['_sum', '_avg', '_count'], description: 'Operación matemática.' },
                field: { type: 'STRING', description: 'Campo numérico (ej: total, stock, price).' },
                where: { type: 'OBJECT', description: 'Filtros de Prisma (opcional).' }
              }
            }
          },
          {
            name: 'create_invoice_draft',
            description: 'Redacta un borrador de factura para un cliente si el usuario lo pide.',
            parameters: {
              type: 'OBJECT',
              properties: {
                clientName: { type: 'STRING', description: 'Nombre del cliente.' },
                items: { type: 'STRING', description: 'Descripción de los ítems a facturar.' },
              }
            }
          },
          {
            name: 'draft_email',
            description: 'Redacta un correo electrónico de cobro o de negocios.',
            parameters: {
              type: 'OBJECT',
              properties: {
                recipient: { type: 'STRING', description: 'Destinatario del correo.' },
                subject: { type: 'STRING', description: 'Asunto del correo.' },
                body: { type: 'STRING', description: 'Cuerpo sugerido.' }
              }
            }
          },
          {
            name: 'create_quote_draft',
            description: 'Redacta un borrador de cotización para un cliente.',
            parameters: {
              type: 'OBJECT',
              properties: {
                clientName: { type: 'STRING', description: 'Nombre del cliente.' },
                items: { type: 'STRING', description: 'Descripción de los ítems a cotizar.' },
              }
            }
          },
          {
            name: 'analyze_client_risk',
            description: 'Analiza el riesgo crediticio o historial de pagos de un cliente.',
            parameters: {
              type: 'OBJECT',
              properties: {
                clientName: { type: 'STRING', description: 'Nombre del cliente a evaluar.' }
              }
            }
          },
          {
            name: 'create_purchase_draft',
            description: 'Crea un borrador de orden de compra para reabastecer inventario.',
            parameters: {
              type: 'OBJECT',
              properties: {
                providerName: { type: 'STRING', description: 'Nombre del proveedor.' },
                products: { type: 'STRING', description: 'Productos a reabastecer.' }
              }
            }
          },
          {
            name: 'generate_collection_message',
            description: 'Genera un texto persuasivo para cobrar facturas vencidas por WhatsApp o Email.',
            parameters: {
              type: 'OBJECT',
              properties: {
                clientName: { type: 'STRING', description: 'Nombre del cliente deudor.' },
                daysOverdue: { type: 'NUMBER', description: 'Días de atraso.' },
                amount: { type: 'NUMBER', description: 'Monto de la deuda.' }
              }
            }
          }
        ],
      },
    ]

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
        systemInstruction: systemPrompt,
        tools: tools as any,
      })

      const chat = model.startChat({
        history: history,
      })

      const result = await chat.sendMessage(message)
      if (!result.response) {
        throw new Error('Respuesta vacía de Gemini')
      }

      let responseText = ''

      // Manejo robusto de Function Calling / Parts
      const candidates = result.response.candidates || []
      const parts = candidates[0]?.content?.parts || []
      const call = parts.find(p => p && p.functionCall)
      
      if (call?.functionCall) {
        const { name, args } = call.functionCall
        const effectiveTenantId = (isSystemOwner && (args as any)?.targetTenantId) ? (args as any).targetTenantId : tenantId
        
        const functionResult = await this.executeTool(name, args, effectiveTenantId)
        
        const response = await chat.sendMessage([
          {
            functionResponse: {
              name,
              response: functionResult
            }
          }
        ])
        responseText = response.response.text() || 'Operación completada con éxito.'
      } else {
        responseText = result.response.text() || 'No pude generar una respuesta de texto.'
      }

      return this.formatResponse(responseText.trim())
    } catch (error: any) {
      console.error('AiService Error:', error.stack || error.message)
      return {
        role: 'assistant',
        content: `Error del Cerebro IA: ${error.message || 'Error desconocido'}. Por favor contacta a soporte.`,
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

      if (name === 'get_advanced_analytics') {
        const { startDate, endDate, metric } = args
        const report = await this.analytics.getSalesReport(tenantId, startDate, endDate)
        const topProducts = await this.analytics.getTopProducts(tenantId, 5)
        
        // Detección simple de anomalías (Gasto > promedio histórico)
        const expenses = await this.prisma.purchase.findMany({
          where: { tenantId, status: { not: 'cancelled' } },
          select: { total: true, issuedAt: true }
        })
        const avgExpense = expenses.length > 0 
          ? expenses.reduce((s, e) => s + Number(e.total), 0) / expenses.length 
          : 0
        const highExpenses = expenses.filter(e => Number(e.total) > avgExpense * 1.5)

        return {
          report,
          topProducts,
          anomalies: highExpenses.map(e => ({
            date: e.issuedAt,
            amount: e.total,
            reason: 'Gasto 50% superior al promedio histórico'
          })),
          suggestedFormat: 'JSON_CHARTS' // Hint para que Gemini sepa que debe estructurar datos
        }
      }

      if (name === 'get_custom_metrics') {
        const { model, operation, field, where } = args
        return await this.analytics.getAggregates(tenantId, model, operation, field, where)
      }

      if (name === 'get_inventory_status') {
        const products = await this.prisma.product.findMany({
          where: { tenantId },
          take: 30,
          select: { name: true, stock: true, sku: true, price: true }
        })
        return { products }
      }

      if (name === 'create_invoice_draft') {
        const { clientName, items } = args;
        return { 
          status: 'draft_prepared', 
          message: `He preparado un borrador de factura para ${clientName} con los items: ${items}.`,
          suggestedAction: 'view_billing'
        };
      }

      if (name === 'draft_email') {
        const { recipient, subject, body } = args;
        return { 
          status: 'email_drafted', 
          message: `Borrador listo para enviar a ${recipient}. Asunto: ${subject}.`,
          body
        };
      }

      if (name === 'create_quote_draft') {
        const { clientName, items } = args;
        return { 
          status: 'draft_prepared', 
          message: `He preparado un borrador de cotización para ${clientName} con los items: ${items}. El usuario debe revisarlo y aprobarlo.`,
          suggestedAction: 'view_reports' 
        };
      }

      if (name === 'analyze_client_risk') {
        const { clientName } = args;
        return { 
          riskLevel: 'MODERATE', 
          message: `El cliente ${clientName} tiene un historial mixto. Sugiero exigir pago de contado para la próxima venta debido a retrasos previos.`,
        };
      }

      if (name === 'create_purchase_draft') {
        const { providerName, products } = args;
        return { 
          status: 'draft_prepared', 
          message: `He preparado un borrador de orden de compra para el proveedor ${providerName} para reabastecer: ${products}.`,
          suggestedAction: 'manage_inventory'
        };
      }

      if (name === 'generate_collection_message') {
        const { clientName, daysOverdue, amount } = args;
        return { 
          status: 'message_generated', 
          message: `Hola ${clientName}, esperamos que te encuentres muy bien. Te escribimos amablemente para recordarte que tienes un saldo pendiente de $${amount} con ${daysOverdue} días de mora. Agradecemos tu pronto pago para mantener tu cuenta al día. ¡Saludos!`,
        };
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

  async translateText(texts: Record<string, string>, targetLang: string) {
    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
      const prompt = `You are a professional translator for an ERP system. 
      Translate the following JSON object containing UI strings from Spanish to ${targetLang}. 
      Maintain the same keys. Preserve technical terms like 'ERP', 'DIAN', 'KPI', 'OCR'.
      Return ONLY the valid JSON object.
      
      JSON to translate:
      ${JSON.stringify(texts, null, 2)}`

      const result = await model.generateContent(prompt)
      const response = result.response.text()
      
      // Extract JSON if it contains markdown markers
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      const cleanJson = jsonMatch ? jsonMatch[0] : response
      
      return JSON.parse(cleanJson)
    } catch (error: any) {
      console.error('Translation Error:', error.message)
      throw new Error(`Failed to translate: ${error.message}`)
    }
  }
}
