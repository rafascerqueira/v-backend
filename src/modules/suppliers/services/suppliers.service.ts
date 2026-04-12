import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import {
	SUPPLIER_REPOSITORY,
	type SupplierRepository,
} from '@/shared/repositories/supplier.repository'
import type { CreateDebtDto, PayDebtDto } from '../dto/create-debt.dto'
import type { CreateSupplierDto } from '../dto/create-supplier.dto'

@Injectable()
export class SuppliersService {
	constructor(
		@Inject(SUPPLIER_REPOSITORY)
		private readonly repo: SupplierRepository,
	) {}

	findAll() {
		return this.repo.findAll()
	}

	async findOne(id: string) {
		const supplier = await this.repo.findById(id)
		if (!supplier) throw new NotFoundException('Supplier not found')
		return supplier
	}

	create(data: CreateSupplierDto & { seller_id: string }) {
		return this.repo.create(data)
	}

	async update(id: string, data: Partial<CreateSupplierDto>) {
		await this.findOne(id)
		return this.repo.update(id, data)
	}

	async remove(id: string) {
		await this.findOne(id)
		return this.repo.delete(id)
	}

	findDebts(supplierId: string) {
		return this.repo.findDebts(supplierId)
	}

	async createDebt(supplierId: string, data: CreateDebtDto) {
		await this.findOne(supplierId)
		return this.repo.createDebt(supplierId, data)
	}

	async payDebt(debtId: number, data: PayDebtDto) {
		return this.repo.payDebt(debtId, data.amount)
	}
}
