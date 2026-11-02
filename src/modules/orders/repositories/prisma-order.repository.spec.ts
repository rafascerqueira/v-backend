import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { CreateOrderData } from '@/shared/repositories/order.repository'
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
			// nextSellerSequenceValue → the per-seller counter's new value
			$queryRaw: jest.fn().mockResolvedValue([{ value: 9 }]),
			// claimIdempotencyKey's INSERT ... ON CONFLICT DO NOTHING → rows inserted
			$executeRaw: jest.fn().mockResolvedValue(1),
			idempotencyKey: { findUnique: jest.fn(), update: jest.fn() },
			domainEvent: { createMany: jest.fn() },
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
			billing: {
				updateMany: jest.fn(),
				create: jest.fn(),
				createMany: jest.fn().mockResolvedValue({ count: 1 }),
				findFirst: jest.fn().mockResolvedValue(null),
			},
			backorder: {
				create: jest.fn(),
				update: jest.fn(),
				updateMany: jest.fn(),
				findMany: jest.fn().mockResolvedValue([]),
			},
			product: {
				findUnique: jest.fn().mockResolvedValue({ name: 'P' }),
				// Ownership checks added for tenant isolation: every requested product
				// is owned by the order's seller by default.
				findFirst: jest.fn().mockResolvedValue({ id: 7 }),
				count: jest.fn().mockResolvedValue(1),
			},
		}
		prismaMock = {
			$transaction: jest.fn((cb: any) => cb(tx)),
			order: { findUnique: jest.fn(), findMany: jest.fn() },
			domainEvent: { findMany: jest.fn() },
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
			expect(tx.backorder.updateMany).toHaveBeenCalledWith({
				where: { order_id: 1, status: 'pending' },
				data: { status: 'canceled' },
			})
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
		const item = { product_id: 7, quantity: 1, unit_price: 1000, discount: 0, total: 1000 }
		const data = (overrides: Partial<CreateOrderData> = {}): CreateOrderData => ({
			seller_id: 'seller-1',
			customer_id: 'c1',
			subtotal: 1000,
			discount: 0,
			total: 1000,
			items: [item],
			source: 'dashboard',
			allowOversell: true,
			...overrides,
		})
		const perSaleCharge = {
			total_amount: 1000,
			paid_amount: 0,
			payment_method: 'cash',
			payment_status: 'pending',
			status: 'pending',
		}
		const appendedEvents = () => tx.domainEvent.createMany.mock.calls[0][0].data

		it('numbers the order and its charge from the per-seller sequence', async () => {
			tx.order.create.mockResolvedValue({ id: 42, Order_item: [] })

			const result = await repo.create(data({ billing: perSaleCharge }))

			expect(result).toEqual({ orderId: 42, replayed: false })
			expect(tx.order.create.mock.calls[0][0].data.order_number).toBe('PED-000009')
			expect(tx.billing.createMany).toHaveBeenCalledWith({
				data: [
					expect.objectContaining({
						order_id: 42,
						seller_id: 'seller-1',
						billing_number: 'COB-000009',
						total_amount: 1000,
					}),
				],
				skipDuplicates: true,
			})
			expect(tx.billing.create).not.toHaveBeenCalled()
		})

		it('falls back to a suffixed number when a hand-typed charge already holds COB-n', async () => {
			tx.order.create.mockResolvedValue({ id: 42, Order_item: [] })
			tx.billing.createMany.mockResolvedValueOnce({ count: 0 })

			await repo.create(data({ billing: perSaleCharge }))

			expect(tx.billing.create).toHaveBeenCalledWith({
				data: expect.objectContaining({ billing_number: 'COB-000009-42', seller_id: 'seller-1' }),
			})
		})

		it('stores metadata and the storefront tracking token', async () => {
			await repo.create(
				data({
					source: 'storefront',
					allowOversell: false,
					metadata: { source: 'catalog' },
					tracking_token: 'tok_abcdefghijklmnopqrs',
				}),
			)

			expect(tx.order.create.mock.calls[0][0].data).toMatchObject({
				metadata: { source: 'catalog' },
				tracking_token: 'tok_abcdefghijklmnopqrs',
			})
		})

		it('appends order.created in the same transaction, without customer PII', async () => {
			tx.order.create.mockResolvedValue({ id: 42, Order_item: [] })

			await repo.create(data())

			expect(appendedEvents()).toEqual([
				{
					seller_id: 'seller-1',
					aggregate_type: 'order',
					aggregate_id: '42',
					event_type: 'order.created',
					payload: {
						orderId: 42,
						orderNumber: 'PED-000009',
						source: 'dashboard',
						customerId: 'c1',
						total: 1000,
						itemCount: 1,
						oversold: [],
					},
				},
			])
		})

		it('blocks the sale when stock is insufficient and oversell is off', async () => {
			tx.store_stock.findUnique.mockResolvedValue({ quantity: 1, reserved_quantity: 0 })
			tx.product.findUnique.mockResolvedValue({ name: 'P', allow_oversell: false })

			await expect(
				repo.create(data({ items: [{ ...item, quantity: 5, total: 5000 }] })),
			).rejects.toThrow('Estoque insuficiente')
			expect(tx.order.create).not.toHaveBeenCalled()
		})

		it('never oversells on the storefront, even for an allow_oversell product', async () => {
			tx.store_stock.findUnique.mockResolvedValue({ quantity: 1, reserved_quantity: 0 })
			tx.product.findUnique.mockResolvedValue({ name: 'P', allow_oversell: true })

			await expect(
				repo.create(
					data({
						source: 'storefront',
						allowOversell: false,
						items: [{ ...item, quantity: 5, total: 5000 }],
					}),
				),
			).rejects.toThrow('Estoque insuficiente para "P". Disponível: 1, Solicitado: 5')
			expect(tx.order.create).not.toHaveBeenCalled()
		})

		it('completes the sale, lets stock go negative and reports the oversold item in the event', async () => {
			tx.store_stock.findUnique.mockResolvedValue({ quantity: 1, reserved_quantity: 0 })
			tx.product.findUnique.mockResolvedValue({ name: 'P', allow_oversell: true })

			await repo.create(data({ items: [{ ...item, quantity: 5, total: 5000 }] }))

			expect(tx.order.create).toHaveBeenCalled()
			expect(tx.store_stock.update).toHaveBeenCalledWith({
				where: { product_id: 7 },
				data: { quantity: { decrement: 5 } },
			})
			expect(appendedEvents()[0].payload.oversold).toEqual([
				{ productId: 7, productName: 'P', available: 1, requested: 5 },
			])
		})

		it('records a backorder for only the owed units when oversold', async () => {
			tx.store_stock.findUnique.mockResolvedValue({ quantity: 2, reserved_quantity: 0 })
			tx.product.findUnique.mockResolvedValue({ name: 'P', allow_oversell: true })
			tx.order.create.mockResolvedValue({ id: 50, Order_item: [{ id: 500, product_id: 7 }] })

			await repo.create(data({ items: [{ ...item, quantity: 5, total: 5000 }] }))

			// available 2, sold 5 → 3 owed (the 2 on hand are not backordered).
			expect(tx.backorder.create).toHaveBeenCalledWith({
				data: {
					seller_id: 'seller-1',
					order_id: 50,
					order_item_id: 500,
					product_id: 7,
					quantity: 3,
				},
			})
		})

		it('rejects an order whose product belongs to another seller (tenant isolation)', async () => {
			// 0 of the 1 requested products belong to seller-1 → 404, no stock touched.
			tx.product.count.mockResolvedValueOnce(0)

			await expect(
				repo.create(data({ items: [{ ...item, product_id: 99 }] })),
			).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.order.create).not.toHaveBeenCalled()
			expect(tx.store_stock.update).not.toHaveBeenCalled()
			expect(tx.$queryRaw).not.toHaveBeenCalled()
		})

		it('does not create a charge when none is attached', async () => {
			await repo.create(data())

			expect(tx.billing.createMany).not.toHaveBeenCalled()
			expect(tx.billing.create).not.toHaveBeenCalled()
		})

		describe('Idempotency-Key', () => {
			const idempotency = { scope: 'orders.create', key: 'key-1', requestHash: 'hash-1' }

			it('claims the key first and completes it with the new order id', async () => {
				tx.order.create.mockResolvedValue({ id: 42, Order_item: [] })

				await repo.create(data({ idempotency }))

				expect(tx.$executeRaw).toHaveBeenCalledTimes(1)
				expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
					tx.$queryRawUnsafe.mock.invocationCallOrder[0],
				)
				expect(tx.idempotencyKey.update).toHaveBeenCalledWith({
					where: {
						seller_id_scope_key: { seller_id: 'seller-1', scope: 'orders.create', key: 'key-1' },
					},
					data: { resource_id: '42', status_code: 201 },
				})
			})

			it('replays: same key and body return the original order and write nothing', async () => {
				tx.$executeRaw.mockResolvedValueOnce(0)
				tx.idempotencyKey.findUnique.mockResolvedValueOnce({
					request_hash: 'hash-1',
					resource_id: '17',
					status_code: 201,
				})

				const result = await repo.create(data({ idempotency }))

				expect(result).toEqual({ orderId: 17, replayed: true })
				expect(tx.order.create).not.toHaveBeenCalled()
				expect(tx.store_stock.update).not.toHaveBeenCalled()
				expect(tx.domainEvent.createMany).not.toHaveBeenCalled()
			})

			it('answers 422 IDEMPOTENCY_KEY_MISMATCH for the same key with another body', async () => {
				tx.$executeRaw.mockResolvedValueOnce(0)
				tx.idempotencyKey.findUnique.mockResolvedValueOnce({
					request_hash: 'other-hash',
					resource_id: '17',
					status_code: 201,
				})

				const error = await repo.create(data({ idempotency })).catch((e) => e)

				expect(error).toBeInstanceOf(UnprocessableEntityException)
				expect(error.getResponse()).toMatchObject({ code: 'IDEMPOTENCY_KEY_MISMATCH' })
				expect(tx.order.create).not.toHaveBeenCalled()
			})
		})
	})

	describe('events on status change and delete', () => {
		it('appends order.status_changed when the status actually changes', async () => {
			tx.order.findUnique.mockResolvedValue({
				id: 1,
				seller_id: 'seller-1',
				order_number: 'PED-000001',
				status: 'pending',
			})

			await repo.updateStatus(1, 'confirmed')

			expect(tx.domainEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
				event_type: 'order.status_changed',
				aggregate_id: '1',
				payload: { orderId: 1, orderNumber: 'PED-000001', from: 'pending', to: 'confirmed' },
			})
		})

		it('appends nothing when the status does not change', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1', status: 'confirmed' })

			await repo.updateStatus(1, 'confirmed')

			expect(tx.domainEvent.createMany).not.toHaveBeenCalled()
		})

		it('appends order.deleted when an order is deleted', async () => {
			tx.order.findUnique.mockResolvedValue({
				id: 1,
				seller_id: 'seller-1',
				order_number: 'PED-000001',
				status: 'pending',
			})

			await repo.delete(1)

			expect(tx.domainEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
				event_type: 'order.deleted',
				payload: { orderId: 1, orderNumber: 'PED-000001', status: 'pending' },
			})
		})

		it('refuses to delete an order whose charge has money on it (409 HAS_PAYMENTS)', async () => {
			tx.order.findUnique.mockResolvedValue({ id: 1, seller_id: 'seller-1', status: 'pending' })
			tx.billing.findFirst.mockResolvedValueOnce({ id: 5 })

			const error = await repo.delete(1).catch((e) => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'HAS_PAYMENTS' })
			expect(tx.billing.findFirst).toHaveBeenCalledWith({
				where: { order_id: 1, paid_amount: { gt: 0 } },
				select: { id: true },
			})
			expect(tx.order.delete).not.toHaveBeenCalled()
			expect(tx.store_stock.update).not.toHaveBeenCalled()
		})
	})

	describe('findEvents', () => {
		it("returns the order's events oldest first", async () => {
			prismaMock.order.findUnique.mockResolvedValue({ seller_id: 'seller-1' })
			const occurred_at = new Date('2026-11-02T12:00:00Z')
			prismaMock.domainEvent.findMany.mockResolvedValue([
				{ id: 'e1', event_type: 'order.created', occurred_at, payload: { orderId: 1 } },
			])

			const events = await repo.findEvents(1)

			expect(prismaMock.domainEvent.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { seller_id: 'seller-1', aggregate_type: 'order', aggregate_id: '1' },
					orderBy: { occurred_at: 'asc' },
				}),
			)
			expect(events).toEqual([
				{ id: 'e1', event_type: 'order.created', occurred_at, payload: { orderId: 1 } },
			])
		})

		it("returns null for another seller's order (the service turns it into 404)", async () => {
			prismaMock.order.findUnique.mockResolvedValue({ seller_id: 'other-seller' })

			await expect(repo.findEvents(1)).resolves.toBeNull()
			expect(prismaMock.domainEvent.findMany).not.toHaveBeenCalled()
		})
	})
})
