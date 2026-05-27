import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ACTIVE_SUBSCRIPTION_KEY = 'requireActiveSubscription';
export const RequireActiveSubscription = () => SetMetadata(REQUIRE_ACTIVE_SUBSCRIPTION_KEY, true);
