import { Module, NestModule, MiddlewareConsumer, OnApplicationShutdown } from '@nestjs/common'
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { OnboardingGuard } from './modules/onboarding/guard/onboarding.guard'
import { OnboardingModule } from './modules/onboarding/onboarding.module'
import { ActiveSubscriptionGuard } from './modules/subscriptions/active-subscription.guard'
import { PlanGuard } from './modules/auth/plan.guard'
import { TwoFactorGuard } from './modules/auth/two-factor.guard'
import { TenantRateLimitGuard } from './common/guards/tenant-rate-limit.guard'
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module'
import { LegalModule } from './modules/legal/legal.module'

import { ScheduleModule } from '@nestjs/schedule'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { RlsContextInterceptor } from './common/interceptors/rls-context.interceptor'
import { LoggerModule } from './common/logger/logger.module'
import { PrismaService } from './modules/database/prisma.service'
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
import { SupportModule } from './modules/support/support.module'
import { IntegrationsModule } from './modules/integrations/integrations.module'
import { HelpCenterModule } from './modules/help-center/help-center.module'
import { CsrfMiddleware } from './common/middleware/csrf.middleware'
import { CryptoModule } from './common/crypto/crypto.module'
import { UsersModule } from './modules/users/users.module'
import { AuditModule } from './modules/audit/audit.module'
import { PrivacyModule } from './modules/privacy/privacy.module'
import { TaxesModule } from './modules/taxes/taxes.module'
import { ContratosModule } from './modules/contratos/contratos.module'
import { ApiModule } from './modules/api/api.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 60000, limit: 30 },
      { name: 'long', ttl: 3600000, limit: 300 },
    ]),
    ScheduleModule.forRoot(),
    LoggerModule,
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
    SupportModule,
    IntegrationsModule,
    SubscriptionsModule,
    HelpCenterModule,
    OnboardingModule,
    UsersModule,
    CryptoModule,
    LegalModule,
    AuditModule,
    PrivacyModule,
    TaxesModule,
    ContratosModule,
    ApiModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: RlsContextInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: TenantRateLimitGuard },
    { provide: APP_GUARD, useClass: TwoFactorGuard },
    { provide: APP_GUARD, useClass: OnboardingGuard },
    { provide: APP_GUARD, useClass: ActiveSubscriptionGuard },
    { provide: APP_GUARD, useClass: PlanGuard },
  ],
})
export class AppModule implements NestModule, OnApplicationShutdown {
  constructor(private prisma: PrismaService) {}

  async onApplicationShutdown(signal?: string) {
    await this.prisma.$disconnect()
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CsrfMiddleware).forRoutes('*')
  }
}
