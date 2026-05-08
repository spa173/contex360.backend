import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { PrismaService } from '../database/prisma.service'
import { AnalyticsService } from '../analytics/analytics.service'

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

  async processChat(tenantId: string, message: string) {
    const now = new Date()
    const formattedDate = now.toLocaleDateString('es-CO', { 
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' 
    })
    const formattedTime = now.toLocaleTimeString('es-CO', { 
      hour: '2-digit', minute: '2-digit' 
    })

    const [stats, products, pendingInvoices] = await Promise.all([
      this.analytics.getDashboardKpis(tenantId),
      this.prisma.product.findMany({ where: { tenantId }, take: 50 }),
      this.prisma.invoice.findMany({ 
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { client: true },
        take: 20
      })
    ])

    const systemPrompt = `
      Eres el "Cerebro Logístico de Contex360", experto en gestión de inventarios y análisis financiero.
      Tu objetivo es ayudar al usuario a optimizar su capital y su operación basándote en los datos del sistema.
      
      TIEMPO: ${formattedDate}, ${formattedTime}
      
      DATOS OPERATIVOS:
      - Ventas Totales: $${stats.totalSales.toLocaleString()}
      - Alertas Stock Mínimo: ${stats.lowStockAlerts}
      - Valor Inventario: $${(Number(stats.totalSales) * 0.7).toLocaleString()} (Estimado)
      
      KARDEX (Resumen):
      ${products.map(p => `- ${p.name} | Stock: ${p.stock} | SKU: ${p.sku}`).join('\n')}
      
      FACTURACIÓN RECIENTE:
      ${pendingInvoices.map((i: any) => `- Factura ${i.id.slice(-6).toUpperCase()} | $${Number(i.total).toLocaleString()} | Cliente: ${i.client?.name || 'N/A'} | Estado: ${i.status}`).join('\n')}
      
      ### REGLAS MAESTRAS:
      1. Responde SIEMPRE en español de forma analítica y preventiva.
      2. Usa términos: Punto de reorden, Stock de seguridad, Kardex.
      3. No menciones detalles técnicos de la IA.
      4. Si preguntan por contraseñas o usuarios, redirige a la "Consola Admin".
      5. Diferenciación: Los "Servicios" no requieren stock (no alarmar si es 0).
    `

    try {
      const model = this.genAI.getGenerativeModel({ 
        model: 'gemini-2.5-flash-lite',
      })

      const result = await model.generateContent([
        { text: systemPrompt },
        { text: `Pregunta del usuario: ${message}` }
      ])
      
      const responseText = result.response.text().trim()

      return this.formatResponse(responseText)
    } catch (error: any) {
      console.error('Gemini Error:', error.message)
      return {
        role: 'assistant',
        content: 'Hubo un problema al conectar con el cerebro de Gemini. Por favor, verifica tu API Key y tu conexión a internet.',
        suggestedAction: undefined
      }
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
