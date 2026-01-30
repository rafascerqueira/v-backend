import { Injectable, Logger } from "@nestjs/common";
import Stripe from "stripe";
import { PrismaService } from "@/shared/prisma/prisma.service";

@Injectable()
export class StripeService {
	private readonly logger = new Logger(StripeService.name);
	private stripe: Stripe | null = null;

	constructor(private readonly prisma: PrismaService) {
		this.initializeStripe();
	}

	private initializeStripe() {
		const secretKey = process.env.STRIPE_SECRET_KEY;

		if (!secretKey) {
			this.logger.warn("💳 Stripe not configured - payments disabled");
			return;
		}

		this.stripe = new Stripe(secretKey, {
			apiVersion: "2026-01-28.clover",
		});

		this.logger.log("💳 Stripe initialized");
	}

	isConfigured(): boolean {
		return this.stripe !== null;
	}

	async createCustomer(
		email: string,
		name: string,
		accountId: string,
	): Promise<string | null> {
		if (!this.stripe) return null;

		try {
			const customer = await this.stripe.customers.create({
				email,
				name,
				metadata: { account_id: accountId },
			});

			return customer.id;
		} catch (error) {
			this.logger.error("Failed to create Stripe customer", error);
			return null;
		}
	}

	async createCheckoutSession(
		accountId: string,
		priceId: string,
		successUrl: string,
		cancelUrl: string,
	): Promise<{ url: string | null; sessionId: string } | null> {
		if (!this.stripe) return null;

		try {
			const account = await this.prisma.account.findUnique({
				where: { id: accountId },
				select: { email: true, name: true },
			});

			if (!account) return null;

			const session = await this.stripe.checkout.sessions.create({
				mode: "subscription",
				payment_method_types: ["card"],
				line_items: [{ price: priceId, quantity: 1 }],
				success_url: successUrl,
				cancel_url: cancelUrl,
				customer_email: account.email,
				metadata: { account_id: accountId },
				subscription_data: {
					metadata: { account_id: accountId },
				},
			});

			return { url: session.url, sessionId: session.id };
		} catch (error) {
			this.logger.error("Failed to create checkout session", error);
			return null;
		}
	}

	async createPortalSession(
		customerId: string,
		returnUrl: string,
	): Promise<string | null> {
		if (!this.stripe) return null;

		try {
			const session = await this.stripe.billingPortal.sessions.create({
				customer: customerId,
				return_url: returnUrl,
			});

			return session.url;
		} catch (error) {
			this.logger.error("Failed to create portal session", error);
			return null;
		}
	}

	async cancelSubscription(subscriptionId: string): Promise<boolean> {
		if (!this.stripe) return false;

		try {
			await this.stripe.subscriptions.cancel(subscriptionId);
			return true;
		} catch (error) {
			this.logger.error("Failed to cancel subscription", error);
			return false;
		}
	}

	async getSubscription(
		subscriptionId: string,
	): Promise<Stripe.Subscription | null> {
		if (!this.stripe) return null;

		try {
			return await this.stripe.subscriptions.retrieve(subscriptionId);
		} catch (error) {
			this.logger.error("Failed to get subscription", error);
			return null;
		}
	}

	constructWebhookEvent(
		payload: Buffer,
		signature: string,
	): Stripe.Event | null {
		if (!this.stripe) return null;

		const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
		if (!webhookSecret) {
			this.logger.error("Stripe webhook secret not configured");
			return null;
		}

		try {
			return this.stripe.webhooks.constructEvent(
				payload,
				signature,
				webhookSecret,
			);
		} catch (error) {
			this.logger.error("Failed to construct webhook event", error);
			return null;
		}
	}

	async handleWebhookEvent(event: Stripe.Event): Promise<void> {
		this.logger.log(`📩 Stripe webhook: ${event.type}`);

		switch (event.type) {
			case "checkout.session.completed":
				await this.handleCheckoutCompleted(
					event.data.object as Stripe.Checkout.Session,
				);
				break;

			case "customer.subscription.created":
			case "customer.subscription.updated":
				await this.handleSubscriptionUpdated(
					event.data.object as Stripe.Subscription,
				);
				break;

			case "customer.subscription.deleted":
				await this.handleSubscriptionDeleted(
					event.data.object as Stripe.Subscription,
				);
				break;

			case "invoice.payment_succeeded":
				await this.handlePaymentSucceeded(event.data.object as Stripe.Invoice);
				break;

			case "invoice.payment_failed":
				await this.handlePaymentFailed(event.data.object as Stripe.Invoice);
				break;

			default:
				this.logger.log(`Unhandled event type: ${event.type}`);
		}
	}

	private async handleCheckoutCompleted(session: Stripe.Checkout.Session) {
		const accountId = session.metadata?.account_id;
		if (!accountId) return;

		const subscriptionId = session.subscription as string;
		const customerId = session.customer as string;

		await this.prisma.subscription.create({
			data: {
				account_id: accountId,
				payment_provider: "stripe",
				provider_subscription_id: subscriptionId,
				provider_customer_id: customerId,
				status: "active",
				plan_type: "pro",
				current_period_start: new Date(),
				current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
			},
		});

		await this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: "pro" },
		});

		this.logger.log(`✅ Subscription activated for account ${accountId}`);
	}

	private async handleSubscriptionUpdated(subscription: Stripe.Subscription) {
		const accountId = subscription.metadata?.account_id;
		if (!accountId) return;

		const status = this.mapStripeStatus(subscription.status) as any;
		const sub = subscription as any;

		await this.prisma.subscription.updateMany({
			where: { provider_subscription_id: subscription.id },
			data: {
				status,
				current_period_start: new Date(sub.current_period_start * 1000),
				current_period_end: new Date(sub.current_period_end * 1000),
			},
		});

		const planType = status === "active" ? "pro" : "free";
		await this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: planType },
		});
	}

	private async handleSubscriptionDeleted(subscription: Stripe.Subscription) {
		const accountId = subscription.metadata?.account_id;
		if (!accountId) return;

		await this.prisma.subscription.updateMany({
			where: { provider_subscription_id: subscription.id },
			data: { status: "canceled", canceled_at: new Date() },
		});

		await this.prisma.account.update({
			where: { id: accountId },
			data: { plan_type: "free" },
		});

		this.logger.log(`❌ Subscription canceled for account ${accountId}`);
	}

	private async handlePaymentSucceeded(invoice: Stripe.Invoice) {
		const subscriptionId = (invoice as any).subscription as string;
		if (!subscriptionId) return;

		await this.prisma.subscription.updateMany({
			where: { provider_subscription_id: subscriptionId },
			data: { status: "active" },
		});
	}

	private async handlePaymentFailed(invoice: Stripe.Invoice) {
		const subscriptionId = (invoice as any).subscription as string;
		if (!subscriptionId) return;

		await this.prisma.subscription.updateMany({
			where: { provider_subscription_id: subscriptionId },
			data: { status: "past_due" },
		});
	}

	private mapStripeStatus(status: Stripe.Subscription.Status): string {
		const statusMap: Record<string, string> = {
			active: "active",
			canceled: "canceled",
			incomplete: "past_due",
			incomplete_expired: "canceled",
			past_due: "past_due",
			trialing: "trialing",
			unpaid: "past_due",
			paused: "paused",
		};
		return statusMap[status] || "active";
	}
}
