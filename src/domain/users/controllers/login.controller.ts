import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common'
import { AccountService } from '../services/account.service'
import { z } from 'zod'

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
})

type LoginBodySchema = z.infer<typeof loginSchema>

@Controller('login')
export class LoginController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async handle(@Body() body: LoginBodySchema) {
    const { email, password } = loginSchema.parse(body)

    const account = await this.accountService.findByEmail(email)

    if (!account) {
      throw new UnauthorizedException('Invalid e-mail or password')
    }

    const isPasswordValid = this.accountService.verifyPassword(
      password,
      account.password,
      account.salt,
    )

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid e-mail or password')
    }

    return {
      ok: true,
    }
  }
}
