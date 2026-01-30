import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
	SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PlanLimitsService } from '../services/plan-limits.service'

export const LIMIT_TYPE_KEY = 'limit_type'
export type LimitType = 'product' | 'customer' | 'order'

export const CheckPlanLimit = (type: LimitType) => SetMetadata(LIMIT_TYPE_KEY, type)

@Injectable()
export class PlanLimitsGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly planLimitsService: PlanLimitsService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const limitType = this.reflector.getAllAndOverride<LimitType>(LIMIT_TYPE_KEY, [
			context.getHandler(),
			context.getClass(),
		])

		if (!limitType) {
			return true
		}

		const request = context.switchToHttp().getRequest()
		const user = request.user

		if (!user) {
			return true
		}

		const sellerId = user.sub
		const planType = user.plan_type || 'free'

		let result

		switch (limitType) {
			case 'product':
				result = await this.planLimitsService.canCreateProduct(sellerId, planType)
				break
			case 'customer':
				result = await this.planLimitsService.canCreateCustomer(sellerId, planType)
				break
			case 'order':
				result = await this.planLimitsService.canCreateOrder(sellerId, planType)
				break
			default:
				return true
		}

		if (!result.allowed) {
			throw new ForbiddenException(result.message)
		}

		return true
	}
}
