/**
 * Gemini prompt for structured invoice data extraction.
 * Designed for Colombian accounting context (IVA, NIT, DIAN).
 */
export const OCR_EXTRACTION_PROMPT = `Eres un sistema experto en reconocimiento óptico de caracteres (OCR) y extracción de datos contables para el mercado colombiano.

TAREA: Analiza el documento adjunto y extrae los datos de factura o documento contable en formato JSON estricto.

INSTRUCCIONES:
1. Extrae SOLO la información que está claramente visible en el documento.
2. Para valores que no puedas leer o no existan, usa null — NUNCA inventes datos.
3. Los montos deben ser números (sin símbolos de moneda, sin puntos de miles).
4. Las tasas de impuesto son porcentajes (ej: 19 para 19% de IVA).
5. Las fechas en formato ISO si es posible (YYYY-MM-DD), o el texto tal como aparece.
6. El confidence es tu nivel de certeza del 0.0 al 1.0 sobre la calidad de la extracción.

RESPONDE ÚNICAMENTE con el siguiente JSON (sin explicaciones, sin markdown):

{
  "vendor": "Nombre de la empresa emisora o null",
  "vendorNit": "NIT del emisor (solo dígitos y guión) o null",
  "invoiceNumber": "Número de factura o documento o null",
  "date": "Fecha de emisión o null",
  "dueDate": "Fecha límite de pago o null",
  "currency": "COP",
  "items": [
    {
      "description": "Descripción del ítem",
      "quantity": 1,
      "unitPrice": 0,
      "taxRate": 19,
      "subtotal": 0,
      "taxAmount": 0
    }
  ],
  "subtotal": 0,
  "taxTotal": 0,
  "total": 0,
  "paymentMethod": "Método de pago o null",
  "notes": "Notas adicionales relevantes o null",
  "confidence": 0.95
}

REGLAS ESPECIALES PARA COLOMBIA:
- El NIT tiene formato XXXXXXXXX-X (9 dígitos + dígito de verificación)
- El IVA estándar es 19%, bienes exentos 0%, algunos servicios 5%
- Las facturas electrónicas DIAN tienen CUFE — inclúyelo en notes si aparece
- Si el documento NO es una factura (ej: recibo de caja, orden de compra), extrae igualmente los campos disponibles`

export const OCR_QUALITY_CHECK_PROMPT = (extractedText: string) =>
  `El siguiente JSON fue extraído de una factura por OCR. Verifica si los datos son coherentes y corrige errores evidentes (montos que no cuadran, fechas inválidas, NITs malformados). Responde con el JSON corregido o con el mismo JSON si está correcto.

${extractedText}`
