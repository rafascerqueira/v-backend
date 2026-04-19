import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateDebtData,
	CreateSupplierData,
	Supplier,
	SupplierDebt,
	SupplierRepository,
	UpdateSupplierData,
} from '@/shared/repositories/supplier.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { parseLocalDate } from '@/shared/utils/date'

@Injectable()
export class PrismaSupplierRepository implements SupplierRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) return {}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	async findAll(): Promise<Supplier[]> {
		const rows = await this.prisma.supplier.findMany({
			where: { active: true, ...this.getTenantFilter() },
			include: {
				debts: { select: { amount: true, paid_amount: true } },
			},
			orderBy: { createdAt: 'desc' },
		})

		return rows.map((s) => ({
			...s,
			total_debt: s.debts.reduce((acc, d) => acc + d.amount, 0),
			total_paid: s.debts.reduce((acc, d) => acc + d.paid_amount, 0),
		})) as unknown as Supplier[]
	}

	async findById(id: string): Promise<Supplier | null> {
		const row = await this.prisma.supplier.findFirst({
			where: { id, active: true, ...this.getTenantFilter() },
			include: {
				debts: { select: { amount: true, paid_amount: true } },
			},
		})
		if (!row) return null
		return {
			...row,
			total_debt: row.debts.reduce((acc, d) => acc + d.amount, 0),
			total_paid: row.debts.reduce((acc, d) => acc + d.paid_amount, 0),
		} as unknown as Supplier
	}

	async create(data: CreateSupplierData): Promise<Supplier> {
		const row = await this.prisma.supplier.create({
			data: {
				seller_id: data.seller_id,
				name: data.name,
				email: data.email,
				phone: data.phone,
				address: data.address,
				notes: data.notes,
			},
		})
		return { ...row, total_debt: 0, total_paid: 0 } as unknown as Supplier
	}

	async update(id: string, data: UpdateSupplierData): Promise<Supplier> {
		const row = await this.prisma.supplier.update({
			where: { id },
			data,
			include: {
				debts: { select: { amount: true, paid_amount: true } },
			},
		})
		return {
			...row,
			total_debt: row.debts.reduce((acc, d) => acc + d.amount, 0),
			total_paid: row.debts.reduce((acc, d) => acc + d.paid_amount, 0),
		} as unknown as Supplier
	}

	async delete(id: string): Promise<void> {
		await this.prisma.supplier.update({ where: { id }, data: { active: false } })
	}

	async findDebts(supplierId: string): Promise<SupplierDebt[]> {
		return this.prisma.supplier_debt.findMany({
			where: { supplier_id: supplierId },
			orderBy: { createdAt: 'desc' },
		}) as unknown as SupplierDebt[]
	}

	async createDebt(supplierId: string, data: CreateDebtData): Promise<SupplierDebt> {
		return this.prisma.supplier_debt.create({
			data: {
				supplier_id: supplierId,
				amount: data.amount,
				description: data.description,
				due_date: data.due_date ? parseLocalDate(data.due_date) : undefined,
			},
		}) as unknown as SupplierDebt
	}

	async payDebt(debtId: number, amount: number): Promise<SupplierDebt> {
		const debt = await this.prisma.supplier_debt.findUniqueOrThrow({ where: { id: debtId } })
		const newPaid = debt.paid_amount + amount
		const newStatus = newPaid >= debt.amount ? 'paid' : 'partial'

		return this.prisma.supplier_debt.update({
			where: { id: debtId },
			data: { paid_amount: newPaid, status: newStatus },
		}) as unknown as SupplierDebt
	}
}
