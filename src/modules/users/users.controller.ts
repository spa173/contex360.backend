import { Controller, Post, Body, UseGuards } from '@nestjs/common'
import { UsersService, CreateUserDto } from './users.service'
import { AuthGuard } from '../auth/auth.guard'

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async createUser(@Body() dto: CreateUserDto) {
    const result = await this.usersService.createUser(dto)
    return { ok: true, message: 'Usuario creado exitosamente', user: result.user, tempPassword: result.tempPassword }
  }
}
