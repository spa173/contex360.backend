import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ThrottlerModule } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
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
import { NotificationModule } from './modules/notification/notification.module'
import { DemoModule } from './modules/demo/demo.module'
import { LedgerModule } from './modules/ledger/ledger.module'
import { PurchasesModule } from './modules/purchases/purchases.module'
import { DianModule } from './modules/dian/dian.module'
import { TreasuryModule } from './modules/treasury/treasury.module'
import { QuotesModule } from './modules/quotes/quotes.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60000, limit: 100 }, // Aumentado el límite para evitar falsos positivos
      { name: 'long', ttl: 3600000, limit: 1000 },
    ]),
    ScheduleModule.forRoot(),
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
    NotificationModule,
    DemoModule,
    LedgerModule,
    PurchasesModule,
    DianModule,
    TreasuryModule,
    QuotesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Comentado temporalmente el guard global para descartar bloqueos de CORS por Throttling
    // { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
