import { Controller, Get, Post, Body, UseGuards, Req } from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger'
import { SkipOnboardingCheck } from '../../common/decorators/skip-onboarding.decorator'
import { OnboardingService } from './onboarding.service'
import { AuthGuard } from '../auth/auth.guard'
import { OnboardingCompletionDto } from './dto/onboarding-completion.dto'

@ApiTags('Onboarding')
@Controller('onboarding')
@SkipOnboardingCheck()
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @UseGuards(AuthGuard)
  @Get('status')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Obtener estado del onboarding del usuario actual' })
  @ApiResponse({ status: 200, description: 'Estado del onboarding (completado o no)' })
  async getOnboardingStatus(@Req() req: any) {
    const userId = req.authUser.sub
    return this.onboardingService.getStatus(userId)
  }

  @UseGuards(AuthGuard)
  @Post('complete')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Completar el onboarding con datos de la empresa' })
  @ApiResponse({ status: 201, description: 'Onboarding completado exitosamente' })
  async completeOnboarding(@Body() dto: OnboardingCompletionDto, @Req() req: any) {
    const userId = req.authUser.sub
    return this.onboardingService.complete(userId, dto)
  }
}
