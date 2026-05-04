import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { ACCOUNT_EXCEPTION_REPOSITORY } from '@/shared/repositories/account-exception.repository'
import { AccountExceptionController } from './controllers/account-exception.controller'
import { PrismaAccountExceptionRepository } from './repositories/prisma-account-exception.repository'
import { AccountExceptionService } from './services/account-exception.service'

@Global()
@Module({
	imports: [PrismaModule],
	controllers: [AccountExceptionController],
	providers: [
		AccountExceptionService,
		{
			provide: ACCOUNT_EXCEPTION_REPOSITORY,
			useClass: PrismaAccountExceptionRepository,
		},
	],
	exports: [AccountExceptionService],
})
export class AccountExceptionsModule {}
