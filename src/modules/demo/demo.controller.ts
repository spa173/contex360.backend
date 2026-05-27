import { Body, Controller, Post, Get, Put, Param } from '@nestjs/common';
import { DemoService } from './demo.service';
import { CreateDemoRequestDto } from './demo.dto';

@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post()
  async createDemoRequest(@Body() body: CreateDemoRequestDto) {
    return this.demoService.createDemoRequest(body);
  }

  @Get()
  async getAllDemoRequests() {
    return this.demoService.getAllDemoRequests();
  }

  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('estado') estado: string) {
    return this.demoService.updateDemoRequestStatus(id, estado);
  }

  @Post(':id/convert')
  async convertToCustomer(@Param('id') id: string) {
    return this.demoService.convertToCustomer(id);
  }
}
