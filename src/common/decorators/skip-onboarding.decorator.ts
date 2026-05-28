import { SetMetadata } from '@nestjs/common'

export const SKIP_ONBOARDING_CHECK = 'skipOnboardingCheck'
export const SkipOnboardingCheck = () => SetMetadata(SKIP_ONBOARDING_CHECK, true)
