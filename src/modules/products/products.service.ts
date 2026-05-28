import { Injectable } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { parse } from 'csv-parse/sync'

export interface ImportResult {
  imported: number
  errors: Array<{ row: number; message: string }>
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string) {
    return this.prisma.product.findMany({
      where: { tenantId },
    })
  }

  async findOne(id: string, tenantId: string) {
    return this.prisma.product.findFirst({
      where: { id, tenantId },
    })
  }

  async create(data: any, tenantId: string) {
    return this.prisma.product.create({
      data: {
        ...data,
        tenantId,
      },
    })
  }

  async importCsv(tenantId: string, csvBuffer: Buffer): Promise<ImportResult> {
    const result: ImportResult = { imported: 0, errors: [] }
    const raw = parse(csvBuffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as Record<string, string>[]

    for (let i = 0; i < raw.length; i++) {
      const row = raw[i]
      const rowNum = i + 2
      try {
        if (!row.name || !row.sku) {
          result.errors.push({ row: rowNum, message: 'Faltan campos obligatorios: name, sku' })
          continue
        }
        await this.prisma.product.create({
          data: {
            tenantId,
            name: row.name,
            sku: row.sku,
            price: Number.parseFloat(row.price || '0'),
            cost: row.cost ? Number.parseFloat(row.cost) : 0,
            taxRate: row.taxRate ? Number.parseFloat(row.taxRate) : 0,
            stock: row.stock ? Number.parseInt(row.stock, 10) : 0,
            minStock: row.minStock ? Number.parseInt(row.minStock, 10) : 0,
            maxStock: row.maxStock ? Number.parseInt(row.maxStock, 10) : 0,
            location: row.location || '',
            category: row.category || '',
            barcode: row.barcode || '',
            stockByLocation: row.stockByLocation || '{}',
            isInventoriable: row.isInventoriable ? row.isInventoriable === 'true' || row.isInventoriable === '1' : true,
            productType: row.productType || 'producto',
            unit: row.unit || 'und',
          },
        })
        result.imported++
      } catch (err: any) {
        const message = err.code === 'P2002' ? `SKU duplicado: ${row.sku}` : (err.message || 'Error desconocido')
        result.errors.push({ row: rowNum, message })
      }
    }

    return result
  }
}
