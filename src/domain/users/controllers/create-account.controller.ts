import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common'
import { z } from 'zod'
import { AccountService } from '../services/account.service'

const createAccountSchema = z.object({
  name: z.string(),
  email: z.string().email(),
  password: z.string().min(6),
})

type CreateAccountBodySchema = z.infer<typeof createAccountSchema>

@Controller('create-account')
export class CreateAccountController {
  constructor(private readonly accountService: AccountService) {}

  @Post()
  async handle(@Body() body: CreateAccountBodySchema) {
    const { name, email, password } = createAccountSchema.parse(body)

    const account = await this.accountService.findByEmail(email)

    if (account) {
      throw new HttpException('Account already exists', HttpStatus.BAD_REQUEST)
    }

    await this.accountService.create({
      name,
      email,
      password,
    })
  }
}
