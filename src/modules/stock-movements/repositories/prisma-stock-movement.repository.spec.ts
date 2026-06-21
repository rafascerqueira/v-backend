import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaStockMovementRepository } from './prisma-stock-movement.repository'

// Focused on the restock → backorder allocation: an incoming arrival fills the
// product's pending backorders oldest-first, marks fully-covered ones fulfilled,
// and reports them so the service can notify the seller. `out` movements never
// touch backorders.
describe('PrismaStockMovementRepository — backorder allocation', () => {
	let repo: PrismaStockMovementRepository
	let tx: any
	let prisma: any
	const tenant = {
		isAdmin: jest.fn().mockReturnValue(false),
		getSellerId: jest.fn().mockReturnValue('seller-1'),
		requireSellerId: jest.fn().mockReturnValue('seller-1'),
	}

	beforeEach(async () => {
		tx = {
			product: {
				findFirst: jest.fn().mockResolvedValue({ id: 7, name: 'Camiseta', seller_id: 'seller-1' }),
			},
			store_stock: {
				findUnique: jest.fn().mockResolvedValue({
					quantity: -3,
					reserved_quantity: 0,
					min_stock: 0,
					max_stock: 0,
				}),
				upsert: jest.fn(),
			},
			stock_movement: { create: jest.fn().mockResolvedValue({ id: 1, product_id: 7 }) },
			backorder: {
				findMany: jest.fn().mockResolvedValue([
					{ id: 100, order_id: 1, quantity: 2, fulfilled_quantity: 0 },
					{ id: 101, order_id: 2, quantity: 1, fulfilled_quantity: 0 },
				]),
				update: jest.fn(),
			},
			order: {
				findUnique: jest.fn(({ where }: any) => ({ order_number: `PED-00${where.id}` })),
			},
		}
		prisma = { $transaction: jest.fn((cb: any) => cb(tx)) }

		const module = await Test.createTestingModule({
			providers: [
				PrismaStockMovementRepository,
				{ provide: PrismaService, useValue: prisma },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaStockMovementRepository)
	})

	const inMovement = (quantity: number) => ({
		movement_type: 'in',
		reference_type: 'purchase',
		reference_id: 0,
		product_id: 7,
		quantity,
	})

	it('fills every pending backorder FIFO when the arrival covers the whole deficit', async () => {
		// stock -3 + 5 → 2; deficit of 3 fully covered.
		const result = await repo.create(inMovement(5))

		expect(tx.store_stock.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ update: { quantity: 2 } }),
		)
		expect(tx.backorder.update).toHaveBeenCalledWith({
			where: { id: 100 },
			data: { fulfilled_quantity: 2, status: 'fulfilled', fulfilledAt: expect.any(Date) },
		})
		expect(tx.backorder.update).toHaveBeenCalledWith({
			where: { id: 101 },
			data: { fulfilled_quantity: 1, status: 'fulfilled', fulfilledAt: expect.any(Date) },
		})
		expect(result.fulfilled).toEqual([
			expect.objectContaining({ order_id: 1, order_number: 'PED-001', quantity: 2 }),
			expect.objectContaining({ order_id: 2, order_number: 'PED-002', quantity: 1 }),
		])
	})

	it('covers only the oldest order and leaves the remainder pending on a partial arrival', async () => {
		// stock -3 + 2 → -1; only 2 units to allocate → order 1 (needs 2) filled, order 2 untouched.
		const result = await repo.create(inMovement(2))

		expect(tx.backorder.update).toHaveBeenCalledTimes(1)
		expect(tx.backorder.update).toHaveBeenCalledWith({
			where: { id: 100 },
			data: { fulfilled_quantity: 2, status: 'fulfilled', fulfilledAt: expect.any(Date) },
		})
		expect(result.fulfilled).toEqual([
			expect.objectContaining({ order_id: 1, order_number: 'PED-001', quantity: 2 }),
		])
	})

	it('does not allocate backorders on an out movement', async () => {
		tx.store_stock.findUnique.mockResolvedValue({
			quantity: 5,
			reserved_quantity: 0,
			min_stock: 0,
			max_stock: 0,
		})

		const result = await repo.create({
			movement_type: 'out',
			reference_type: 'sale',
			reference_id: 0,
			product_id: 7,
			quantity: 1,
		})

		expect(tx.backorder.findMany).not.toHaveBeenCalled()
		expect(result.fulfilled).toEqual([])
	})
})
