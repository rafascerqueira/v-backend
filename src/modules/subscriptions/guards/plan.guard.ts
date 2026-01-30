import {
	type CanActivate,
	type ExecutionContext,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { PlanFeatures, PlanType } from "../constants/plan-limits";
import { PLAN_NAMES } from "../constants/plan-limits";
import {
	CHECK_LIMIT_KEY,
	type LimitType,
	REQUIRED_FEATURE_KEY,
	REQUIRED_PLAN_KEY,
} from "../decorators/plan.decorator";
import { SubscriptionService } from "../services/subscription.service";

@Injectable()
export class PlanGuard implements CanActivate {
	constructor(
		private reflector: Reflector,
		private subscriptionService: SubscriptionService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest();
		const userId = request.user?.sub;

		if (!userId) {
			throw new ForbiddenException("Usuário não autenticado");
		}

		// Check required plan
		const requiredPlans = this.reflector.getAllAndOverride<PlanType[]>(
			REQUIRED_PLAN_KEY,
			[context.getHandler(), context.getClass()],
		);

		if (requiredPlans?.length) {
			const userPlan = await this.subscriptionService.getAccountPlan(userId);
			if (!requiredPlans.includes(userPlan)) {
				const planNames = requiredPlans.map((p) => PLAN_NAMES[p]).join(" ou ");
				throw new ForbiddenException(
					`Este recurso requer o plano ${planNames}. Faça upgrade para continuar.`,
				);
			}
		}

		// Check required feature
		const requiredFeature = this.reflector.getAllAndOverride<PlanFeatures>(
			REQUIRED_FEATURE_KEY,
			[context.getHandler(), context.getClass()],
		);

		if (requiredFeature) {
			const hasFeature = await this.subscriptionService.hasFeature(
				userId,
				requiredFeature,
			);
			if (!hasFeature) {
				throw new ForbiddenException(
					`Este recurso não está disponível no seu plano atual. Faça upgrade para desbloquear.`,
				);
			}
		}

		// Check usage limit
		const checkLimit = this.reflector.getAllAndOverride<LimitType>(
			CHECK_LIMIT_KEY,
			[context.getHandler(), context.getClass()],
		);

		if (checkLimit) {
			const limitCheck = await this.subscriptionService.checkLimit(
				userId,
				checkLimit,
			);

			if (!limitCheck.allowed) {
				const limitMessages = {
					products: `Você atingiu o limite de ${limitCheck.limit} produtos no seu plano. Faça upgrade para cadastrar mais produtos.`,
					orders: `Você atingiu o limite de ${limitCheck.limit} vendas este mês. Faça upgrade para continuar vendendo.`,
					customers: `Você atingiu o limite de ${limitCheck.limit} clientes no seu plano. Faça upgrade para cadastrar mais clientes.`,
				};
				throw new ForbiddenException(limitMessages[checkLimit]);
			}

			// Attach limit info to request for controller use
			request.limitInfo = limitCheck;
		}

		return true;
	}
}
