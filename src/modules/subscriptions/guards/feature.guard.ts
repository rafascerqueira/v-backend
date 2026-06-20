import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { PlanFeatures } from '../constants/plan-limits'
import { PlanLimitsService } from '../services/plan-limits.service'

export const REQUIRED_FEATURE_KEY = 'required_feature'

/** Gates a route behind a plan feature flag (PLAN_LIMITS[plan].features). */
export const RequiredFeature = (feature: PlanFeatures) => SetMetadata(REQUIRED_FEATURE_KEY, feature)

/** pt-BR upgrade prompts surfaced as the 403 message for each gated feature. */
export const FEATURE_UPGRADE_MESSAGE: Record<PlanFeatures, string> = {
	reports: 'Relatórios estão disponíveis no plano Pro. Faça upgrade para acessar.',
	exportData: 'A exportação de dados está disponível no plano Pro. Faça upgrade para acessar.',
	multipleImages:
		'Adicionar várias imagens por produto está disponível no plano Pro. Faça upgrade para acessar.',
	customBranding:
		'A personalização da loja está disponível no plano Empresarial. Faça upgrade para acessar.',
	prioritySupport: 'Suporte prioritário está disponível em planos pagos.',
	apiAccess: 'O acesso à API está disponível no plano Empresarial.',
}

@Injectable()
export class FeatureGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly planLimitsService: PlanLimitsService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const feature = this.reflector.getAllAndOverride<PlanFeatures>(REQUIRED_FEATURE_KEY, [
			context.getHandler(),
			context.getClass(),
		])

		// No @RequiredFeature on this route → nothing to gate.
		if (!feature) {
			return true
		}

		const request = context.switchToHttp().getRequest()
		const user = request.user

		// Unauthenticated requests are handled by JwtAuthGuard; admins bypass plan gates.
		if (!user || user.role === 'admin') {
			return true
		}

		const allowed = await this.planLimitsService.hasFeature(
			user.sub,
			user.plan_type || 'free',
			feature,
		)

		if (!allowed) {
			throw new ForbiddenException(FEATURE_UPGRADE_MESSAGE[feature])
		}

		return true
	}
}
