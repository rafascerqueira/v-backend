import { Test, TestingModule } from '@nestjs/testing'
import { RemoveProductController } from './remove-product.controller'
import { ProductService } from '../services/product.service'

describe('RemoveProductController', () => {
	let controller: RemoveProductController
	let productService: ProductService

	const mockProductService = {
		remove: jest.fn(),
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [RemoveProductController],
			providers: [
				{
					provide: ProductService,
					useValue: mockProductService,
				},
			],
		}).compile()

		controller = module.get<RemoveProductController>(RemoveProductController)
		productService = module.get<ProductService>(ProductService)
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	describe('handle', () => {
		it('should call productService.remove with correct id', async () => {
			const productId = '123'
			const expectedResult = {
				id: 123,
				name: 'Product',
				deletedAt: new Date(),
			}

			mockProductService.remove.mockResolvedValue(expectedResult)

			await controller.handle(productId)

			expect(productService.remove).toHaveBeenCalledWith(productId)
			expect(productService.remove).toHaveBeenCalledTimes(1)
		})

		it('should handle errors from productService.remove', async () => {
			const productId = '123'
			const error = new Error('Product not found')

			mockProductService.remove.mockRejectedValue(error)

			await expect(controller.handle(productId)).rejects.toThrow(
				'Product not found',
			)
			expect(productService.remove).toHaveBeenCalledWith(productId)
		})

		it('should handle invalid id format', async () => {
			const invalidId = 'invalid-id'
			const error = new Error('Invalid ID format')

			mockProductService.remove.mockRejectedValue(error)

			await expect(controller.handle(invalidId)).rejects.toThrow(
				'Invalid ID format',
			)
			expect(productService.remove).toHaveBeenCalledWith(invalidId)
		})
	})
})
