import { Logger } from '@nestjs/common';

const logger = new Logger('EnvValidator');
function safeLogFragment(value: unknown) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_SECRET',
  'CORS_ORIGIN',
]

const PRODUCTION_ONLY_VARS = [
  'ENCRYPTION_KEY',
]

export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error(`❌ Faltan variables de entorno críticas: ${missing.map((key) => safeLogFragment(key)).join(', ')}`);
    logger.error('El sistema no puede arrancar sin estas configuraciones.');
    
    // En producción, salimos inmediatamente
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      logger.warn('⚠️ Continuando en modo desarrollo, pero algunas funciones fallarán.');
    }
  } else {
    logger.log('✅ Todas las variables de entorno críticas están presentes.')
  }

  // Validar variables requeridas solo en producción
  if (process.env.NODE_ENV === 'production') {
    const missingProd = PRODUCTION_ONLY_VARS.filter((key) => !process.env[key])
    if (missingProd.length > 0) {
      logger.error(`❌ Variables de entorno requeridas en producción faltantes: ${missingProd.join(', ')}`)
      logger.error('Genera una clave con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
      process.exit(1)
    }
  }
}
