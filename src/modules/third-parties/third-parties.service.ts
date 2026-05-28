import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../database/prisma.service'
import { ThirdPartyKind, TaxRegime } from '@prisma/client'
import { parse } from 'csv-parse/sync'

export interface ImportResult {
  imported: number
  errors: Array<{ row: number; message: string }>
}

@Injectable()
export class ThirdPartiesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, kind?: ThirdPartyKind) {
    return this.prisma.thirdParty.findMany({
      where: {
        tenantId,
        ...(kind ? { kind } : {}),
      },
      orderBy: { name: 'asc' },
    })
  }

  async findOne(tenantId: string, id: string) {
    const thirdParty = await this.prisma.thirdParty.findFirst({
      where: { id, tenantId },
    })

    if (!thirdParty) {
      throw new NotFoundException('Tercero no encontrado')
    }

    return thirdParty
  }

  async create(tenantId: string, data: {
    name: string
    nit: string
    email: string
    phone?: string
    address?: string
    city?: string
    kind: ThirdPartyKind
    taxProfile: string
    taxRegime?: TaxRegime
    fiscalResponsibilities?: string[]
  }) {
    return this.prisma.thirdParty.create({
      data: {
        ...data,
        tenantId,
      },
    })
  }

  async update(tenantId: string, id: string, data: Partial<{
    name: string
    nit: string
    email: string
    phone: string
    address: string
    city: string
    kind: ThirdPartyKind
    taxProfile: string
    taxRegime: TaxRegime
    fiscalResponsibilities: string[]
    isActive: boolean
  }>) {
    await this.findOne(tenantId, id)

    return this.prisma.thirdParty.update({
      where: { id },
      data,
    })
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id)

    return this.prisma.thirdParty.delete({
      where: { id },
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

    const validKinds: string[] = Object.values(ThirdPartyKind)
    const validRegimes: string[] = Object.values(TaxRegime)

    for (let i = 0; i < raw.length; i++) {
      const row = raw[i]
      const rowNum = i + 2
      try {
        if (!row.name || !row.nit) {
          result.errors.push({ row: rowNum, message: 'Faltan campos obligatorios: name, nit' })
          continue
        }

        const kind = (row.kind || 'client').toLowerCase()
        if (!validKinds.includes(kind)) {
          result.errors.push({ row: rowNum, message: `Tipo inválido: "${row.kind}". Usar: ${validKinds.join(', ')}` })
          continue
        }

        const taxRegime = row.taxRegime ? row.taxRegime.toLowerCase() : 'comun'
        if (!validRegimes.includes(taxRegime)) {
          result.errors.push({ row: rowNum, message: `Régimen inválido: "${row.taxRegime}". Usar: ${validRegimes.join(', ')}` })
          continue
        }

        await this.prisma.thirdParty.create({
          data: {
            tenantId,
            name: row.name,
            nit: row.nit,
            email: row.email || '',
            phone: row.phone || null,
            address: row.address || null,
            city: row.city || null,
            kind: kind as ThirdPartyKind,
            taxProfile: row.taxProfile || 'Común',
            taxRegime: taxRegime as TaxRegime,
            fiscalResponsibilities: row.fiscalResponsibilities
              ? row.fiscalResponsibilities.split(';').map(s => s.trim()).filter(Boolean)
              : [],
            isActive: row.isActive ? row.isActive === 'true' || row.isActive === '1' : true,
          },
        })
        result.imported++
      } catch (err: any) {
        const message = err.code === 'P2002' ? `NIT duplicado: ${row.nit}` : (err.message || 'Error desconocido')
        result.errors.push({ row: rowNum, message })
      }
    }

    return result
  }
}
