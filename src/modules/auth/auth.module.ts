import { forwardRef, Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { UsersModule } from '@/modules/users/users.module'
import { ForgotPasswordController } from './controllers/forgot-password.controller'
import { LogoutController } from './controllers/logout.controller'
import { MeController } from './controllers/me.controller'
import { ProfileController } from './controllers/profile.controller'
import { RefreshTokenController } from './controllers/refresh-token.controller'
import { ResetPasswordController } from './controllers/reset-password.controller'
import { TwoFactorController } from './controllers/two-factor.controller'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
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
	],
	providers: [
		TokenService,
		TokenBlacklistService,
		JwtAuthGuard,
		PasswordResetService,
		TwoFactorService,
	],
	exports: [TokenService, TokenBlacklistService, JwtAuthGuard],
})
export class AuthModule {}
