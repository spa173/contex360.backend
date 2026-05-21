import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class HelpCenterService {
  constructor(private readonly prisma: PrismaService) {}

  async getCategories() {
    return this.prisma.helpCategory.findMany({
      orderBy: { createdAt: 'asc' },
    });
  }

  async getArticles() {
    return this.prisma.helpArticle.findMany({
      include: { category: true },
      orderBy: { id: 'asc' },
    });
  }

  async getFaqs() {
    return this.prisma.helpFaq.findMany({
      orderBy: { id: 'asc' },
    });
  }
}
