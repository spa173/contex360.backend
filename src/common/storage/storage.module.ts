import { Module, Global } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { STORAGE_PROVIDER } from './storage.interface'
import { LocalStorageProvider } from './local-storage.provider'
import { R2StorageProvider } from './r2-storage.provider'

/**
 * StorageModule — globally available.
 * Injects LocalStorageProvider in development (no R2_ENDPOINT configured)
 * and R2StorageProvider in production (R2_ENDPOINT is set).
 *
 * Inject by token: @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    LocalStorageProvider,
    R2StorageProvider,
    {
      provide: STORAGE_PROVIDER,
      inject: [ConfigService, LocalStorageProvider, R2StorageProvider],
      useFactory: (
        config: ConfigService,
        local: LocalStorageProvider,
        r2: R2StorageProvider,
      ) => {
        const hasR2 = !!(
          config.get('R2_ENDPOINT') &&
          config.get('R2_ACCESS_KEY_ID') &&
          config.get('R2_SECRET_ACCESS_KEY') &&
          config.get('R2_BUCKET')
        )
        return hasR2 ? r2 : local
      },
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
