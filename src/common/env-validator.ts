import { Logger } from '@nestjs/common';

const logger = new Logger('EnvValidator');

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'OAUTH_STATE_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
];

export function validateEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error('❌ Faltan variables de entorno críticas:');
    missing.forEach((key) => logger.error(`   - ${key}`));
    logger.error('El sistema no puede arrancar sin estas configuraciones.');
    
    // En producción, salimos inmediatamente
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    } else {
      logger.warn('⚠️ Continuando en modo desarrollo, pero algunas funciones fallarán.');
    }
  } else {
    logger.log('✅ Todas las variables de entorno críticas están presentes.');
  }
}
