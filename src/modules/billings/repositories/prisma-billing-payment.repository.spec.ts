import {
	BadRequestException,
	ConflictException,
	NotFoundException,
	UnprocessableEntityException,
} from '@nestjs/common'
import { PrismaBillingPaymentRepository } from './prisma-billing-payment.repository'

const PAID_AT = new Date('2026-11-02T12:00:00Z')

const lockedBilling = (over: Record<string, unknown> = {}) => ({
	id: 1,
	seller_id: 'seller-1',
	order_id: 2,
	billing_number: 'COB-000001',
	status: 'partial',
	total_amount: 10000,
	paid_amount: 4000,
	...over,
})

const row = (over: Record<string, unknown> = {}) => ({
	id: 7,
	billing_id: 1,
	kind: 'payment',
	amount: 1500,
	method: 'pix',
	paid_at: PAID_AT,
	note: null,
	created_by: 'seller-1',
	reversal_of_id: null,
	created_at: PAID_AT,
	...over,
})

describe('PrismaBillingPaymentRepository', () => {
	let tx: any
	let prisma: any
	let repo: PrismaBillingPaymentRepository
	const tenant = { isAdmin: jest.fn(), getSellerId: jest.fn(), requireSellerId: jest.fn() }

	beforeEach(() => {
		jest.resetAllMocks()
		tenant.isAdmin.mockReturnValue(false)
		tenant.requireSellerId.mockReturnValue('seller-1')
		tx = {
			// lockBilling's SELECT ... FOR UPDATE
			$queryRaw: jest.fn().mockResolvedValue([lockedBilling()]),
			// claimIdempotencyKey's INSERT ... ON CONFLICT DO NOTHING
			$executeRaw: jest.fn().mockResolvedValue(1),
			idempotencyKey: { findUnique: jest.fn(), update: jest.fn() },
			billingPayment: {
				create: jest.fn().mockResolvedValue(row()),
				findMany: jest.fn().mockResolvedValue([row({ id: 3, amount: 4000 }), row()]),
				findFirst: jest.fn(),
				findUnique: jest.fn(),
				findUniqueOrThrow: jest.fn(),
			},
			billing: { update: jest.fn() },
			domainEvent: { createMany: jest.fn() },
		}
		prisma = {
			$transaction: jest.fn((cb: any) => cb(tx)),
			billing: { findFirst: jest.fn() },
			billingPayment: { findMany: jest.fn() },
		}
		repo = new PrismaBillingPaymentRepository(prisma, tenant as any)
	})

	const record = (over: Record<string, unknown> = {}) =>
		repo.record({
			billingId: 1,
			amount: 1500,
			method: 'pix',
			paidAt: PAID_AT,
			createdBy: 'seller-1',
			...over,
		} as any)

	describe('record', () => {
		it('locks the tenant’s charge, appends the payment and re-derives the charge', async () => {
			const { entry, replayed } = await record({ note: 'Sinal' })

			const [sql, ...params] = tx.$queryRaw.mock.calls[0]
			expect(sql.join('?')).toContain('FOR UPDATE')
			expect(params).toEqual([1, 'seller-1', 'seller-1'])
			expect(tx.billingPayment.create).toHaveBeenCalledWith({
				data: {
					billing_id: 1,
					seller_id: 'seller-1',
					kind: 'payment',
					amount: 1500,
					method: 'pix',
					paid_at: PAID_AT,
					note: 'Sinal',
					created_by: 'seller-1',
				},
			})
			// Balance from the ledger (4000 + 1500), never from a client-sent total.
			expect(tx.billing.update).toHaveBeenCalledWith({
				where: { id: 1 },
				data: {
					paid_amount: 5500,
					payment_date: PAID_AT,
					payment_method: 'pix',
					status: 'partial',
					payment_status: 'pending',
				},
			})
			expect(entry).toMatchObject({ id: 7, amount: 1500 })
			expect(replayed).toBe(false)
		})

		it('appends billing.payment_recorded in the same transaction', async () => {
			await record()

			expect(tx.domainEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
				seller_id: 'seller-1',
				aggregate_type: 'billing',
				aggregate_id: '1',
				event_type: 'billing.payment_recorded',
				payload: { billingId: 1, paymentId: 7, amount: 1500, paidAmount: 5500, totalAmount: 10000 },
			})
		})

		it('refuses an amount above the open balance (400), writing nothing', async () => {
			await expect(record({ amount: 6001 })).rejects.toThrow(/saldo em aberto/)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('accepts exactly the open balance ("Pago total")', async () => {
			await record({ amount: 6000 })
			expect(tx.billingPayment.create).toHaveBeenCalled()
		})

		it('refuses a payment on a canceled charge (400)', async () => {
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ status: 'canceled' })])

			await expect(record()).rejects.toBeInstanceOf(BadRequestException)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('404s for another seller’s charge (filtered in the locking query)', async () => {
			tx.$queryRaw.mockResolvedValueOnce([])

			await expect(record()).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		describe('Idempotency-Key', () => {
			const idempotency = {
				scope: 'billings.payments.record',
				key: 'k'.repeat(16),
				requestHash: 'h1',
			}

			it('claims before locking and completes with the new entry id', async () => {
				await record({ idempotency })

				expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
					tx.$queryRaw.mock.invocationCallOrder[0],
				)
				expect(tx.idempotencyKey.update).toHaveBeenCalledWith(
					expect.objectContaining({ data: { resource_id: '7', status_code: 201 } }),
				)
			})

			it('replays the original entry without writing', async () => {
				tx.$executeRaw.mockResolvedValueOnce(0)
				tx.idempotencyKey.findUnique.mockResolvedValueOnce({
					request_hash: 'h1',
					resource_id: '7',
					status_code: 201,
				})
				tx.billingPayment.findUniqueOrThrow.mockResolvedValueOnce(row())

				const result = await record({ idempotency })

				expect(result).toMatchObject({ replayed: true, entry: { id: 7 } })
				expect(tx.$queryRaw).not.toHaveBeenCalled()
				expect(tx.billingPayment.create).not.toHaveBeenCalled()
			})

			it('422s when the key is reused with another body', async () => {
				tx.$executeRaw.mockResolvedValueOnce(0)
				tx.idempotencyKey.findUnique.mockResolvedValueOnce({
					request_hash: 'other',
					resource_id: '7',
					status_code: 201,
				})

				await expect(record({ idempotency })).rejects.toBeInstanceOf(UnprocessableEntityException)
			})
		})
	})

	describe('reverse', () => {
		const reverse = () =>
			repo.reverse({ billingId: 1, paymentId: 7, reason: 'Duplicado', createdBy: 'seller-1' })

		beforeEach(() => {
			tx.billingPayment.findFirst.mockResolvedValue(row())
			tx.billingPayment.findUnique.mockResolvedValue(null)
			tx.billingPayment.create.mockResolvedValue(
				row({ id: 8, kind: 'reversal', reversal_of_id: 7, note: 'Duplicado' }),
			)
			tx.billingPayment.findMany.mockResolvedValue([
				row({ id: 3, amount: 4000 }),
				row(),
				row({
					id: 8,
					kind: 'reversal',
					reversal_of_id: 7,
					created_at: new Date('2026-11-03T00:00:00Z'),
				}),
			])
		})

		it('appends a reversal mirroring the payment and lowers the balance', async () => {
			const { entry } = await reverse()

			expect(tx.billingPayment.create.mock.calls[0][0].data).toMatchObject({
				kind: 'reversal',
				amount: 1500,
				method: 'pix',
				note: 'Duplicado',
				reversal_of_id: 7,
				created_by: 'seller-1',
			})
			expect(tx.billing.update.mock.calls[0][0].data).toMatchObject({ paid_amount: 4000 })
			expect(tx.domainEvent.createMany.mock.calls[0][0].data[0]).toMatchObject({
				event_type: 'billing.payment_reversed',
				payload: { paymentId: 7, reversalId: 8, amount: 1500, paidAmount: 4000 },
			})
			expect(entry).toMatchObject({ id: 8, kind: 'reversal' })
		})

		it('still allows reversals on a canceled charge (money goes back), keeping it canceled', async () => {
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ status: 'canceled' })])

			await reverse()

			expect(tx.billing.update.mock.calls[0][0].data).not.toHaveProperty('status')
		})

		it('404s for an entry of another charge', async () => {
			tx.billingPayment.findFirst.mockResolvedValueOnce(null)

			await expect(reverse()).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.billingPayment.findFirst).toHaveBeenCalledWith({ where: { id: 7, billing_id: 1 } })
		})

		it('refuses to reverse a reversal (400)', async () => {
			tx.billingPayment.findFirst.mockResolvedValueOnce(
				row({ kind: 'reversal', reversal_of_id: 2 }),
			)

			await expect(reverse()).rejects.toBeInstanceOf(BadRequestException)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('409s ALREADY_REVERSED for a payment reversed before', async () => {
			tx.billingPayment.findUnique.mockResolvedValueOnce({ id: 8 })

			const error = await reverse().catch((e) => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'ALREADY_REVERSED' })
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})
	})

	describe('list', () => {
		it('returns null for another seller’s charge', async () => {
			prisma.billing.findFirst.mockResolvedValueOnce(null)

			await expect(repo.list(1)).resolves.toBeNull()
			expect(prisma.billing.findFirst).toHaveBeenCalledWith({
				where: { id: 1, seller_id: 'seller-1' },
				select: { id: true },
			})
			expect(prisma.billingPayment.findMany).not.toHaveBeenCalled()
		})

		it('lists entries oldest first', async () => {
			prisma.billing.findFirst.mockResolvedValueOnce({ id: 1 })
			prisma.billingPayment.findMany.mockResolvedValueOnce([row()])

			await expect(repo.list(1)).resolves.toEqual([row()])
			expect(prisma.billingPayment.findMany).toHaveBeenCalledWith({
				where: { billing_id: 1 },
				orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
			})
		})
	})
})
