import { Module } from '@nestjs/common'
import { LoginController } from './controllers/login.controller'
import { CreateAccountController } from './controllers/create-account.controller'
import { AccountService } from './services/account.service'
import { PrismaService } from 'src/infrastructure/prisma/prisma.service'

@Module({
  imports: [],
  controllers: [LoginController, CreateAccountController],
  providers: [AccountService, PrismaService],
  exports: [],
})
export class UsersModule {}
