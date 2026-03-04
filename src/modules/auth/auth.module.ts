import { forwardRef, Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { UsersModule } from '@/modules/users/users.module'
import { EMAIL_VERIFICATION_REPOSITORY } from '@/shared/repositories/email-verification.repository'
import { PASSWORD_RESET_REPOSITORY } from '@/shared/repositories/password-reset.repository'
import { TWO_FACTOR_REPOSITORY } from '@/shared/repositories/two-factor.repository'
import { EmailVerificationController } from './controllers/email-verification.controller'
import { ForgotPasswordController } from './controllers/forgot-password.controller'
import { LogoutController } from './controllers/logout.controller'
import { MeController } from './controllers/me.controller'
import { ProfileController } from './controllers/profile.controller'
import { RefreshTokenController } from './controllers/refresh-token.controller'
import { ResetPasswordController } from './controllers/reset-password.controller'
import { TwoFactorController } from './controllers/two-factor.controller'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { PrismaEmailVerificationRepository } from './repositories/prisma-email-verification.repository'
import { PrismaPasswordResetRepository } from './repositories/prisma-password-reset.repository'
import { PrismaTwoFactorRepository } from './repositories/prisma-two-factor.repository'
import { EmailVerificationService } from './services/email-verification.service'
import { PasswordResetService } from './services/password-reset.service'
import { TokenService } from './services/token.service'
import { TokenBlacklistService } from './services/token-blacklist.service'
import { TwoFactorService } from './services/two-factor.service'

@Global()
@Module({
	imports: [
		JwtModule.register({
			global: true,
		}),
		forwardRef(() => UsersModule),
	],
	controllers: [
		RefreshTokenController,
		LogoutController,
		MeController,
		ProfileController,
		ForgotPasswordController,
		ResetPasswordController,
		TwoFactorController,
		EmailVerificationController,
	],
	providers: [
		TokenService,
		TokenBlacklistService,
		JwtAuthGuard,
		PasswordResetService,
		TwoFactorService,
		EmailVerificationService,
		{
			provide: EMAIL_VERIFICATION_REPOSITORY,
			useClass: PrismaEmailVerificationRepository,
		},
		{
			provide: PASSWORD_RESET_REPOSITORY,
			useClass: PrismaPasswordResetRepository,
		},
		{
			provide: TWO_FACTOR_REPOSITORY,
			useClass: PrismaTwoFactorRepository,
		},
	],
	exports: [
		TokenService,
		TokenBlacklistService,
		JwtAuthGuard,
		EmailVerificationService,
		TwoFactorService,
	],
})
export class AuthModule {}
