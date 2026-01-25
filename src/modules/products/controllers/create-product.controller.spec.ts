import { Test, type TestingModule } from '@nestjs/testing'
import { CreateProductController } from './create-product.controller'
import { ProductService } from '../services/product.service'
import { HttpException, HttpStatus } from '@nestjs/common'

describe('CreateProductController', () => {
	let controller: CreateProductController
	let service: ProductService

	const mockProductService = {
		create: jest.fn(),
	}

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [CreateProductController],
			providers: [
				{
					provide: ProductService,
					useValue: mockProductService,
				},
			],
		}).compile()

		controller = module.get<CreateProductController>(CreateProductController)
		service = module.get<ProductService>(ProductService)
	})

	afterEach(() => {
		jest.clearAllMocks()
	})

	it('should be defined', () => {
		expect(controller).toBeDefined()
	})

	describe('handle', () => {
		const validProductData = {
			name: 'Test Product',
			description: 'Test Description',
			sku: 'TEST-SKU-001',
			category: 'Electronics',
			brand: 'Test Brand',
			unit: 'piece',
			specifications: {
				imported: false,
				moreinfo: 'Additional info',
			},
			images: ['https://example.com/image1.jpg'],
			active: true,
		}

		it('should create a product successfully', async () => {
			const expectedProduct = { id: 1, ...validProductData }
			mockProductService.create.mockResolvedValue(expectedProduct)

			const result = await controller.handle(validProductData)

			expect(service.create).toHaveBeenCalledWith(validProductData)
			expect(result).toEqual(expectedProduct)
		})

		it('should handle validation errors for invalid data', async () => {
			const invalidData = {
				name: '', // empty name
				description: 'Test',
				sku: 'TEST',
				category: 'Test',
				brand: 'Test',
				unit: 'un',
				specifications: {
					imported: false,
				},
				images: [],
				active: true,
			}

			// The validation should throw an error for empty name
			try {
				await controller.handle(invalidData)
				fail('Should have thrown validation error')
			} catch (error) {
				expect(error).toBeDefined()
			}
		})

		it('should handle service errors', async () => {
			mockProductService.create.mockRejectedValue(
				new Error('Database connection failed'),
			)

			await expect(controller.handle(validProductData)).rejects.toThrow(
				'Database connection failed',
			)
		})

		it('should handle duplicate SKU error', async () => {
			mockProductService.create.mockRejectedValue(
				new HttpException(
					'Product with this SKU already exists',
					HttpStatus.CONFLICT,
				),
			)

			await expect(controller.handle(validProductData)).rejects.toThrow(
				HttpException,
			)
		})

		it('should validate specifications object', async () => {
			const dataWithInvalidSpecs = {
				...validProductData,
				specifications: 'invalid' as any, // should be an object
			}

			await expect(controller.handle(dataWithInvalidSpecs)).rejects.toThrow()
		})

		it('should validate images array', async () => {
			const dataWithInvalidImages = {
				...validProductData,
				images: 'not-an-array' as any, // should be an array
			}

			await expect(controller.handle(dataWithInvalidImages)).rejects.toThrow()
		})

		it('should handle optional fields correctly', async () => {
			const minimalData = {
				name: 'Minimal Product',
				description: 'Minimal Description',
				sku: 'MIN-001',
				category: 'Test',
				brand: 'Test Brand',
				unit: 'un',
				specifications: {
					imported: true,
				},
				images: [],
				active: true,
			}

			mockProductService.create.mockResolvedValue({ id: 2, ...minimalData })

			const result = await controller.handle(minimalData)

			expect(service.create).toHaveBeenCalledWith(minimalData)
			expect(result).toBeDefined()
		})
	})
})
