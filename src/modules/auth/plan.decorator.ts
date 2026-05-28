import { SetMetadata } from '@nestjs/common'

export const PLAN_MODULE_KEY = 'plan_module'
export const PLAN_LIMIT_KEY = 'plan_limit'

export const RequirePlanModule = (moduleId: string) => SetMetadata(PLAN_MODULE_KEY, moduleId)
export const CheckPlanLimit = (limit: 'maxInvoicesPerMonth' | 'maxUsers' | 'maxAiQueriesPerMonth' | 'maxOcrRunsPerMonth' | 'maxEmailsPerMonth') => SetMetadata(PLAN_LIMIT_KEY, limit)
