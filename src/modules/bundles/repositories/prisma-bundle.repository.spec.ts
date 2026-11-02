import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaBundleRepository } from './prisma-bundle.repository'

// Proves a seller can't attach another tenant's product to a bundle (and so
// can't read its name/price back), and that rows written before the ownership
// check existed never serialize or price a foreign product.
describe('PrismaBundleRepository', () => {
	let repo: PrismaBundleRepository
	let prisma: any
	const tenant = {
		isAdmin: jest.fn(),
		getSellerId: jest.fn(),
		requireSellerId: jest.fn(),
	}

	const item = (productId: number, sellerId: string, price: number, quantity = 1) => ({
		id: productId * 10,
		bundle_id: 1,
		product_id: productId,
		quantity,
		product: {
			id: productId,
			seller_id: sellerId,
			name: `Produto ${productId}`,
			prices: [{ price, price_type: 'sale', active: true }],
		},
	})

	const bundleRow = (items: unknown[]) => ({
		id: 1,
		seller_id: 'seller-A',
		name: 'Kit',
		description: null,
		discount_percent: 10,
		active: true,
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		items,
	})

	beforeEach(async () => {
		tenant.isAdmin.mockReturnValue(false)
		tenant.getSellerId.mockReturnValue('seller-A')
		tenant.requireSellerId.mockReturnValue('seller-A')

		const tx = {
			bundle_item: { deleteMany: jest.fn() },
			bundle: { update: jest.fn().mockResolvedValue(bundleRow([item(1, 'seller-A', 1000)])) },
		}

		prisma = {
			product: { count: jest.fn() },
			bundle: {
				findFirst: jest.fn(),
				findMany: jest.fn(),
				create: jest.fn().mockResolvedValue(bundleRow([item(1, 'seller-A', 1000)])),
			},
			$transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
			tx,
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaBundleRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaBundleRepository)
	})

	describe('create', () => {
		const data = {
			seller_id: 'seller-A',
			name: 'Kit',
			discount_percent: 0,
			items: [
				{ product_id: 1, quantity: 1 },
				{ product_id: 99, quantity: 2 },
			],
		}

		it("throws NotFound when an item is another seller's product and never writes", async () => {
			prisma.product.count.mockResolvedValue(1) // only product 1 belongs to seller-A
			await expect(repo.create(data)).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.bundle.create).not.toHaveBeenCalled()
		})

		it("checks ownership against the bundle's seller, ignoring deleted products", async () => {
			prisma.product.count.mockResolvedValue(2)
			await repo.create(data)
			expect(prisma.product.count).toHaveBeenCalledWith({
				where: { id: { in: [1, 99] }, seller_id: 'seller-A', deletedAt: null },
			})
			expect(prisma.bundle.create).toHaveBeenCalled()
		})

		it('deduplicates repeated product ids before comparing the count', async () => {
			prisma.product.count.mockResolvedValue(1)
			await repo.create({
				...data,
				items: [
					{ product_id: 1, quantity: 1 },
					{ product_id: 1, quantity: 3 },
				],
			})
			expect(prisma.product.count).toHaveBeenCalledWith({
				where: { id: { in: [1] }, seller_id: 'seller-A', deletedAt: null },
			})
			expect(prisma.bundle.create).toHaveBeenCalled()
		})
	})

	describe('update', () => {
		it("throws NotFound when new items include another seller's product and never writes", async () => {
			prisma.bundle.findFirst.mockResolvedValue(bundleRow([item(1, 'seller-A', 1000)]))
			prisma.product.count.mockResolvedValue(0)

			await expect(
				repo.update(1, { items: [{ product_id: 99, quantity: 1 }] }),
			).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})

		it("validates against the bundle owner's seller when an admin edits it", async () => {
			tenant.isAdmin.mockReturnValue(true)
			prisma.bundle.findFirst.mockResolvedValue({
				...bundleRow([item(1, 'seller-B', 1000)]),
				seller_id: 'seller-B',
			})
			prisma.product.count.mockResolvedValue(1)

			await repo.update(1, { items: [{ product_id: 1, quantity: 1 }] })

			expect(prisma.product.count).toHaveBeenCalledWith({
				where: { id: { in: [1] }, seller_id: 'seller-B', deletedAt: null },
			})
		})

		it('skips the product check when items are not being replaced', async () => {
			prisma.bundle.findFirst.mockResolvedValue(bundleRow([item(1, 'seller-A', 1000)]))
			await repo.update(1, { name: 'Novo nome' })
			expect(prisma.product.count).not.toHaveBeenCalled()
			expect(prisma.tx.bundle.update).toHaveBeenCalled()
		})

		it('throws NotFound for a bundle the caller does not own', async () => {
			prisma.bundle.findFirst.mockResolvedValue(null)
			await expect(repo.update(1, { name: 'x' })).rejects.toBeInstanceOf(NotFoundException)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})
	})

	describe('read path', () => {
		it('drops foreign products already stored in a bundle and prices only own items', async () => {
			prisma.bundle.findFirst.mockResolvedValue(
				bundleRow([item(1, 'seller-A', 1000, 2), item(2, 'seller-B', 5000)]),
			)

			const bundle = await repo.findById(1)

			expect(bundle?.items.map((i) => i.product_id)).toEqual([1])
			expect(bundle?.total_price).toBe(2000)
			expect(bundle?.discounted_price).toBe(1800)
			expect(JSON.stringify(bundle)).not.toContain('Produto 2')
		})

		it('does not expose the product seller_id in the serialized item', async () => {
			prisma.bundle.findMany.mockResolvedValue([bundleRow([item(1, 'seller-A', 1000)])])
			const [bundle] = await repo.findAll()
			expect(bundle.items[0].product).not.toHaveProperty('seller_id')
		})
	})
})
