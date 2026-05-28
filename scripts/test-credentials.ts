import * as path from 'path'
import * as fs from 'fs'
import Groq from 'groq-sdk'

// Cargar .env manualmente de forma ultra simple para compatibilidad
const envPath = path.join(__dirname, '../.env')
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmedLine = line.trim()
    if (!trimmedLine || trimmedLine.startsWith('#')) continue

    const eqIndex = trimmedLine.indexOf('=')
    if (eqIndex !== -1) {
      const key = trimmedLine.substring(0, eqIndex).trim()
      let value = trimmedLine.substring(eqIndex + 1).trim()
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1)
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1)
      }
      process.env[key] = value.trim()
    }
  }
}

async function testGroq() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    console.log('❌ GROQ_API_KEY no encontrada en tu archivo .env.')
    return
  }
  console.log('🤖 Probando Groq...')
  try {
    const groq = new Groq({ apiKey })
    const res = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'Di "Groq está activo y listo" en español en una frase corta.' }],
      max_tokens: 50,
    })
    console.log(`✅ Groq respondió con éxito: "${res.choices[0]?.message?.content?.trim()}"`)
  } catch (e: any) {
    console.log(`❌ Error probando Groq: ${e.message}`)
  }
}

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    console.log('❌ GEMINI_API_KEY no encontrada en tu archivo .env.')
    return
  }
  console.log('♊ Probando Gemini...')
  try {
    const { GoogleGenAI } = await (eval('import("@google/genai")') as Promise<any>)
    const ai = new GoogleGenAI({ apiKey })
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Di "Gemini está activo y listo" en español en una frase corta.',
    })
    console.log(`✅ Gemini respondió con éxito: "${res.text?.trim()}"`)
  } catch (e: any) {
    console.log(`❌ Error probando Gemini: ${e.message}`)
  }
}

async function run() {
  console.log('=== INICIANDO PRUEBA DE CONECTIVIDAD IA ===')
  await testGroq()
  console.log('-----------------------------------------')
  await testGemini()
  console.log('=== PRUEBA FINALIZADA ===')
}

run()
