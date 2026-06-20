import { ForbiddenException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { PlanLimitsService } from '@/modules/subscriptions/services/plan-limits.service'
import {
	type CreateProductData,
	PRODUCT_REPOSITORY,
	type Product,
	type ProductRepository,
	type UpdateProductData,
} from '@/shared/repositories/product.repository'
import { PRODUCT_PRICE_REPOSITORY } from '@/shared/repositories/product-price.repository'
import { ProductService } from './product.service'

describe('ProductService', () => {
	let service: ProductService
	let productRepository: jest.Mocked<ProductRepository>
	const planLimitsServiceMock = { hasFeature: jest.fn() }

	let productsStore: Product[]
	let idSeq: number

	const createRepositoryMock = (): jest.Mocked<ProductRepository> => {
		productsStore = []
		idSeq = 1
		return {
			create: jest.fn(async (data: CreateProductData): Promise<Product> => {
				const newItem: Product = {
					id: idSeq++,
					deletedAt: null,
					createdAt: new Date(),
					updatedAt: new Date(),
					seller_id: data.seller_id,
					name: data.name,
					description: data.description || null,
					sku: data.sku || null,
					category: data.category || null,
					brand: data.brand || null,
					unit: data.unit,
					specifications: data.specifications || {},
					images: data.images || [],
					active: data.active ?? true,
					allow_oversell: data.allow_oversell ?? false,
				}
				productsStore.push(newItem)
				return newItem
			}),
			findAll: jest.fn(async () => [...productsStore]),
			findAllPaginated: jest.fn(
				async (params: {
					page: number
					limit: number
					search?: string
					category?: string
					status?: string
					sortBy?: string
					sortOrder?: 'asc' | 'desc'
				}) => {
					const { page, limit } = params
					const start = (page - 1) * limit
					const end = start + limit
					const data = productsStore.slice(start, end)
					return { data, total: productsStore.length }
				},
			),
			findById: jest.fn(async (id: number) => {
				return productsStore.find((p) => p.id === id) ?? null
			}),
			findBySku: jest.fn(async (sellerId: string, sku: string) => {
				return productsStore.find((p) => p.sku === sku && p.seller_id === sellerId) ?? null
			}),
			update: jest.fn(async (id: number, data: UpdateProductData) => {
				const idx = productsStore.findIndex((p) => p.id === id)
				if (idx === -1) throw new Error('Not found')
				productsStore[idx] = { ...productsStore[idx], ...data }
				return productsStore[idx]
			}),
			softDelete: jest.fn(async (id: number) => {
				const idx = productsStore.findIndex((p) => p.id === id)
				if (idx === -1) throw new Error('Not found')
				productsStore[idx].deletedAt = new Date()
				return productsStore[idx]
			}),
		}
	}

	beforeEach(async () => {
		const repositoryMock = createRepositoryMock()
		const priceRepositoryMock = {
			findByProduct: jest.fn(async () => []),
			findById: jest.fn(async () => null),
			create: jest.fn(async (data: any) => ({ id: 1, ...data })),
			update: jest.fn(async (id: number, data: any) => ({ id, ...data })),
			deactivate: jest.fn(async (id: number) => ({ id, active: false })),
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProductService,
				{ provide: PRODUCT_REPOSITORY, useValue: repositoryMock },
				{ provide: PRODUCT_PRICE_REPOSITORY, useValue: priceRepositoryMock },
				{ provide: PlanLimitsService, useValue: planLimitsServiceMock },
			],
		}).compile()

		service = module.get<ProductService>(ProductService)
		productRepository = module.get(PRODUCT_REPOSITORY)
		planLimitsServiceMock.hasFeature.mockReset().mockResolvedValue(true)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	describe('create', () => {
		const productData = {
			seller_id: 'test-seller-id',
			name: 'Test Product',
			description: 'Test Description',
			sku: 'TEST-SKU-001',
			category: 'Electronics',
			brand: 'Test Brand',
			unit: 'piece',
			specifications: { imported: false },
			images: ['image1.jpg'],
			active: true,
		}

		it('should create a product', async () => {
			const result = await service.create(productData, 'pro')

			expect(productRepository.create).toHaveBeenCalledWith(productData)
			expect(result).toBeTruthy()
			expect(result?.name).toBe(productData.name)
		})

		it('blocks more than one image without the multipleImages feature', async () => {
			planLimitsServiceMock.hasFeature.mockResolvedValue(false)
			await expect(
				service.create({ ...productData, images: ['a.jpg', 'b.jpg'] } as CreateProductData, 'free'),
			).rejects.toThrow(ForbiddenException)
			expect(productRepository.create).not.toHaveBeenCalled()
			expect(planLimitsServiceMock.hasFeature).toHaveBeenCalledWith(
				'test-seller-id',
				'free',
				'multipleImages',
			)
		})

		it('allows multiple images when the feature is available', async () => {
			planLimitsServiceMock.hasFeature.mockResolvedValue(true)
			const result = await service.create(
				{ ...productData, images: ['a.jpg', 'b.jpg'] } as CreateProductData,
				'pro',
			)
			expect(result).toBeTruthy()
			expect(productRepository.create).toHaveBeenCalled()
		})

		it('allows a single image without checking the feature', async () => {
			await service.create({ ...productData, images: ['only.jpg'] } as CreateProductData, 'free')
			expect(planLimitsServiceMock.hasFeature).not.toHaveBeenCalled()
		})
	})

	describe('findAll', () => {
		it('should return all products', async () => {
			await productRepository.create({
				seller_id: 'test-seller-id',
				name: 'Product 1',
				sku: 'SKU-001',
				unit: 'piece',
			})
			await productRepository.create({
				seller_id: 'test-seller-id',
				name: 'Product 2',
				sku: 'SKU-002',
				unit: 'piece',
			})

			const result = await service.findAll()

			expect(result).toHaveLength(2)
			expect(result[0].name).toBe('Product 1')
		})
	})

	describe('findById', () => {
		it('should find product by id', async () => {
			const created = await productRepository.create({
				seller_id: 'test-seller-id',
				name: 'Test Product',
				sku: 'TEST-SKU',
				unit: 'piece',
			})

			const result = await service.findById(created.id.toString())

			expect(result).toBeTruthy()
			expect(result?.id).toBe(created.id)
		})
	})

	describe('update', () => {
		it('should update product', async () => {
			const created = await productRepository.create({
				seller_id: 'test-seller-id',
				name: 'Original Product',
				sku: 'ORIG-SKU',
				unit: 'piece',
			})

			const result = await service.update(
				created.id.toString(),
				{
					name: 'Updated Product',
				},
				'test-seller-id',
				'pro',
			)

			expect(result).toBeTruthy()
			expect(result?.name).toBe('Updated Product')
		})
	})

	describe('remove', () => {
		it('should soft delete product', async () => {
			const created = await productRepository.create({
				seller_id: 'test-seller-id',
				name: 'To Delete Product',
				sku: 'DELETE-SKU',
				unit: 'piece',
			})

			const result = await service.remove(created.id.toString())

			expect(result).toBeTruthy()
			expect(result?.deletedAt).toBeTruthy()
		})
	})
})
