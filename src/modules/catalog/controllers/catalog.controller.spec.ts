/**
 * CatalogController unit tests
 * Covers: All @Public endpoints — store lookup by slug, products, customer lookup, order creation
 * Guards mocked: JwtAuthGuard (all routes are @Public so guard is never reached)
 */

import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { CatalogService } from '../services/catalog.service'
import { CatalogController } from './catalog.controller'

const serviceMock = {
	getStoreBySlug: jest.fn(),
	getStoreProducts: jest.fn(),
	getStoreProductById: jest.fn(),
	getCustomerInStore: jest.fn(),
	createOrder: jest.fn(),
}

describe('CatalogController', () => {
	let controller: CatalogController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [CatalogController],
			providers: [{ provide: CatalogService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(CatalogController)
		jest.clearAllMocks()
	})

	describe('getStore', () => {
		it('should return store info by slug', async () => {
			const store = { id: 'store-1', store_name: 'My Shop', store_slug: 'my-shop' }
			serviceMock.getStoreBySlug.mockResolvedValueOnce(store)

			const result = await controller.getStore('my-shop')

			expect(serviceMock.getStoreBySlug).toHaveBeenCalledWith('my-shop')
			expect(result).toEqual(store)
		})

		it('should propagate NotFoundException when store not found', async () => {
			serviceMock.getStoreBySlug.mockRejectedValueOnce(new NotFoundException('Store not found'))

			await expect(controller.getStore('nonexistent')).rejects.toThrow(NotFoundException)
		})
	})

	describe('getStoreProducts', () => {
		it('should return products for the given store slug', async () => {
			const products = [{ id: 1, name: 'Product A' }]
			serviceMock.getStoreProducts.mockResolvedValueOnce(products)

			const result = await controller.getStoreProducts('my-shop')

			expect(serviceMock.getStoreProducts).toHaveBeenCalledWith('my-shop')
			expect(result).toEqual(products)
		})
	})

	describe('getStoreProduct', () => {
		it('should return product by store slug and numeric id', async () => {
			const product = { id: 5, name: 'Widget' }
			serviceMock.getStoreProductById.mockResolvedValueOnce(product)

			const result = await controller.getStoreProduct('my-shop', '5')

			expect(serviceMock.getStoreProductById).toHaveBeenCalledWith('my-shop', 5)
			expect(result).toEqual(product)
		})

		it('should convert string id to number', async () => {
			serviceMock.getStoreProductById.mockResolvedValueOnce(null)

			await controller.getStoreProduct('my-shop', '123')

			expect(serviceMock.getStoreProductById).toHaveBeenCalledWith('my-shop', 123)
		})
	})

	describe('getStoreCustomer', () => {
		it('should return customer scoped to the given store slug', async () => {
			const customer = { id: 'cust-uuid', firstName: 'John' }
			serviceMock.getCustomerInStore.mockResolvedValueOnce(customer)

			const result = await controller.getStoreCustomer('my-shop', 'cust-uuid')

			expect(serviceMock.getCustomerInStore).toHaveBeenCalledWith('my-shop', 'cust-uuid')
			expect(result).toEqual(customer)
		})

		it('should propagate NotFoundException when customer does not belong to the store', async () => {
			serviceMock.getCustomerInStore.mockRejectedValueOnce(new NotFoundException())

			await expect(controller.getStoreCustomer('my-shop', 'cust-uuid')).rejects.toThrow(
				NotFoundException,
			)
		})
	})

	describe('createOrder', () => {
		it('should create order from catalog and return the new order', async () => {
			const orderBody: any = {
				seller_id: 'seller-1',
				customer: {
					name: 'João Silva',
					email: 'joao@email.com',
					phone: '11999999999',
					address: 'Rua das Flores',
				},
				items: [{ product_id: 1, quantity: 2 }],
			}
			const createdOrder = { id: 100, ...orderBody }
			serviceMock.createOrder.mockResolvedValueOnce(createdOrder)

			const result = await controller.createOrder(orderBody)

			expect(serviceMock.createOrder).toHaveBeenCalledWith(orderBody)
			expect(result).toEqual(createdOrder)
		})

		it('should propagate service errors', async () => {
			serviceMock.createOrder.mockRejectedValueOnce(new Error('Out of stock'))

			await expect(controller.createOrder({} as any)).rejects.toThrow('Out of stock')
		})
	})
})
