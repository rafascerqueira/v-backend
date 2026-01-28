import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { TenantContext } from "@/shared/tenant/tenant.context";
import type { CreateBillingDto } from "../dto/create-billing.dto";
import type { UpdateBillingDto } from "../dto/update-billing.dto";

@Injectable()
export class BillingsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {};
		}
		return { order: { seller_id: this.tenantContext.requireSellerId() } };
	}

	async findAll() {
		return this.prisma.billing.findMany({
			where: this.getTenantFilter() as any,
			orderBy: { createdAt: "desc" },
			include: {
				order: {
					select: {
						id: true,
						order_number: true,
						customer: {
							select: {
								id: true,
								name: true,
							},
						},
					},
				},
			},
		});
	}

	async listByOrder(orderId: number) {
		return this.prisma.billing.findMany({
			where: { order_id: orderId, ...(this.getTenantFilter() as any) },
		});
	}

	async create(orderId: number, dto: CreateBillingDto) {
		// Verify order belongs to tenant
		const order = await this.prisma.order.findUnique({
			where: { id: orderId },
		});
		if (!order) {
			throw new Error("Order not found");
		}
		if (
			!this.tenantContext.isAdmin() &&
			order.seller_id !== this.tenantContext.getSellerId()
		) {
			throw new Error("Access denied");
		}
		const { due_date, payment_date, ...rest } = dto;
		return this.prisma.billing.create({
			data: {
				order_id: orderId,
				...rest,
				due_date: due_date ? new Date(due_date) : undefined,
				payment_date: payment_date ? new Date(payment_date) : undefined,
			},
		});
	}

	async update(id: number, dto: UpdateBillingDto) {
		const billing = await this.prisma.billing.findUnique({
			where: { id },
			include: { order: { select: { seller_id: true } } },
		});
		if (!billing) {
			throw new Error("Billing not found");
		}
		if (
			!this.tenantContext.isAdmin() &&
			billing.order.seller_id !== this.tenantContext.getSellerId()
		) {
			throw new Error("Access denied");
		}
		const { due_date, payment_date, ...rest } = dto;
		return this.prisma.billing.update({
			where: { id },
			data: {
				...rest,
				due_date: due_date ? new Date(due_date) : undefined,
				payment_date: payment_date ? new Date(payment_date) : undefined,
			},
		});
	}
}
