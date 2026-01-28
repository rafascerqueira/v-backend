import { Injectable } from '@nestjs/common'
import type { PrismaService } from '@/shared/prisma/prisma.service'
import type {
	CreateCustomerData,
	Customer,
	CustomerRepository,
	UpdateCustomerData,
} from '@/shared/repositories/customer.repository'
import type { TenantContext } from '@/shared/tenant/tenant.context'

@Injectable()
export class PrismaCustomerRepository implements CustomerRepository {
	constructor(
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	private getTenantFilter() {
		if (this.tenantContext.isAdmin()) {
			return {}
		}
		return { seller_id: this.tenantContext.requireSellerId() }
	}

	async create(data: CreateCustomerData): Promise<Customer> {
		return this.prisma.customer.create({
			data: {
				seller_id: data.seller_id,
				name: data.name,
				email: data.email,
				phone: data.phone,
				document: data.document,
				address: data.address as any,
				city: data.city,
				state: data.state,
				zip_code: data.zip_code,
			},
		}) as unknown as Customer
	}

	async findById(id: string): Promise<Customer | null> {
		const customer = await this.prisma.customer.findUnique({
			where: { id },
		})
		if (!customer) return null
		if (!this.tenantContext.isAdmin() && customer.seller_id !== this.tenantContext.getSellerId()) {
			return null
		}
		return customer as unknown as Customer
	}

	async findByEmail(sellerId: string, email: string): Promise<Customer | null> {
		return this.prisma.customer.findUnique({
			where: { seller_id_email: { seller_id: sellerId, email } },
		}) as unknown as Customer | null
	}

	async findAll(sellerId?: string): Promise<Customer[]> {
		return this.prisma.customer.findMany({
			where: { ...this.getTenantFilter(), ...(sellerId && { seller_id: sellerId }) },
		}) as unknown as Customer[]
	}

	async findAllPaginated(params: {
		page: number
		limit: number
		search?: string
		status?: string
		sortBy?: string
		sortOrder?: 'asc' | 'desc'
	}): Promise<{ data: Customer[]; total: number }> {
		const { page, limit, search, status, sortBy = 'createdAt', sortOrder = 'desc' } = params
		const skip = (page - 1) * limit

		const where = {
			...this.getTenantFilter(),
			...(search && {
				OR: [
					{ name: { contains: search, mode: 'insensitive' as const } },
					{ email: { contains: search, mode: 'insensitive' as const } },
					{ phone: { contains: search, mode: 'insensitive' as const } },
					{ city: { contains: search, mode: 'insensitive' as const } },
				],
			}),
			...(status === 'active' && { active: true }),
			...(status === 'inactive' && { active: false }),
		}

		const [data, total] = await Promise.all([
			this.prisma.customer.findMany({
				where,
				skip,
				take: limit,
				orderBy: { [sortBy]: sortOrder },
			}),
			this.prisma.customer.count({ where }),
		])

		return { data: data as unknown as Customer[], total }
	}

	async update(id: string, data: UpdateCustomerData): Promise<Customer> {
		const customer = await this.findById(id)
		if (!customer) {
			throw new Error('Customer not found or access denied')
		}
		return this.prisma.customer.update({
			where: { id },
			data: {
				...data,
				address: data.address as any,
			},
		}) as unknown as Customer
	}

	async delete(id: string): Promise<Customer> {
		const customer = await this.findById(id)
		if (!customer) {
			throw new Error('Customer not found or access denied')
		}
		return this.prisma.customer.delete({
			where: { id },
		}) as unknown as Customer
	}
}
