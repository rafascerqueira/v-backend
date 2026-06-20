import { Test } from '@nestjs/testing'
import { QueueProducer } from '@/shared/queue/queue.producer'
import { ORDER_REPOSITORY } from '@/shared/repositories/order.repository'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { CustomersService } from '../../customers/services/customers.service'
import { OrdersService } from './orders.service'

const repositoryMock = {
	create: jest.fn(),
	addItem: jest.fn(),
	findById: jest.fn(),
	findAll: jest.fn(),
	updateStatus: jest.fn(),
	delete: jest.fn(),
}

const queueProducerMock = {
	createNotification: jest.fn(),
}

const tenantContextMock = {
	getSellerId: jest.fn().mockReturnValue('test-seller-id'),
	requireSellerId: jest.fn().mockReturnValue('test-seller-id'),
	isAdmin: jest.fn().mockReturnValue(false),
}

const customersServiceMock = {
	findOne: jest.fn().mockResolvedValue({ billing_mode: 'monthly', billing_day: 5 }),
}

describe('OrdersService', () => {
	let service: OrdersService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				OrdersService,
				{ provide: ORDER_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: CustomersService, useValue: customersServiceMock },
				{ provide: QueueProducer, useValue: queueProducerMock },
			],
		}).compile()

		service = module.get(OrdersService)
		jest.clearAllMocks()
	})

	it('create should compute totals and delegate to repository', async () => {
		const dto = {
			customer_id: 'cuid123',
			order_number: 'ORD-1',
			items: [
				{ product_id: 1, quantity: 2, unit_price: 1000, discount: 0 },
				{ product_id: 2, quantity: 1, unit_price: 500, discount: 100 },
			],
		}
		repositoryMock.create.mockResolvedValueOnce({ order: { id: 1 }, oversold: [] })
		customersServiceMock.findOne.mockResolvedValueOnce({ billing_mode: 'monthly', billing_day: 5 })

		const res = await service.create(dto as any)

		expect(repositoryMock.create).toHaveBeenCalled()
		const call = repositoryMock.create.mock.calls[0][0]
		expect(call.subtotal).toBe(2500)
		expect(call.discount).toBe(100)
		expect(call.total).toBe(2400)
		expect(call.items).toHaveLength(2)
		expect(call.seller_id).toBe('test-seller-id')
		expect(res).toEqual({ id: 1 })
		// monthly customer — no per_sale charge attached (periodic mode handled by sync)
		expect(call.billing).toBeUndefined()
	})

	it('create should attach a per_sale charge to the order payload', async () => {
		const dto = {
			customer_id: 'cuid-ps',
			order_number: 'ORD-100',
			items: [{ product_id: 1, quantity: 1, unit_price: 5000, discount: 0 }],
		}
		repositoryMock.create.mockResolvedValueOnce({ order: { id: 10 }, oversold: [] })
		customersServiceMock.findOne.mockResolvedValueOnce({
			billing_mode: 'per_sale',
			billing_day: null,
		})

		await service.create(dto as any)

		// The charge now rides along in the SAME create() call so the repository can
		// persist it atomically — it is no longer a separate, swallow-on-error call.
		const call = repositoryMock.create.mock.calls[0][0]
		expect(call.billing).toEqual(
			expect.objectContaining({
				billing_number: 'COB-100',
				total_amount: 5000,
				paid_amount: 0,
				payment_method: 'cash',
				payment_status: 'pending',
				status: 'pending',
			}),
		)
		// per_sale: the sale date is the due date — never a null that renders as 01/01/1970
		expect(call.billing.due_date).toBeInstanceOf(Date)
	})

	it('clamps a line discount that exceeds the line value so totals never go negative', async () => {
		const dto = {
			customer_id: 'cuid-clamp',
			order_number: 'ORD-CLAMP',
			items: [{ product_id: 1, quantity: 2, unit_price: 1000, discount: 5000 }],
		}
		repositoryMock.create.mockResolvedValueOnce({ order: { id: 99 }, oversold: [] })
		customersServiceMock.findOne.mockResolvedValueOnce({ billing_mode: 'monthly', billing_day: 5 })

		await service.create(dto as any)

		const call = repositoryMock.create.mock.calls[0][0]
		// line value = 1000 * 2 = 2000; discount clamped from 5000 down to 2000
		expect(call.subtotal).toBe(2000)
		expect(call.discount).toBe(2000)
		expect(call.total).toBe(0)
		expect(call.items[0].discount).toBe(2000)
		expect(call.items[0].total).toBe(0)
	})

	it('notifies the seller for each item sold past its stock (allow_oversell)', async () => {
		const dto = {
			customer_id: 'cuid123',
			order_number: 'ORD-7',
			items: [{ product_id: 9, quantity: 5, unit_price: 1000, discount: 0 }],
		}
		repositoryMock.create.mockResolvedValueOnce({
			order: { id: 7 },
			oversold: [{ product_id: 9, product_name: 'Camiseta', available: 1, requested: 5 }],
		})
		customersServiceMock.findOne.mockResolvedValueOnce({ billing_mode: 'monthly', billing_day: 5 })

		await service.create(dto as any)

		expect(queueProducerMock.createNotification).toHaveBeenCalledTimes(1)
		expect(queueProducerMock.createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'test-seller-id',
				type: 'warning',
				data: expect.objectContaining({ productId: 9, available: 1, requested: 5 }),
			}),
		)
	})

	it('does not notify when nothing was oversold', async () => {
		const dto = {
			customer_id: 'cuid123',
			order_number: 'ORD-8',
			items: [{ product_id: 1, quantity: 1, unit_price: 1000, discount: 0 }],
		}
		repositoryMock.create.mockResolvedValueOnce({ order: { id: 8 }, oversold: [] })
		customersServiceMock.findOne.mockResolvedValueOnce({ billing_mode: 'monthly', billing_day: 5 })

		await service.create(dto as any)

		expect(queueProducerMock.createNotification).not.toHaveBeenCalled()
	})

	it('addItem should compute total and delegate to repository', async () => {
		repositoryMock.addItem.mockResolvedValueOnce({ id: 10 })
		const res = await service.addItem(1, {
			product_id: 3,
			quantity: 2,
			unit_price: 300,
			discount: 50,
		} as any)
		expect(repositoryMock.addItem).toHaveBeenCalledWith({
			order_id: 1,
			product_id: 3,
			quantity: 2,
			unit_price: 300,
			discount: 50,
			total: 550,
		})
		expect(res).toEqual({ id: 10 })
	})

	it('addItem clamps a discount that exceeds the line value', async () => {
		repositoryMock.addItem.mockResolvedValueOnce({ id: 11 })
		await service.addItem(1, {
			product_id: 3,
			quantity: 1,
			unit_price: 300,
			discount: 9999,
		} as any)
		expect(repositoryMock.addItem).toHaveBeenCalledWith({
			order_id: 1,
			product_id: 3,
			quantity: 1,
			unit_price: 300,
			discount: 300,
			total: 0,
		})
	})

	it('findById delegates to repository', async () => {
		repositoryMock.findById.mockResolvedValueOnce({ id: 1, seller_id: 'test-seller-id' })
		const res = await service.findById(1)
		expect(repositoryMock.findById).toHaveBeenCalledWith(1)
		expect(res).toEqual({ id: 1, seller_id: 'test-seller-id' })
	})

	it('findAll delegates to repository', async () => {
		repositoryMock.findAll.mockResolvedValueOnce([{ id: 1 }])
		const res = await service.findAll()
		expect(repositoryMock.findAll).toHaveBeenCalledWith({})
		expect(res).toEqual([{ id: 1 }])
	})

	it('updateStatus canceled should propagate cancellation to billing', async () => {
		repositoryMock.updateStatus.mockResolvedValueOnce({ id: 3, status: 'canceled' })

		await service.updateStatus(3, 'canceled')

		expect(repositoryMock.updateStatus).toHaveBeenCalledWith(3, 'canceled', {
			status: 'canceled',
			payment_status: 'canceled',
		})
	})

	it('updateStatus delivered should NOT auto-mark billing as paid', async () => {
		repositoryMock.updateStatus.mockResolvedValueOnce({ id: 4, status: 'delivered' })

		await service.updateStatus(4, 'delivered')

		expect(repositoryMock.updateStatus).toHaveBeenCalledWith(4, 'delivered', undefined)
	})

	it('delete delegates to repository (tenant/404 enforced in the repo)', async () => {
		repositoryMock.delete.mockResolvedValueOnce({ id: 5 })
		const res = await service.delete(5)
		expect(repositoryMock.delete).toHaveBeenCalledWith(5)
		expect(res).toEqual({ id: 5 })
	})
})
