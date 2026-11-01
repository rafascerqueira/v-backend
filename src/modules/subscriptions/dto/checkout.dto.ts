import { z } from 'zod'
import { PAID_PLANS } from '../constants/plan-limits'

// planId is also used as a config path (`stripe.priceIds.<planId>`), and ConfigService
// resolves paths with lodash `get`, so '[pro]' would still find the Pro price. Only the
// exact paid tier names may pass.
export const checkoutSchema = z.object({
	planId: z.enum(PAID_PLANS, { message: 'Plano inválido' }),
})

export type CheckoutDto = z.infer<typeof checkoutSchema>
