import { Module, Global, forwardRef } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { TokenService } from './services/token.service'
import { TokenBlacklistService } from './services/token-blacklist.service'
import { PasswordResetService } from './services/password-reset.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { RefreshTokenController } from './controllers/refresh-token.controller'
import { LogoutController } from './controllers/logout.controller'
import { MeController } from './controllers/me.controller'
import { ProfileController } from './controllers/profile.controller'
import { ForgotPasswordController } from './controllers/forgot-password.controller'
import { ResetPasswordController } from './controllers/reset-password.controller'
import { TwoFactorController } from './controllers/two-factor.controller'
import { TwoFactorService } from './services/two-factor.service'
import { UsersModule } from '@/modules/users/users.module'

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
	providers: [TokenService, TokenBlacklistService, JwtAuthGuard, PasswordResetService, TwoFactorService],
	exports: [TokenService, TokenBlacklistService, JwtAuthGuard],
})
export class AuthModule {}
