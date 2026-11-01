import {
	BadRequestException,
	ConflictException,
	HttpException,
	Inject,
	Injectable,
	InternalServerErrorException,
	Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type Stripe from 'stripe'
import { RedisService } from '@/shared/redis/redis.service'
import {
	SUBSCRIPTION_REPOSITORY,
	type SubscriptionRepository,
} from '@/shared/repositories/subscription.repository'
import type { PaidPlanType } from '../constants/plan-limits'
import { StripeService } from './stripe.service'
import { SubscriptionService } from './subscription.service'

/**
 * How long one checkout attempt may hold the per-account lock. Comfortably above the
 * handful of bounded Stripe calls it makes (20s timeout, 1 retry each); ownership is
 * re-checked after the session is created anyway.
 */
export const CHECKOUT_LOCK_TTL_MS = 60_000

/**
 * A younger `incomplete` subscription may be a payment still in progress (e.g. 3-D
 * Secure): don't cancel it under the buyer, ask them to wait instead.
 */
export const INCOMPLETE_GRACE_MS = 10 * 60 * 1000

/**
 * Live Stripe statuses that mean "this account already has a subscription": the way
 * forward is the Billing Portal (pay the open invoice, switch plan, reactivate), never
 * a second checkout. `incomplete` is deliberately absent (handled separately).
 */
const BLOCKING_STATUSES: ReadonlySet<Stripe.Subscription.Status> = new Set([
	'active',
	'trialing',
	'past_due',
	'unpaid',
	'paused',
])

export const CHECKOUT_ERROR_CODES = {
	subscriptionExists: 'SUBSCRIPTION_EXISTS',
	inProgress: 'CHECKOUT_IN_PROGRESS',
} as const

function subscriptionExists(): ConflictException {
	return new ConflictException({
		message:
			'Você já tem uma assinatura. Use "Gerenciar assinatura" para trocar de plano ou atualizar o pagamento.',
		error: 'Conflict',
		code: CHECKOUT_ERROR_CODES.subscriptionExists,
	})
}

function checkoutInProgress(): ConflictException {
	return new ConflictException({
		message: 'Já existe um pagamento sendo iniciado. Aguarde alguns segundos.',
		error: 'Conflict',
		code: CHECKOUT_ERROR_CODES.inProgress,
	})
}

/**
 * Opens a Stripe Checkout session while guaranteeing at most one paid subscription per
 * account (AUDIT-001). The guarantees come from Stripe's live state, not from local rows
 * that only exist once a webhook has landed:
 *   1. per-account lock (double click / two tabs racing);
 *   2. fast local check (rows we already know about);
 *   3. one Stripe Customer per account;
 *   4. older open sessions expired FIRST, so one paid in the meantime shows up in…
 *   5. …the live check of the Customer's (and legacy Customers') subscriptions;
 *      never-paid `incomplete` attempts are canceled (recent ones → wait);
 *   6. short-lived session, then lock ownership re-checked.
 * Any Stripe failure fails CLOSED (no session) rather than risk double billing.
 */
@Injectable()
export class CheckoutService {
	private readonly logger = new Logger(CheckoutService.name)

	constructor(
		private readonly subscriptionService: SubscriptionService,
		private readonly stripeService: StripeService,
		private readonly redisService: RedisService,
		private readonly configService: ConfigService,
		@Inject(SUBSCRIPTION_REPOSITORY)
		private readonly subscriptionRepository: SubscriptionRepository,
	) {}

	async startCheckout(accountId: string, planId: PaidPlanType): Promise<{ url: string }> {
		const priceId = this.configService.get<string>(`stripe.priceIds.${planId}`)
		if (!priceId || !this.stripeService.isConfigured()) {
			throw new BadRequestException('Plano inválido ou pagamento não configurado')
		}

		const lockKey = `checkout-lock:${accountId}`
		const token = await this.redisService.acquireLock(lockKey, CHECKOUT_LOCK_TTL_MS)
		if (!token) throw checkoutInProgress()

		try {
			if (await this.subscriptionService.hasBlockingSubscription(accountId)) {
				throw subscriptionExists()
			}

			const url = await this.openSession(accountId, planId, priceId, lockKey, token)
			if (!url) {
				throw new InternalServerErrorException('Falha ao criar sessão de pagamento')
			}
			return { url }
		} finally {
			await this.redisService.releaseLock(lockKey, token).catch((error) => {
				// The TTL frees it anyway; never mask the request's own outcome.
				this.logger.warn(`Failed to release ${lockKey}: ${String(error)}`)
			})
		}
	}

	private async openSession(
		accountId: string,
		planId: PaidPlanType,
		priceId: string,
		lockKey: string,
		token: string,
	): Promise<string | null> {
		try {
			const customerId = await this.stripeService.getOrCreateCustomer(accountId)
			const legacyCustomerIds = await this.subscriptionRepository.findProviderCustomerIds(accountId)

			// Expire older open sessions BEFORE the live check: a session paid in between
			// is then no longer open but its subscription shows up below, instead of being
			// missed by both steps.
			await this.stripeService.expireOpenCheckoutSessions(customerId)

			const live = await this.stripeService.listLiveSubscriptions([
				customerId,
				...legacyCustomerIds,
			])
			if (live.some((sub) => BLOCKING_STATUSES.has(sub.status))) {
				throw subscriptionExists()
			}
			await this.clearIncompleteAttempts(accountId, live)

			const frontendUrl = this.configService.get<string>('frontendUrl')
			const session = await this.stripeService.createCheckoutSession(
				accountId,
				customerId,
				priceId,
				`${frontendUrl}/plans?checkout=success`,
				`${frontendUrl}/plans?checkout=canceled`,
				planId,
				token,
			)
			if (!session) return null

			// If a slow Stripe call outlived the lock, another attempt may have opened its
			// own session meanwhile: withdraw ours rather than leave two payable sessions.
			if (!(await this.redisService.isLockHeld(lockKey, token))) {
				await this.stripeService.expireCheckoutSession(session.sessionId)
				this.logger.warn(
					`Checkout lock for account ${accountId} expired mid-flight; session withdrawn`,
				)
				throw checkoutInProgress()
			}

			return session.url
		} catch (error) {
			if (error instanceof HttpException) throw error
			this.logger.error(
				`Checkout aborted for account ${accountId}`,
				error instanceof Error ? error.stack : String(error),
			)
			throw new InternalServerErrorException('Falha ao iniciar pagamento. Tente novamente.')
		}
	}

	/**
	 * Never-paid `incomplete` attempts are canceled so they can't be paid later next to
	 * the new subscription. A recent one may still be completing (3-D Secure) → 409 "wait".
	 * Only this account's own attempts are touched.
	 */
	private async clearIncompleteAttempts(accountId: string, live: Stripe.Subscription[]) {
		const now = Date.now()
		for (const sub of live) {
			if (sub.status !== 'incomplete') continue

			if (sub.metadata?.account_id !== accountId) {
				this.logger.warn(
					`Incomplete subscription ${sub.id} on account ${accountId}'s Customer belongs to another account; left untouched`,
				)
				continue
			}
			if (now - sub.created * 1000 < INCOMPLETE_GRACE_MS) {
				throw checkoutInProgress()
			}

			await this.stripeService.cancelSubscription(sub.id)
			this.logger.log(`Canceled incomplete subscription ${sub.id} before a new checkout`)
		}
	}
}
