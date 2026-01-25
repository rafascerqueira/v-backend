import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { LoginController } from './controllers/login.controller'
import { CreateAccountController } from './controllers/create-account.controller'
import { AccountService } from './services/account.service'
import { PrismaAccountRepository } from './repositories/prisma-account.repository'
import { ACCOUNT_REPOSITORY } from '@/shared/repositories/account.repository'

@Module({
	imports: [PrismaModule],
	controllers: [LoginController, CreateAccountController],
	providers: [
		AccountService,
		{
			provide: ACCOUNT_REPOSITORY,
			useClass: PrismaAccountRepository,
		},
	],
	exports: [AccountService],
})
export class UsersModule {}
