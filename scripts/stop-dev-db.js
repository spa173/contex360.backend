const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const pgBinDir = process.env.PG_BIN_DIR || 'C:\\Program Files\\PostgreSQL\\18\\bin'
const pgDataDir = path.join(repoRoot, '.pgdata')

function run(executable, args) {
  const result = spawnSync(executable, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    shell: false,
  })

  if (result.status !== 0) {
    const stderr = (result.stderr || result.stdout || '').trim()
    throw new Error(stderr || `Command failed: ${executable} ${args.join(' ')}`)
  }
}

function main() {
  const pgCtlExe = path.join(pgBinDir, 'pg_ctl.exe')
  run(pgCtlExe, ['-D', pgDataDir, '-m', 'fast', '-w', 'stop'])
  process.stdout.write('Local PostgreSQL cluster stopped.\n')
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

