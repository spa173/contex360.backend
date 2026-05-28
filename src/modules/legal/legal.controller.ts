import { Controller, Get, Header } from '@nestjs/common';
import { LegalService } from './legal.service';
import { Public } from '../auth/public.decorator';

@Controller('legal')
export class LegalController {
  constructor(private readonly legalService: LegalService) {}

  @Public()
  @Get('terms')
  getTerms() {
    return this.legalService.getTermsOfService();
  }

  @Public()
  @Get('privacy')
  getPrivacy() {
    return this.legalService.getPrivacyPolicy();
  }

  @Public()
  @Get('dpa')
  getDpa() {
    return this.legalService.getDataProcessingAgreement();
  }

  @Public()
  @Get('business-continuity-plan')
  getBcp() {
    return this.legalService.getBusinessContinuityPlan();
  }
}
