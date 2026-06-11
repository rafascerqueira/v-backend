/**
 * StoreStockController unit tests
 * Covers: GET /store-stock, GET /store-stock/:productId, PATCH /store-stock/:productId
 * Guards mocked: JwtAuthGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { StoreStockService } from '../services/store-stock.service'
import { StoreStockController } from './store-stock.controller'

const serviceMock = {
	findAll: jest.fn(),
	getByProduct: jest.fn(),
	upsert: jest.fn(),
}

describe('StoreStockController', () => {
	let controller: StoreStockController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [StoreStockController],
			providers: [{ provide: StoreStockService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(StoreStockController)
		jest.clearAllMocks()
	})

	describe('findAll', () => {
		it('should return all store stock entries', async () => {
			const stock = [
				{ product_id: 1, quantity: 10 },
				{ product_id: 2, quantity: 5 },
			]
			serviceMock.findAll.mockResolvedValueOnce(stock)

			const result = await controller.findAll()

			expect(serviceMock.findAll).toHaveBeenCalled()
			expect(result).toEqual(stock)
		})

		it('should propagate service errors', async () => {
			serviceMock.findAll.mockRejectedValueOnce(new Error('DB failure'))

			await expect(controller.findAll()).rejects.toThrow('DB failure')
		})
	})

	describe('get', () => {
		it('should return stock for a given productId as number', async () => {
			serviceMock.getByProduct.mockResolvedValueOnce({ product_id: 7, quantity: 15 })

			const result = await controller.get('7')

			expect(serviceMock.getByProduct).toHaveBeenCalledWith(7)
			expect(result).toEqual({ product_id: 7, quantity: 15 })
		})

		it('should convert string productId to number', async () => {
			serviceMock.getByProduct.mockResolvedValueOnce(null)

			await controller.get('42')

			expect(serviceMock.getByProduct).toHaveBeenCalledWith(42)
		})
	})

	describe('upsert', () => {
		it('should upsert stock with numeric productId and body', async () => {
			const body = { quantity: 20 }
			const updatedStock = { product_id: 3, quantity: 20 }
			serviceMock.upsert.mockResolvedValueOnce(updatedStock)

			const result = await controller.upsert('3', body as any)

			expect(serviceMock.upsert).toHaveBeenCalledWith(3, body)
			expect(result).toEqual(updatedStock)
		})

		it('should propagate service errors on upsert', async () => {
			serviceMock.upsert.mockRejectedValueOnce(new Error('Constraint violation'))

			await expect(controller.upsert('1', { quantity: 5 } as any)).rejects.toThrow(
				'Constraint violation',
			)
		})
	})
})
