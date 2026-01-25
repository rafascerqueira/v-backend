import { Test, type TestingModule } from '@nestjs/testing'
import { ProductService } from './product.service'
import { PRODUCT_REPOSITORY } from '@/shared/repositories/product.repository'

describe('ProductService', () => {
  let service: ProductService
  let productRepository: any

  let productsStore: any[]
  let idSeq: number

  const createRepositoryMock = () => {
    productsStore = []
    idSeq = 1
    return {
      create: jest.fn(async (data: any) => {
        const newItem = { id: idSeq++, deletedAt: null, ...data }
        productsStore.push(newItem)
        return newItem
      }),
      findAll: jest.fn(async () => [...productsStore]),
      findById: jest.fn(async (id: number) => {
        return productsStore.find((p) => p.id === id) ?? null
      }),
      findBySku: jest.fn(async (sku: string) => {
        return productsStore.find((p) => p.sku === sku) ?? null
      }),
      update: jest.fn(async (id: number, data: any) => {
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProductService,
        { provide: PRODUCT_REPOSITORY, useValue: repositoryMock },
      ],
    }).compile()

    service = module.get<ProductService>(ProductService)
    productRepository = module.get(PRODUCT_REPOSITORY)
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
      const result = await service.create(productData)

      expect(productRepository.create).toHaveBeenCalledWith(productData)
      expect(result).toBeTruthy()
      expect(result?.name).toBe(productData.name)
    })
  })

  describe('findAll', () => {
    it('should return all products', async () => {
      await productRepository.create({ name: 'Product 1', sku: 'SKU-001' })
      await productRepository.create({ name: 'Product 2', sku: 'SKU-002' })

      const result = await service.findAll()

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Product 1')
    })
  })

  describe('findById', () => {
    it('should find product by id', async () => {
      const created = await productRepository.create({
        name: 'Test Product',
        sku: 'TEST-SKU',
      })

      const result = await service.findById(created.id.toString())

      expect(result).toBeTruthy()
      expect(result?.id).toBe(created.id)
    })
  })

  describe('update', () => {
    it('should update product', async () => {
      const created = await productRepository.create({
        name: 'Original Product',
        sku: 'ORIG-SKU',
      })

      const result = await service.update(created.id.toString(), { name: 'Updated Product' })

      expect(result).toBeTruthy()
      expect(result?.name).toBe('Updated Product')
    })
  })

  describe('remove', () => {
    it('should soft delete product', async () => {
      const created = await productRepository.create({
        name: 'To Delete Product',
        sku: 'DELETE-SKU',
      })

      const result = await service.remove(created.id.toString())

      expect(result).toBeTruthy()
      expect(result?.deletedAt).toBeTruthy()
    })
  })
})