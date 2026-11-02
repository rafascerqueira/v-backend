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
	seller_id: 'seller-1',
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

/** The ledger already on the charge: one 4000 payment, matching paid_amount 4000. */
const OPENING = row({ id: 3, amount: 4000, created_at: new Date('2026-11-01T00:00:00Z') })

describe('PrismaBillingPaymentRepository', () => {
	let tx: any
	let prisma: any
	let repo: PrismaBillingPaymentRepository
	const tenant = { isAdmin: jest.fn(), getSellerId: jest.fn(), requireSellerId: jest.fn() }

	/** The SQL text of every raw query, in order. */
	const rawSql = () => tx.$queryRaw.mock.calls.map((c: any[]) => c[0].join('?'))

	beforeEach(() => {
		jest.resetAllMocks()
		tenant.isAdmin.mockReturnValue(false)
		tenant.requireSellerId.mockReturnValue('seller-1')
		tx = {
			// lockBilling's SELECT ... FOR UPDATE, then set_config(...)
			$queryRaw: jest.fn().mockResolvedValue([lockedBilling()]),
			// claimIdempotencyKey's INSERT ... ON CONFLICT DO NOTHING
			$executeRaw: jest.fn().mockResolvedValue(1),
			idempotencyKey: { findUnique: jest.fn(), update: jest.fn() },
			billingPayment: {
				create: jest.fn().mockResolvedValue(row()),
				findMany: jest.fn().mockResolvedValue([OPENING]),
				findUniqueOrThrow: jest.fn(),
			},
			billing: { update: jest.fn(), create: jest.fn() },
			order: { findUnique: jest.fn() },
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
		it('locks the tenant’s charge, appends the payment and re-derives the charge from the ledger', async () => {
			const { entry, sellerId, replayed } = await record({ note: 'Sinal' })

			const [lockSql, ...params] = tx.$queryRaw.mock.calls[0]
			expect(lockSql.join('?')).toContain('FOR UPDATE')
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
			expect(sellerId).toBe('seller-1')
			expect(replayed).toBe(false)
		})

		it('opens the paid_amount guard (app.ledger_write) only for its own transaction', async () => {
			await record()

			expect(
				rawSql().some((sql: string) => sql.includes("set_config('app.ledger_write', 'on', true)")),
			).toBe(true)
			expect(tx.$queryRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
				tx.billing.update.mock.invocationCallOrder[0],
			)
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

		it.each([
			['in the future', new Date(Date.now() + 86_400_000)],
			['before 2000', new Date('1999-12-31T00:00:00Z')],
			['invalid', new Date('nope')],
		])('refuses a paid_at %s (400) before touching the database', async (_case, paidAt) => {
			await expect(record({ paidAt })).rejects.toBeInstanceOf(BadRequestException)
			expect(prisma.$transaction).not.toHaveBeenCalled()
		})

		it('404s for another seller’s charge (filtered in the locking query)', async () => {
			tx.$queryRaw.mockResolvedValueOnce([])

			await expect(record()).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('refuses (409 LEDGER_DRIFT) when the stored balance disagrees with the ledger', async () => {
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ paid_amount: 4500 })])

			const error = await record().catch((e) => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'LEDGER_DRIFT' })
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

				expect(result).toMatchObject({ replayed: true, sellerId: 'seller-1', entry: { id: 7 } })
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
		const PAYMENT = row({ id: 7, amount: 1500 })
		const reverse = (paymentId = 7) =>
			repo.reverse({ billingId: 1, paymentId, reason: 'Duplicado', createdBy: 'seller-1' })

		beforeEach(() => {
			tx.$queryRaw.mockResolvedValue([lockedBilling({ paid_amount: 5500 })])
			tx.billingPayment.findMany.mockResolvedValue([OPENING, PAYMENT])
			tx.billingPayment.create.mockResolvedValue(
				row({
					id: 8,
					kind: 'reversal',
					reversal_of_id: 7,
					note: 'Duplicado',
					created_at: new Date('2026-11-03T00:00:00Z'),
				}),
			)
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
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ status: 'canceled', paid_amount: 5500 })])

			await reverse()

			expect(tx.billing.update.mock.calls[0][0].data).not.toHaveProperty('status')
		})

		it('404s for an entry that is not on this charge', async () => {
			await expect(reverse(999)).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('refuses to reverse a reversal (400)', async () => {
			const reversal = row({ id: 9, kind: 'reversal', reversal_of_id: 3, amount: 4000 })
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ paid_amount: 1500 })])
			tx.billingPayment.findMany.mockResolvedValueOnce([OPENING, PAYMENT, reversal])

			await expect(reverse(9)).rejects.toBeInstanceOf(BadRequestException)
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('409s ALREADY_REVERSED for a payment reversed before', async () => {
			const earlier = row({ id: 8, kind: 'reversal', reversal_of_id: 7 })
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ paid_amount: 4000 })])
			tx.billingPayment.findMany.mockResolvedValueOnce([OPENING, PAYMENT, earlier])

			const error = await reverse().catch((e) => e)

			expect(error).toBeInstanceOf(ConflictException)
			expect(error.getResponse()).toMatchObject({ code: 'ALREADY_REVERSED' })
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})
	})

	describe('updateCharge (PATCH, under the lock)', () => {
		const update = (over: Record<string, unknown> = {}) =>
			repo.updateCharge({
				billingId: 1,
				legacyNote: 'Registrado pela edição da cobrança',
				createdBy: 'seller-1',
				fallbackMethod: 'cash',
				...over,
			} as any)

		it('derives status from the LOCKED paid amount and the new total', async () => {
			const result = await update({ totalAmount: 4000, notes: 'x', dueDate: null })

			expect(tx.billing.update).toHaveBeenCalledWith({
				where: { id: 1 },
				data: {
					total_amount: 4000,
					due_date: null,
					notes: 'x',
					status: 'paid',
					payment_status: 'confirmed',
				},
			})
			expect(result).toEqual({ recorded: null, sellerId: 'seller-1' })
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it('records a higher paid_amount target as one payment of the difference', async () => {
			tx.billingPayment.create.mockResolvedValueOnce(row({ id: 11, amount: 2500, note: 'legacy' }))

			const result = await update({ paidAmountTarget: 6500, paymentMethod: 'pix', paidAt: PAID_AT })

			expect(tx.billingPayment.create.mock.calls[0][0].data).toMatchObject({
				kind: 'payment',
				amount: 2500,
				method: 'pix',
				paid_at: PAID_AT,
				note: 'Registrado pela edição da cobrança',
			})
			expect(result.recorded).toMatchObject({ id: 11, amount: 2500 })
		})

		it('is idempotent under a retried save: the same target finds nothing left to record', async () => {
			tx.$queryRaw.mockResolvedValueOnce([lockedBilling({ paid_amount: 6500 })])

			const result = await update({ paidAmountTarget: 6500 })

			expect(result.recorded).toBeNull()
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
		})

		it.each([
			['a lower paid_amount (use a reversal)', { paidAmountTarget: 1000 }, /estorne/],
			['a total below what was paid', { totalAmount: 3000 }, /abaixo do valor já pago/],
			['paid above the total', { paidAmountTarget: 12000 }, /maior que o total/],
		])('refuses %s, writing nothing', async (_case, over, message) => {
			await expect(update(over)).rejects.toThrow(message)
			expect(tx.billing.update).not.toHaveBeenCalled()
		})

		it('refuses a payment on a canceled charge, and keeps it canceled on other edits', async () => {
			tx.$queryRaw.mockResolvedValue([lockedBilling({ status: 'canceled' })])

			await expect(update({ paidAmountTarget: 5000 })).rejects.toThrow(/cancelada/)
			await update({ notes: 'x' })

			expect(tx.billing.update.mock.calls[0][0].data).not.toHaveProperty('status')
		})
	})

	describe('openCharge', () => {
		beforeEach(() => {
			tx.order.findUnique.mockResolvedValue({ seller_id: 'seller-1' })
			tx.billing.create.mockResolvedValue({
				id: 5,
				seller_id: 'seller-1',
				order_id: 2,
				billing_number: 'B-1',
				status: 'pending',
				total_amount: 10000,
			})
			tx.billingPayment.findMany.mockResolvedValue([])
		})

		const open = (initialPayment?: Record<string, unknown>) =>
			repo.openCharge({
				orderId: 2,
				billingNumber: 'B-1',
				totalAmount: 10000,
				paymentMethod: 'cash',
				initialPayment,
			} as any)

		it('creates an unpaid charge owned by the order’s seller', async () => {
			const result = await open()

			expect(tx.billing.create.mock.calls[0][0].data).toMatchObject({
				order_id: 2,
				seller_id: 'seller-1',
				paid_amount: 0,
				status: 'pending',
			})
			expect(tx.billingPayment.create).not.toHaveBeenCalled()
			expect(result).toEqual({ billingId: 5, sellerId: 'seller-1' })
		})

		it('records what was already paid in the same transaction', async () => {
			tx.billingPayment.create.mockResolvedValueOnce(
				row({ billing_id: 5, amount: 2500, method: 'cash' }),
			)

			await open({ amount: 2500, paidAt: PAID_AT, note: 'n', createdBy: 'seller-1' })

			expect(prisma.$transaction).toHaveBeenCalledTimes(1)
			expect(tx.billingPayment.create.mock.calls[0][0].data).toMatchObject({
				billing_id: 5,
				amount: 2500,
				method: 'cash',
			})
			expect(tx.billing.update.mock.calls[0][0].data).toMatchObject({ paid_amount: 2500 })
		})

		it('404s for a missing order', async () => {
			tx.order.findUnique.mockResolvedValueOnce(null)
			await expect(open()).rejects.toBeInstanceOf(NotFoundException)
			expect(tx.billing.create).not.toHaveBeenCalled()
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

			await expect(repo.list(1)).resolves.toEqual([expect.objectContaining({ id: 7 })])
			expect(prisma.billingPayment.findMany).toHaveBeenCalledWith({
				where: { billing_id: 1 },
				orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
			})
		})
	})
})
