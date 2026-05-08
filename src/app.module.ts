import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { AuthModule } from './modules/auth/auth.module'
import { PrismaModule } from './modules/database/prisma.module'
import { HealthModule } from './modules/health/health.module'
import { ProductsModule } from './modules/products/products.module'
import { ThirdPartiesModule } from './modules/third-parties/third-parties.module'
import { InvoicesModule } from './modules/invoices/invoices.module'
import { InventoryModule } from './modules/inventory/inventory.module'
import { AnalyticsModule } from './modules/analytics/analytics.module'
import { AiModule } from './modules/ai/ai.module'
import { AdminModule } from './modules/admin/admin.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    ProductsModule,
    ThirdPartiesModule,
    InvoicesModule,
    InventoryModule,
    AnalyticsModule,
    AiModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
