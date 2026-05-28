import { SetMetadata } from '@nestjs/common'

export const REQUIRES_ONBOARDING_KEY = 'requiresOnboarding'
export const RequiresOnboarding = () => SetMetadata(REQUIRES_ONBOARDING_KEY, true)
