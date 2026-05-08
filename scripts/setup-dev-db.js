const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const pgBinDir = process.env.PG_BIN_DIR || 'C:\\Program Files\\PostgreSQL\\18\\bin'
const pgDataDir = path.join(repoRoot, '.pgdata')
const pgLogFile = path.join(pgDataDir, 'postgres.log')
const pgPort = Number(process.env.PG_PORT || 5433)
const pgUser = process.env.PG_USER || 'postgres'
const pgDatabase = process.env.PG_DATABASE || 'contex360'
const pgHost = process.env.PG_HOST || 'localhost'
const envFile = path.join(repoRoot, '.env')
const databaseUrl = `postgresql://${pgUser}@${pgHost}:${pgPort}/${pgDatabase}?schema=public`

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim()
    throw new Error(stderr || `Command failed: ${executable} ${args.join(' ')}`)
  }

  return (result.stdout || '').trim()
}

function fileExists(targetPath) {
  return fs.existsSync(targetPath)
}

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true })
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const finish = (value) => {
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(500)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, pgHost)
  })
}

async function main() {
  ensureDirectory(pgDataDir)

  const initdbExe = path.join(pgBinDir, 'initdb.exe')
  const pgCtlExe = path.join(pgBinDir, 'pg_ctl.exe')
  const psqlExe = path.join(pgBinDir, 'psql.exe')
  const createdbExe = path.join(pgBinDir, 'createdb.exe')

  if (!fileExists(path.join(pgDataDir, 'PG_VERSION'))) {
    run(initdbExe, [
      '-D',
      pgDataDir,
      '-U',
      pgUser,
      '--auth-local=trust',
      '--auth-host=trust',
      '--encoding=UTF8',
      '--locale=C',
    ])
  }

  if (!(await isPortOpen(pgPort))) {
    run(pgCtlExe, ['-D', pgDataDir, '-l', pgLogFile, '-o', `-p ${pgPort}`, '-w', 'start'])
  }

  const databaseCheck = run(psqlExe, [
    '-h',
    pgHost,
    '-p',
    String(pgPort),
    '-U',
    pgUser,
    '-d',
    'postgres',
    '-w',
    '-tAc',
    `SELECT 1 FROM pg_database WHERE datname='${pgDatabase}'`,
  ])

  if (databaseCheck !== '1') {
    run(createdbExe, ['-h', pgHost, '-p', String(pgPort), '-U', pgUser, '-w', pgDatabase])
  }

  if (!fileExists(envFile)) {
    fs.writeFileSync(
      envFile,
      [
        'PORT=3001',
        'APP_NAME=Contex360 Backend',
        'CORS_ORIGIN=http://localhost:5173',
        'SWAGGER_PATH=docs',
        `DATABASE_URL=${databaseUrl}`,
        'JWT_SECRET=change-me-in-development',
        '',
      ].join('\n'),
      'utf8',
    )
  }

  process.stdout.write(`Database ready at ${databaseUrl}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
