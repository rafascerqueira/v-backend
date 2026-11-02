import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OutboxRelayService } from '@/shared/events/outbox-relay.service'
import { hashRequest } from '@/shared/idempotency/request-hash'
import { RedisService } from '@/shared/redis/redis.service'
import { BILLING_REPOSITORY } from '@/shared/repositories/billing.repository'
import { BILLING_PAYMENT_REPOSITORY } from '@/shared/repositories/billing-payment.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { BILLING_PAYMENT_SCOPES, BillingsService, LEGACY_PAYMENT_NOTES } from './billings.service'

const repositoryMock = {
	findAll: jest.fn(),
	findByOrderId: jest.fn(),
	findById: jest.fn(),
	findUnbilledPerSaleOrders: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
	verifyOrderAccess: jest.fn(),
}

const paymentsMock = {
	record: jest.fn(),
	reverse: jest.fn(),
	list: jest.fn(),
	updateCharge: jest.fn(),
	openCharge: jest.fn(),
}
const outboxMock = { kick: jest.fn(), relayPending: jest.fn() }

const tenantContextMock = {
	getSellerId: jest.fn(),
	requireSellerId: jest.fn(),
	isAdmin: jest.fn(),
}

const redisMock = { delete: jest.fn() }

const billing = (over: Record<string, unknown> = {}) => ({
	id: 1,
	order_id: 2,
	seller_id: 'owner-seller',
	billing_number: 'COB-000001',
	total_amount: 10000,
	paid_amount: 4000,
	payment_method: 'pix',
	payment_status: 'pending',
	status: 'partial',
	due_date: null,
	payment_date: null,
	...over,
})

const entry = { id: 9, billing_id: 1, kind: 'payment', amount: 1500 }

