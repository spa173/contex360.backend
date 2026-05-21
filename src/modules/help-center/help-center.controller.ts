import { Controller, Get, UseGuards } from '@nestjs/common';
import { HelpCenterService } from './help-center.service';
import { AuthGuard } from '../auth/auth.guard';

@Controller('help-center')
@UseGuards(AuthGuard)
export class HelpCenterController {
  constructor(private readonly helpCenterService: HelpCenterService) {}

  @Get('categories')
  getCategories() {
    return this.helpCenterService.getCategories();
  }

  @Get('articles')
  getArticles() {
    return this.helpCenterService.getArticles();
  }

  @Get('faqs')
  getFaqs() {
    return this.helpCenterService.getFaqs();
  }
}
