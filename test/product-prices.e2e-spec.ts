import { Test, type TestingModule } from '@nestjs/testing'
import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import * as request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/shared/prisma/prisma.service'

describe('Product Prices (e2e)', () => {
  let app: NestFastifyApplication
  let prisma: PrismaService

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    )
    prisma = app.get<PrismaService>(PrismaService)

    const { ZodExceptionFilter } = await import('../src/shared/filters/zod-exception.filter')
    app.useGlobalFilters(new ZodExceptionFilter())

    await app.init()
    await app.getHttpAdapter().getInstance().ready()
  })

  afterEach(async () => {
    await prisma.product_price.deleteMany()
    await prisma.product.deleteMany()
    await app.close()
  })

  const createProduct = async () => {
    const payload = {
      name: `Price Test Product ${Date.now()}`,
      description: 'Test product for price e2e',
      sku: `PRICE-E2E-${Date.now()}`,
      category: 'Category',
      brand: 'Brand',
      unit: 'un',
      specifications: { imported: false },
      images: [],
      active: true,
    }

    const res = await request(app.getHttpServer())
      .post('/product/create-product')
      .send(payload)
      .expect(201)

    // fetch product to get ID (service create doesn't return, so find by SKU)
    const product = await prisma.product.findFirstOrThrow({ where: { sku: payload.sku } })
    return product
  }

  it('should create, list, update and deactivate a product price', async () => {
    const product = await createProduct()

    // Create price
    const createBody = {
      price: 1234,
      price_type: 'sale',
      valid_from: '2025-01-01T00:00:00.000Z',
      valid_to: '2025-12-31T23:59:59.000Z',
      active: true,
    }

    const createRes = await request(app.getHttpServer())
      .post(`/products/${product.id}/prices`)
      .send(createBody)
      .expect(201)

    expect(createRes.body).toMatchObject({
      product_id: product.id,
      price: createBody.price,
      price_type: createBody.price_type,
      active: true,
    })

    // List prices
    const listRes = await request(app.getHttpServer())
      .get(`/products/${product.id}/prices`)
      .expect(200)

    expect(Array.isArray(listRes.body)).toBe(true)
    expect(listRes.body.length).toBeGreaterThanOrEqual(1)

    const priceId = createRes.body.id

    // Update price
    const updateBody = { price: 1500, valid_to: null }
    const updateRes = await request(app.getHttpServer())
      .patch(`/product-prices/${priceId}`)
      .send(updateBody)
      .expect(200)

    expect(updateRes.body).toMatchObject({ id: priceId, price: 1500 })

    // Deactivate price
    const deactivateRes = await request(app.getHttpServer())
      .delete(`/product-prices/${priceId}`)
      .expect(200)

    expect(deactivateRes.body).toMatchObject({ id: priceId, active: false })
  })

  it('should validate bad payload on create', async () => {
    const product = await createProduct()

    const badBody = {
      price: -10, // invalid (nonnegative)
      price_type: 'invalid', // invalid enum
    }

    await request(app.getHttpServer())
      .post(`/products/${product.id}/prices`)
      .send(badBody)
      .expect(400)
  })
})
