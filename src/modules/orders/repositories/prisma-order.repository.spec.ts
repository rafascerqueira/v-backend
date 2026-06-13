import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { PrismaOrderRepository } from './prisma-order.repository'

// Exercises the transactional logic that moved out of OrdersService: tenant
// ownership (404 on missing/cross-tenant), idempotent stock restoration on
// cancellation, no double-restore when deleting an already-canceled order, and
// atomic billing creation alongside the order.
describe('PrismaOrderRepository', () => {
	let repo: PrismaOrderRepository
	let tx: any
	let prismaMock: any
	const tenant = {
		isAdmin: jest.fn(),
		getSellerId: jest.fn(),
		requireSellerId: jest.fn(),
	}

	beforeEach(async () => {
		tenant.isAdmin.mockReturnValue(false)
		tenant.getSellerId.mockReturnValue('seller-1')
		tenant.requireSellerId.mockReturnValue('seller-1')

		tx = {
			$queryRawUnsafe: jest.fn(),
			order: {
				findUnique: jest.fn(),
				create: jest.fn().mockResolvedValue({ id: 42, Order_item: [] }),
				update: jest.fn().mockResolvedValue({ id: 1, status: 'canceled' }),
				delete: jest.fn().mockResolvedValue({ id: 1 }),
			},
			order_item: { findMany: jest.fn().mockResolvedValue([{ product_id: 7, quantity: 3 }]) },
			store_stock: {
				findUnique: jest.fn().mockResolvedValue({ quantity: 10, reserved_quantity: 0 }),
				update: jest.fn(),
			},
			stock_movement: { create: jest.fn() },
			billing: { updateMany: jest.fn(), create: jest.fn() },
			product: { findUnique: jest.fn().mockResolvedValue({ name: 'P' }) },
		}
		prismaMock = {
			$transaction: jest.fn((cb: any) => cb(tx)),
			order: { findUnique: jest.fn(), findMany: jest.fn() },
		}

		const module = await Test.createTestingModule({
			providers: [
				PrismaOrderRepository,
				{ provide: PrismaService, useValue: prismaMock },
				{ provide: TenantContext, useValue: tenant },
			],
		}).compile()

		repo = module.get(PrismaOrderRepository)
	})

	describe('updateStatus', () => {
		it('restores stock and cancels billing when an order moves into canceled', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1', status: 'pending' })

			await repo.updateStatus(1, 'canceled', { status: 'canceled', payment_status: 'canceled' })

			expect(tx.store_stock.update).toHaveBeenCalledWith({
				where: { product_id: 7 },
				data: { quantity: { increment: 3 } },
			})
			expect(tx.stock_movement.create).toHaveBeenCalled()
			expect(tx.billing.updateMany).toHaveBeenCalled()
			expect(tx.order.update).toHaveBeenCalledWith({
				where: { id: 1 },
				data: { status: 'canceled' },
			})
		})

		it('is idempotent — does not re-restore stock for an already-canceled order', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1', status: 'canceled' })

			await repo.updateStatus(1, 'canceled', { status: 'canceled', payment_status: 'canceled' })

			expect(tx.store_stock.update).not.toHaveBeenCalled()
			expect(tx.stock_movement.create).not.toHaveBeenCalled()
		})

		it('throws NotFound when the order does not exist', async () => {
			tx.order.findUnique.mockResolvedValue(null)

			await expect(repo.updateStatus(999, 'delivered')).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.order.update).not.toHaveBeenCalled()
		})

		it('throws NotFound for an order owned by another seller', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'other-seller', status: 'pending' })

			await expect(repo.updateStatus(1, 'delivered')).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.order.update).not.toHaveBeenCalled()
		})
	})

	describe('delete', () => {
		it('restores stock for a non-canceled order', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1', status: 'pending' })

			await repo.delete(1)

			expect(tx.store_stock.update).toHaveBeenCalled()
			expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 1 } })
		})

		it('does NOT re-restore stock for an already-canceled order', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1', status: 'canceled' })

			await repo.delete(1)

			expect(tx.store_stock.update).not.toHaveBeenCalled()
			expect(tx.order.delete).toHaveBeenCalled()
		})

		it('throws NotFound when the order does not exist', async () => {
			tx.order.findUnique.mockResolvedValue(null)

			await expect(repo.delete(999)).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.order.delete).not.toHaveBeenCalled()
		})
	})

	describe('create', () => {
		it('persists the attached charge inside the same transaction', async () => {
			tx.order.create.mockResolvedValue({ id: 42, Order_item: [] })

			await repo.create({
				seller_id: 'seller-1',
				customer_id: 'c1',
				order_number: 'ORD-9',
				subtotal: 1000,
				discount: 0,
				total: 1000,
				items: [{ product_id: 7, quantity: 1, unit_price: 1000, discount: 0, total: 1000 }],
				billing: {
					billing_number: 'COB-9',
					total_amount: 1000,
					paid_amount: 0,
					payment_method: 'cash',
					payment_status: 'pending',
					status: 'pending',
				},
			})

			expect(tx.billing.create).toHaveBeenCalledWith(
				expect.objectContaining({
					data: expect.objectContaining({
						order_id: 42,
						billing_number: 'COB-9',
						total_amount: 1000,
					}),
				}),
			)
		})

		it('does not create a charge when none is attached', async () => {
			tx.order.create.mockResolvedValue({ id: 43, Order_item: [] })

			await repo.create({
				seller_id: 'seller-1',
				customer_id: 'c1',
				order_number: 'ORD-10',
				subtotal: 1000,
				discount: 0,
				total: 1000,
				items: [{ product_id: 7, quantity: 1, unit_price: 1000, discount: 0, total: 1000 }],
			})

			expect(tx.billing.create).not.toHaveBeenCalled()
		})
	})
})
