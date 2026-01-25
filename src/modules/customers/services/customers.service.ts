import { Injectable, Inject, NotFoundException, ConflictException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import {
	CUSTOMER_REPOSITORY,
	type CustomerRepository,
	type CreateCustomerData,
} from '@/shared/repositories/customer.repository'
import type { CreateCustomerDto } from '../dto/create-customer.dto'
import type { PaginationDto } from '@/shared/dto/pagination.dto'
import { createPaginatedResponse } from '@/shared/dto/pagination.dto'

@Injectable()
export class CustomersService {
	constructor(
		@Inject(CUSTOMER_REPOSITORY)
		private readonly customerRepository: CustomerRepository,
	) {}

	async create(data: CreateCustomerData) {
		try {
			return await this.customerRepository.create(data)
		} catch (error) {
			if (error instanceof Prisma.PrismaClientKnownRequestError) {
				if (error.code === 'P2002') {
					const target = error.meta?.target as string[] | undefined
					if (target?.includes('email')) {
						throw new ConflictException('Email already exists')
					}
					if (target?.includes('phone')) {
						throw new ConflictException('Phone already exists')
					}
					throw new ConflictException('Duplicate field value')
				}
			}
			throw error
		}
	}

	async findAll() {
		return this.customerRepository.findAll()
	}

	async findAllPaginated(params: PaginationDto) {
		const { data, total } = await (this.customerRepository as any).findAllPaginated(params)
		return createPaginatedResponse(data, total, params.page, params.limit)
	}

	async findOne(id: string) {
		const customer = await this.customerRepository.findById(id)

		if (!customer) {
			throw new NotFoundException('Customer not found')
		}

		return customer
	}

	async update(id: string, data: Partial<CreateCustomerDto>) {
		return this.customerRepository.update(id, data)
	}

	async remove(id: string) {
		return this.customerRepository.delete(id)
	}
}
