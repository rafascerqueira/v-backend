/**
 * ListProductsController unit tests
 * Covers: GET /products (paginated list with filters), GET /products/:id
 * Guards mocked: JwtAuthGuard
 */

import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { ProductService } from '../services/product.service'
import { ListProductsController } from './list-products.controller'

const serviceMock = {
	findAllPaginated: jest.fn(),
	findById: jest.fn(),
}

describe('ListProductsController', () => {
	let controller: ListProductsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ListProductsController],
			providers: [{ provide: ProductService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ListProductsController)
		jest.clearAllMocks()
	})

	describe('findAll', () => {
		it('should return paginated products with default params', async () => {
			const paginatedResult = {
				data: [{ id: 1, name: 'Product A' }],
				meta: {
					total: 1,
					page: 1,
					limit: 10,
					totalPages: 1,
					hasNextPage: false,
					hasPrevPage: false,
				},
			}
			serviceMock.findAllPaginated.mockResolvedValueOnce(paginatedResult)

			const result = await controller.findAll({})

			expect(serviceMock.findAllPaginated).toHaveBeenCalledWith(
				expect.objectContaining({ page: 1, limit: 10, sortOrder: 'desc' }),
			)
			expect(result).toEqual(paginatedResult)
		})

		it('should pass search and category filters to the service', async () => {
			serviceMock.findAllPaginated.mockResolvedValueOnce({ data: [], meta: {} })

			await controller.findAll({ page: '2', limit: '5', search: 'shoe', category: 'footwear' })

			expect(serviceMock.findAllPaginated).toHaveBeenCalledWith(
				expect.objectContaining({ page: 2, limit: 5, search: 'shoe', category: 'footwear' }),
			)
		})

		it('should pass sortBy and sortOrder to the service', async () => {
			serviceMock.findAllPaginated.mockResolvedValueOnce({ data: [], meta: {} })

			await controller.findAll({ sortBy: 'name', sortOrder: 'asc' })

			expect(serviceMock.findAllPaginated).toHaveBeenCalledWith(
				expect.objectContaining({ sortBy: 'name', sortOrder: 'asc' }),
			)
		})

		it('should throw when service throws', async () => {
			serviceMock.findAllPaginated.mockRejectedValueOnce(new Error('DB error'))

			await expect(controller.findAll({})).rejects.toThrow('DB error')
		})
	})

	describe('findOne', () => {
		it('should return a product when found', async () => {
			serviceMock.findById.mockResolvedValueOnce({ id: '42', name: 'Widget' })

			const result = await controller.findOne('42')

			expect(serviceMock.findById).toHaveBeenCalledWith('42')
			expect(result).toEqual({ id: '42', name: 'Widget' })
		})

		it('should propagate NotFoundException from service', async () => {
			serviceMock.findById.mockRejectedValueOnce(new NotFoundException('Product not found'))

			await expect(controller.findOne('999')).rejects.toThrow(NotFoundException)
		})
	})
})
