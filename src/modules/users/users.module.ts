import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ACCOUNT_REPOSITORY } from '@/shared/repositories/account.repository'
import { CreateAccountController } from './controllers/create-account.controller'
import { LoginController } from './controllers/login.controller'
import { PrismaAccountRepository } from './repositories/prisma-account.repository'
import { AccountService } from './services/account.service'

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
