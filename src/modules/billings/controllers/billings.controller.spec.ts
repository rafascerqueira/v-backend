import { Test } from '@nestjs/testing'
import { BillingsService } from '../services/billings.service'
import { BillingsController } from './billings.controller'

const serviceMock = {
	listByOrder: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	cancel: jest.fn(),
	delete: jest.fn(),
	findAll: jest.fn(),
	syncBillings: jest.fn(),
	listPayments: jest.fn(),
	recordPayment: jest.fn(),
	reversePayment: jest.fn(),
}

describe('BillingsController', () => {
	let controller: BillingsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [BillingsController],
			providers: [{ provide: BillingsService, useValue: serviceMock }],
		}).compile()

		controller = module.get(BillingsController)
		jest.clearAllMocks()
	})

	it('list should call service.listByOrder with numeric id', async () => {
		serviceMock.listByOrder.mockResolvedValueOnce([{ id: 1 }])
		const res = await controller.list('42')
		expect(serviceMock.listByOrder).toHaveBeenCalledWith(42)
		expect(res).toEqual([{ id: 1 }])
	})

	it('create should call service.create with numeric orderId and body', async () => {
		const dto: any = {
			billing_number: 'B-1',
			total_amount: 1000,
			paid_amount: 0,
			status: 'pending',
		}
		serviceMock.create.mockResolvedValueOnce({ id: 10, order_id: 7, ...dto })
		const res = await controller.create('7', dto)
		expect(serviceMock.create).toHaveBeenCalledWith(7, dto)
		expect(res).toEqual({ id: 10, order_id: 7, ...dto })
	})

	it('update should call service.update with numeric id and body', async () => {
		const dto: any = { paid_amount: 500, status: 'paid' }
		serviceMock.update.mockResolvedValueOnce({ id: 9, ...dto })
		const res = await controller.update('9', dto)
		expect(serviceMock.update).toHaveBeenCalledWith(9, dto)
		expect(res).toEqual({ id: 9, ...dto })
	})

	it('cancel should call service.cancel with numeric id', async () => {
		serviceMock.cancel.mockResolvedValueOnce({ id: 9, status: 'canceled' })
		const res = await controller.cancel('9')
		expect(serviceMock.cancel).toHaveBeenCalledWith(9)
		expect(res).toEqual({ id: 9, status: 'canceled' })
	})

	it('sync should call service.syncBillings', async () => {
		serviceMock.syncBillings.mockResolvedValueOnce({ created: 2, orders: ['COB-001', 'COB-002'] })
		const res = await controller.sync()
		expect(serviceMock.syncBillings).toHaveBeenCalled()
		expect(res).toEqual({ created: 2, orders: ['COB-001', 'COB-002'] })
	})

	it('findAll should pass status query param to service', async () => {
		serviceMock.findAll.mockResolvedValueOnce([{ id: 1, status: 'pending' }])
		const res = await controller.findAll('pending')
		expect(serviceMock.findAll).toHaveBeenCalledWith('pending')
		expect(res).toEqual([{ id: 1, status: 'pending' }])
	})

	it('findAll should call service.findAll without status when not given', async () => {
		serviceMock.findAll.mockResolvedValueOnce([])
		await controller.findAll(undefined)
		expect(serviceMock.findAll).toHaveBeenCalledWith(undefined)
	})

	it('remove should call service.delete with numeric id', async () => {
		serviceMock.delete.mockResolvedValueOnce(undefined)
		await controller.remove('15')
		expect(serviceMock.delete).toHaveBeenCalledWith(15)
	})

	describe('ledger routes', () => {
		it('listPayments passes the numeric id', async () => {
			serviceMock.listPayments.mockResolvedValueOnce([])
			await controller.listPayments(7)
			expect(serviceMock.listPayments).toHaveBeenCalledWith(7)
		})

		it('recordPayment forwards the body and the Idempotency-Key', async () => {
			const body = { amount: 1500, method: 'pix' as const }
			serviceMock.recordPayment.mockResolvedValueOnce({ payment: { id: 1 }, billing: { id: 7 } })

			await controller.recordPayment(7, body, 'k'.repeat(16))

			expect(serviceMock.recordPayment).toHaveBeenCalledWith(7, body, 'k'.repeat(16))
		})

		it('reversePayment forwards both ids, the reason and the key', async () => {
			serviceMock.reversePayment.mockResolvedValueOnce({ reversal: { id: 2 }, billing: { id: 7 } })

			await controller.reversePayment(7, 1, { reason: 'Duplicado' }, undefined)

			expect(serviceMock.reversePayment).toHaveBeenCalledWith(
				7,
				1,
				{ reason: 'Duplicado' },
				undefined,
			)
		})
	})
})