describe('BillingsService', () => {
	let service: BillingsService

	beforeEach(async () => {
		jest.resetAllMocks()
		tenantContextMock.getSellerId.mockReturnValue('caller-id')
		tenantContextMock.requireSellerId.mockReturnValue('caller-id')
		tenantContextMock.isAdmin.mockReturnValue(false)
		redisMock.delete.mockResolvedValue(undefined)
		repositoryMock.findById.mockResolvedValue(billing())

		const module = await Test.createTestingModule({
			providers: [
				BillingsService,
				{ provide: BILLING_REPOSITORY, useValue: repositoryMock },
				{ provide: BILLING_PAYMENT_REPOSITORY, useValue: paymentsMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: RedisService, useValue: redisMock },
				{ provide: OutboxRelayService, useValue: outboxMock },
			],
		}).compile()

		service = module.get(BillingsService)
	})

	it('listByOrder should delegate to repository', async () => {
		repositoryMock.findByOrderId.mockResolvedValueOnce([])
		await expect(service.listByOrder(1)).resolves.toEqual([])
		expect(repositoryMock.findByOrderId).toHaveBeenCalledWith(1, {})
	})

	describe('create (POST /orders/:id/billings)', () => {
		const dto = {
			billing_number: 'B-1',
			total_amount: 10000,
			paid_amount: 0,
			payment_method: 'cash' as const,
			due_date: '2026-11-30T00:00:00.000Z',
		}

		beforeEach(() => {
			repositoryMock.verifyOrderAccess.mockResolvedValue({ id: 2, seller_id: 'owner-seller' })
			paymentsMock.openCharge.mockResolvedValue({ billingId: 1, sellerId: 'owner-seller' })
		})

		it('opens an unpaid charge through the ledger repository', async () => {
			const res = await service.create(2, dto)

			expect(paymentsMock.openCharge).toHaveBeenCalledWith({
				orderId: 2,
				billingNumber: 'B-1',
				totalAmount: 10000,
				paymentMethod: 'cash',
				dueDate: new Date('2026-11-30T00:00:00.000Z'),
				notes: undefined,
				initialPayment: undefined,
			})
			expect(res).toEqual(billing())
			expect(outboxMock.kick).not.toHaveBeenCalled()
		})

		it('turns an amount already paid into the first entry, in the same transaction', async () => {
			await service.create(2, {
				...dto,
				paid_amount: 2500,
				payment_date: '2026-11-01T12:00:00.000Z',
			} as any)

			expect(paymentsMock.openCharge.mock.calls[0][0].initialPayment).toEqual({
				amount: 2500,
				paidAt: new Date('2026-11-01T12:00:00.000Z'),
				note: LEGACY_PAYMENT_NOTES.create,
				createdBy: 'caller-id',
			})
			expect(redisMock.delete).toHaveBeenCalledWith('dashboard:stats:owner-seller')
		})

		it('404s when the order is not the tenant’s', async () => {
			repositoryMock.verifyOrderAccess.mockResolvedValueOnce(null)
			await expect(service.create(2, dto)).rejects.toBeInstanceOf(NotFoundException)
			expect(paymentsMock.openCharge).not.toHaveBeenCalled()
		})

		it('400s when paid_amount exceeds total_amount', async () => {
			await expect(service.create(2, { ...dto, paid_amount: 20000 })).rejects.toBeInstanceOf(
				BadRequestException,
			)
		})
	})

	describe('update (PATCH, applied under the charge lock)', () => {
		beforeEach(() => {
			paymentsMock.updateCharge.mockResolvedValue({ recorded: null, sellerId: 'owner-seller' })
		})

		it('hands every field to the locked repository path (paid_amount as an absolute target)', async () => {
			await service.update(1, {
				total_amount: 9000,
				paid_amount: 6500,
				payment_method: 'pix',
				payment_date: '2026-11-02T10:00:00.000Z',
				due_date: null,
				notes: 'x',
			})

			expect(paymentsMock.updateCharge).toHaveBeenCalledWith({
				billingId: 1,
				totalAmount: 9000,
				paidAmountTarget: 6500,
				paymentMethod: 'pix',
				fallbackMethod: 'cash',
				paidAt: new Date('2026-11-02T10:00:00.000Z'),
				dueDate: null,
				notes: 'x',
				legacyNote: LEGACY_PAYMENT_NOTES.patch,
				createdBy: 'caller-id',
			})
			expect(repositoryMock.update).not.toHaveBeenCalled()
		})

		it('kicks the relay only when a payment was recorded, invalidating the owner’s stats', async () => {
			paymentsMock.updateCharge.mockResolvedValueOnce({ recorded: entry, sellerId: 'owner-seller' })

			await service.update(1, { paid_amount: 6500 })

			expect(outboxMock.kick).toHaveBeenCalled()
			expect(redisMock.delete).toHaveBeenCalledWith('dashboard:stats:owner-seller')
		})

		it('propagates the repository’s rules (e.g. lowering paid_amount)', async () => {
			paymentsMock.updateCharge.mockRejectedValueOnce(new BadRequestException('estorne'))
			await expect(service.update(1, { paid_amount: 1 })).rejects.toBeInstanceOf(
				BadRequestException,
			)
		})
	})

	describe('syncBillings', () => {
		it('numbers the charge COB-n for a server-numbered PED-n, legacy orders keep theirs', async () => {
			repositoryMock.findUnbilledPerSaleOrders.mockResolvedValueOnce([
				{ id: 5, order_number: 'PED-000123', total: 1000, createdAt: new Date() },
				{ id: 6, order_number: 'PED-202611-1234', total: 2000, createdAt: new Date() },
			])
			repositoryMock.create.mockResolvedValue({ id: 1 })

			const res = await service.syncBillings()

			expect(repositoryMock.create.mock.calls.map((c) => c[0].billing_number)).toEqual([
				'COB-000123',
				'PED-202611-1234',
			])
			expect(res).toEqual({ created: 2, orders: ['COB-000123', 'PED-202611-1234'] })
		})

		it('returns empty when nothing is unbilled', async () => {
			repositoryMock.findUnbilledPerSaleOrders.mockResolvedValueOnce([])
			await expect(service.syncBillings()).resolves.toEqual({ created: 0, orders: [] })
		})
	})

	describe('findAll', () => {
		it('passes a status filter through, except overdue', async () => {
			repositoryMock.findAll.mockResolvedValueOnce([])
			await service.findAll('paid')
			expect(repositoryMock.findAll).toHaveBeenCalledWith({ status: 'paid' })
		})

		it('computes overdue in memory', async () => {
			repositoryMock.findAll.mockResolvedValueOnce([{ status: 'overdue' }, { status: 'pending' }])
			await expect(service.findAll('overdue')).resolves.toEqual([{ status: 'overdue' }])
			expect(repositoryMock.findAll).toHaveBeenCalledWith({})
		})
	})

	describe('cancel', () => {
		it('voids a billing the tenant owns and invalidates the owner’s stats', async () => {
			repositoryMock.update.mockResolvedValueOnce(billing({ status: 'canceled' }))

			await service.cancel(1)

			expect(repositoryMock.update).toHaveBeenCalledWith(1, {
				status: 'canceled',
				payment_status: 'canceled',
			})
			expect(redisMock.delete).toHaveBeenCalledWith('dashboard:stats:owner-seller')
		})

		it('404s for a missing/cross-tenant billing and never writes', async () => {
			repositoryMock.findById.mockResolvedValueOnce(null)
			await expect(service.cancel(1)).rejects.toBeInstanceOf(NotFoundException)
			expect(repositoryMock.update).not.toHaveBeenCalled()
		})
	})

	describe('delete', () => {
		it('delegates to the repository (404 / 409 HAS_PAYMENTS there) and invalidates the owner', async () => {
			repositoryMock.delete.mockResolvedValueOnce({ sellerId: 'owner-seller' })

			await service.delete(1)

			expect(repositoryMock.delete).toHaveBeenCalledWith(1)
			expect(redisMock.delete).toHaveBeenCalledWith('dashboard:stats:owner-seller')
		})
	})

	describe('ledger endpoints', () => {
		it('recordPayment: the caller is the author, paid_at defaults to now', async () => {
			paymentsMock.record.mockResolvedValueOnce({
				entry,
				sellerId: 'owner-seller',
				replayed: false,
			})
			const before = Date.now()

			const res = await service.recordPayment(1, { amount: 1500, method: 'pix' })

			const input = paymentsMock.record.mock.calls[0][0]
			expect(input).toMatchObject({
				billingId: 1,
				amount: 1500,
				method: 'pix',
				createdBy: 'caller-id',
			})
			expect(input.paidAt.getTime()).toBeGreaterThanOrEqual(before)
			expect(input.idempotency).toBeUndefined()
			expect(res).toEqual({ payment: entry, billing: billing() })
			// An admin acting on a seller's charge refreshes the SELLER's dashboard.
			expect(redisMock.delete).toHaveBeenCalledWith('dashboard:stats:owner-seller')
			expect(outboxMock.kick).toHaveBeenCalled()
		})

		it('recordPayment: forwards the Idempotency-Key; a replay has no side effects', async () => {
			paymentsMock.record.mockResolvedValueOnce({ entry, sellerId: 'owner-seller', replayed: true })
			const dto = { amount: 1500, method: 'pix' as const }

			await service.recordPayment(1, dto, 'key-1234567890abcdef')

			expect(paymentsMock.record.mock.calls[0][0].idempotency).toEqual({
				scope: BILLING_PAYMENT_SCOPES.record,
				key: 'key-1234567890abcdef',
				requestHash: hashRequest({ billingId: 1, ...dto }),
			})
			expect(redisMock.delete).not.toHaveBeenCalled()
			expect(outboxMock.kick).not.toHaveBeenCalled()
		})

		it('reversePayment: returns the reversal and the updated charge', async () => {
			const reversal = { ...entry, id: 10, kind: 'reversal', reversal_of_id: 9 }
			paymentsMock.reverse.mockResolvedValueOnce({
				entry: reversal,
				sellerId: 'owner-seller',
				replayed: false,
			})

			const res = await service.reversePayment(1, 9, { reason: 'Lançado em duplicidade' })

			expect(paymentsMock.reverse).toHaveBeenCalledWith({
				billingId: 1,
				paymentId: 9,
				reason: 'Lançado em duplicidade',
				createdBy: 'caller-id',
				idempotency: undefined,
			})
			expect(res).toEqual({ reversal, billing: billing() })
		})

		it('listPayments: 404 for a missing/cross-tenant charge', async () => {
			paymentsMock.list.mockResolvedValueOnce(null)
			await expect(service.listPayments(1)).rejects.toBeInstanceOf(NotFoundException)
		})
	})
})
