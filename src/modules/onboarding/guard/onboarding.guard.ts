import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { OnboardingService } from '../onboarding.service'
import { SKIP_ONBOARDING_CHECK } from '../../../common/decorators/skip-onboarding.decorator'

@Injectable()
export class OnboardingGuard implements CanActivate {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_ONBOARDING_CHECK, [
      context.getHandler(),
      context.getClass(),
    ])
    if (skip) return true

    const request = context.switchToHttp().getRequest()
    const authUser = request.authUser as any

    // If not authenticated, let the controller-level AuthGuard handle it
    if (!authUser) return true

    try {
      const status = await this.onboardingService.getStatus(authUser.sub)
      if (!status.completed) {
        throw new ForbiddenException({
          message: 'Onboarding not completed',
          onboardingRequired: true,
        })
      }
    } catch (error) {
      if (error instanceof ForbiddenException) throw error
      throw new ForbiddenException({
        message: 'Onboarding not completed',
        onboardingRequired: true,
      })
    }

    return true
  }
}
