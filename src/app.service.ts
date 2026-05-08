import { Injectable } from '@nestjs/common'

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'Contex360 Backend',
      status: 'ok',
      message: 'Backend scaffold ready.',
      endpoints: {
        health: '/health',
        docs: '/docs',
      },
    }
  }
}

