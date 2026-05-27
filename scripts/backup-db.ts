/**
 * Script de backup de base de datos PostgreSQL.
 * Ejecutar manualmente: npx ts-node scripts/backup-db.ts
 * O programar con cron: 0 2 * * * cd /app && npx ts-node scripts/backup-db.ts
 * 
 * Requiere:
 * - DATABASE_URL en .env
 * - BACKUP_BUCKET, BACKUP_ACCESS_KEY, BACKUP_SECRET_KEY (opcional, para S3/R2)
 */

import { execSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const BACKUP_DIR = process.env.BACKUP_DIR || './backups'
const RETENTION_DAYS = 7
const RETENTION_WEEKLY = 4

interface BackupConfig {
  databaseUrl: string
  bucket?: string
  accessKey?: string
  secretKey?: string
  region?: string
}

function loadConfig(): BackupConfig {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error('DATABASE_URL no está configurada')
  }

  return {
    databaseUrl,
    bucket: process.env.BACKUP_BUCKET,
    accessKey: process.env.BACKUP_ACCESS_KEY,
    secretKey: process.env.BACKUP_SECRET_KEY,
    region: process.env.BACKUP_REGION || 'us-east-1',
  }
}

async function createBackup(config: BackupConfig): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const filename = `contex360-backup-${timestamp}.sql.gz`
  const filepath = join(BACKUP_DIR, filename)

  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }

  console.log(`📦 Creando backup: ${filename}`)

  // pg_dump
  const dumpCommand = `pg_dump "${config.databaseUrl}" --no-owner --no-privileges --format=plain`
  
  try {
    const sqlData = execSync(dumpCommand, { 
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer
    })

    // Compress with gzip
    const { Readable } = await import('node:stream')
    const readable = Readable.from(sqlData)
    const writeStream = createWriteStream(filepath)
    const gzip = createGzip({ level: 9 })

    await pipeline(readable, gzip, writeStream)

    const stats = statSync(filepath)
    console.log(`✅ Backup creado: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`)

    return filepath
  } catch (error) {
    console.error('❌ Error creando backup:', error)
    throw error
  }
}

async function uploadToS3(filepath: string, config: BackupConfig): Promise<void> {
  if (!config.bucket || !config.accessKey || !config.secretKey) {
    console.log('⚠️  S3/R2 no configurado — backup solo local')
    return
  }

  const filename = filepath.split(/[/\\]/).pop() || ''
  
  try {
    // Usar AWS CLI si está disponible
    const command = `aws s3 cp "${filepath}" "s3://${config.bucket}/backups/${filename}" ` +
      `--region ${config.region} ` +
      `--endpoint-url ${process.env.BACKUP_ENDPOINT || 'https://s3.amazonaws.com'}`

    execSync(command, { encoding: 'utf8' })
    console.log(`✅ Subido a S3: s3://${config.bucket}/backups/${filename}`)
  } catch (error) {
    console.error('⚠️  Error subiendo a S3:', error)
    console.log('   El backup local se mantiene.')
  }
}

function cleanOldBackups(): void {
  if (!existsSync(BACKUP_DIR)) return

  const files = readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('contex360-backup-') && f.endsWith('.sql.gz'))
    .map(f => ({
      name: f,
      path: join(BACKUP_DIR, f),
      time: statSync(join(BACKUP_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time)

  const now = Date.now()
  const msPerDay = 24 * 60 * 60 * 1000

  // Keep all from last 7 days
  const cutoffDaily = now - (RETENTION_DAYS * msPerDay)
  // Keep weekly backups for 4 weeks
  const cutoffWeekly = now - (RETENTION_WEEKLY * 7 * msPerDay)

  let deletedCount = 0
  for (const file of files) {
    const age = now - file.time

    if (age < cutoffDaily) {
      // Recent — keep
      continue
    }

    if (age < cutoffWeekly) {
      // Within weekly retention — keep only Sunday backups
      const date = new Date(file.time)
      if (date.getDay() === 0) {
        continue
      }
    }

    // Old — delete
    unlinkSync(file.path)
    deletedCount++
  }

  if (deletedCount > 0) {
    console.log(`🗑️  ${deletedCount} backups antiguos eliminados`)
  }
}

async function main() {
  console.log('🔄 Iniciando backup de base de datos...')
  console.log(`   Fecha: ${new Date().toISOString()}`)

  try {
    const config = loadConfig()
    
    // 1. Create backup
    const filepath = await createBackup(config)

    // 2. Upload to S3/R2 (optional)
    await uploadToS3(filepath, config)

    // 3. Clean old backups
    cleanOldBackups()

    console.log('✅ Backup completado exitosamente')
  } catch (error) {
    console.error('❌ Backup falló:', error)
    process.exit(1)
  }
}

main()
