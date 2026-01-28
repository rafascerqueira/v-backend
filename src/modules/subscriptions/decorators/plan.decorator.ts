import { SetMetadata } from '@nestjs/common'
import type { PlanFeatures, PlanType } from '../constants/plan-limits'

export const REQUIRED_PLAN_KEY = 'required_plan'
export const REQUIRED_FEATURE_KEY = 'required_feature'
export const CHECK_LIMIT_KEY = 'check_limit'

export type LimitType = 'products' | 'orders' | 'customers'

export const RequiredPlan = (...plans: PlanType[]) => SetMetadata(REQUIRED_PLAN_KEY, plans)

export const RequiredFeature = (feature: PlanFeatures) => SetMetadata(REQUIRED_FEATURE_KEY, feature)

export const CheckLimit = (limitType: LimitType) => SetMetadata(CHECK_LIMIT_KEY, limitType)
