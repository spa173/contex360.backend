import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { AiService } from './src/modules/ai/ai.service';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const aiService = app.get(AiService);
  const config = app.get(ConfigService);
  
  const tenantId = 'test-tenant';
  const userName = 'Camilo';
  
  console.log('\n=======================================');
  console.log('🤖 INICIANDO TEST DEL ASISTENTE EJECUTIVO');
  console.log('=======================================\n');

  try {
    console.log('📝 PRUEBA 1: Creación de Cotización en Borrador');
    const res1 = await aiService.processChat(tenantId, userName, true, 'Por favor crea una cotización en borrador para Cliente XYZ por 3 licencias de software');
    console.log('Respuesta de la IA:\n', res1.content);
    console.log('\n---------------------------------------\n');

    console.log('🛡️ PRUEBA 2: Análisis de Riesgo Crediticio');
    const res2 = await aiService.processChat(tenantId, userName, true, 'Analiza el riesgo de darle crédito al cliente Juan Perez');
    console.log('Respuesta de la IA:\n', res2.content);
    console.log('\n---------------------------------------\n');

    console.log('💬 PRUEBA 3: Generación de Copys de Cobro');
    const res3 = await aiService.processChat(tenantId, userName, true, 'Redacta un mensaje de cobro para Maria, me debe 50,000 COP hace 15 dias');
    console.log('Respuesta de la IA:\n', res3.content);
    console.log('\n=======================================');
  } catch (err) {
    console.error('Error durante el test:', err);
  } finally {
    await app.close();
  }
}
bootstrap();
