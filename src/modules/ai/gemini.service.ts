import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name)
  private ai?: any

  constructor(private readonly config: ConfigService) {}

  private async getClient(): Promise<any> {
    if (this.ai) return this.ai

    const apiKey = this.config.get<string>('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('Google Gen AI SDK no inicializado: GEMINI_API_KEY faltante en el servidor.')
    }

    try {
      // Usar importación dinámica evaluada a nivel de runtime para evitar que tsc lo convierta en require()
      const { GoogleGenAI } = await (eval('import("@google/genai")') as Promise<any>)
      this.ai = new GoogleGenAI({ apiKey })
      return this.ai
    } catch (error: any) {
      this.logger.error(`Error cargando @google/genai de forma dinámica: ${error.message}`, error.stack)
      throw new Error(`No se pudo cargar el SDK de Google Gen AI de forma dinámica: ${error.message}`)
    }
  }

  async generateText(
    model: string,
    systemPrompt: string,
    message: string,
    history: any[] = [],
    attachment?: string,
  ): Promise<string> {
    const client = await this.getClient()

    try {
      const contents: any[] = []

      // 1. Convertir el historial al formato del SDK de Gemini
      for (const h of history) {
        if (!h) continue
        const role = h.role === 'assistant' || h.role === 'model' ? 'model' : 'user'
        const text = Array.isArray(h.parts) ? (h.parts[0]?.text ?? '') : (h.content ?? '')
        if (text) {
          contents.push({
            role,
            parts: [{ text }],
          })
        }
      }

      // 2. Preparar el mensaje y el adjunto actual
      const userParts: any[] = []

      if (attachment) {
        const match = attachment.match(/^data:([^;]+);base64,(.+)$/)
        if (match) {
          const mimeType = match[1]
          const base64Data = match[2]
          userParts.push({
            inlineData: {
              data: base64Data,
              mimeType,
            },
          })
        }
      }

      userParts.push({ text: message })

      contents.push({
        role: 'user',
        parts: userParts,
      })

      // 3. Ejecutar llamada al modelo utilizando el SDK de Google Gen AI
      const response = await client.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
        },
      })

      return response.text || ''
    } catch (error: any) {
      this.logger.error(`Error en Gemini (${model}): ${error.message}`, error.stack)
      throw error
    }
  }
}
