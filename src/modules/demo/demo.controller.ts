import { Body, Controller, Post, Get, Put, Param } from '@nestjs/common';
import { DemoService } from './demo.service';

@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post()
  async createDemoRequest(@Body() body: {
    nombre: string;
    empresa: string;
    correo: string;
    telefono?: string;
    mensaje?: string;
  }) {
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
