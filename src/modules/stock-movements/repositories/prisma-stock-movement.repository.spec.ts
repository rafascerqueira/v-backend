import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaStockMovementRepository } from './prisma-stock-movement.repository'

// Restock → backorder allocation (an arrival fills pending backorders oldest-first)
// plus Phase 1D: the stock row is locked, changed with an atomic increment, and the
// change is recorded as stock.moved in the same transaction.
describe('PrismaStockMovementRepository', () => {
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
			// lockStock's SELECT ... FOR UPDATE
			$queryRaw: jest.fn().mockResolvedValue([{ quantity: -3, reserved_quantity: 0 }]),
			store_stock: { upsert: jest.fn() },
			domainEvent: { createMany: jest.fn() },
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

		// Atomic increment under the lock, never an absolute write.
		expect(tx.store_stock.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ update: { quantity: { increment: 5 } } }),
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
		tx.$queryRaw.mockResolvedValue([{ quantity: 5, reserved_quantity: 0 }])

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

	it('locks the stock row before reading it', async () => {
		await repo.create(inMovement(1))

		expect(tx.$queryRaw.mock.calls[0][0].join('?')).toContain('FOR UPDATE')
		expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
			tx.store_stock.upsert.mock.invocationCallOrder[0],
		)
	})

	it('appends stock.moved with the covered orders, in the same transaction', async () => {
		await repo.create(inMovement(5))

		expect(tx.domainEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
			seller_id: 'seller-1',
			aggregate_type: 'stock',
			aggregate_id: '7',
			event_type: 'stock.moved',
			payload: {
				productId: 7,
				productName: 'Camiseta',
				movementType: 'in',
				referenceType: 'purchase',
				quantity: 5,
				previousQuantity: -3,
				newQuantity: 2,
				fulfilled: [
					{ orderId: 1, orderNumber: 'PED-001', quantity: 2 },
					{ orderId: 2, orderNumber: 'PED-002', quantity: 1 },
				],
			},
		})
	})

	it('refuses an out movement that would take stock below zero', async () => {
		tx.$queryRaw.mockResolvedValue([{ quantity: 1, reserved_quantity: 0 }])

		await expect(
			repo.create({ ...inMovement(2), movement_type: 'out', reference_type: 'sale' }),
		).rejects.toThrow('Insufficient stock')
		expect(tx.store_stock.upsert).not.toHaveBeenCalled()
	})

	describe('adjustTo (PATCH /store-stock quantity)', () => {
		it('records the difference, computed under the lock, as an adjustment movement', async () => {
			tx.$queryRaw.mockResolvedValue([{ quantity: 10, reserved_quantity: 0 }])

			await repo.adjustTo(7, 4)

			expect(tx.stock_movement.create).toHaveBeenCalledWith({
				data: {
					movement_type: 'out',
					reference_type: 'adjustment',
					reference_id: 7,
					product_id: 7,
					quantity: 6,
				},
			})
			expect(tx.store_stock.upsert).toHaveBeenCalledWith(
				expect.objectContaining({ update: { quantity: { increment: -6 } } }),
			)
		})

		it('may take stock to any value (a count correction is the seller’s call)', async () => {
			tx.$queryRaw.mockResolvedValue([{ quantity: 2, reserved_quantity: 0 }])

			await repo.adjustTo(7, -1)

			expect(tx.stock_movement.create.mock.calls[0][0].data).toMatchObject({
				movement_type: 'out',
				quantity: 3,
			})
		})

		it('does nothing when the quantity is already the target', async () => {
			tx.$queryRaw.mockResolvedValue([{ quantity: 4, reserved_quantity: 0 }])

			await expect(repo.adjustTo(7, 4)).resolves.toBeNull()
			expect(tx.stock_movement.create).not.toHaveBeenCalled()
			expect(tx.domainEvent.createMany).not.toHaveBeenCalled()
		})

		it('404s for another seller’s product', async () => {
			tx.product.findFirst.mockResolvedValueOnce(null)

			await expect(repo.adjustTo(7, 4)).rejects.toThrow('Product not found')
			expect(tx.$queryRaw).not.toHaveBeenCalled()
		})
	})
})
