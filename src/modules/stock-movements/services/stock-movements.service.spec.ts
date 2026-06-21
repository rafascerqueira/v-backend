import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { QueueProducer } from '@/shared/queue/queue.producer'
import { STOCK_MOVEMENT_REPOSITORY } from '@/shared/repositories/stock-movement.repository'
import { StockMovementsService } from './stock-movements.service'

const repositoryMock = {
	findByProduct: jest.fn(),
	create: jest.fn(),
}

const queueMock = {
	createNotification: jest.fn(),
}

describe('StockMovementsService', () => {
	let service: StockMovementsService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				StockMovementsService,
				{ provide: STOCK_MOVEMENT_REPOSITORY, useValue: repositoryMock },
				{ provide: QueueProducer, useValue: queueMock },
			],
		}).compile()

		service = module.get(StockMovementsService)
		jest.clearAllMocks()
	})

	it('listByProduct should delegate to repository', async () => {
		repositoryMock.findByProduct.mockResolvedValueOnce([])
		const res = await service.listByProduct(10)
		expect(repositoryMock.findByProduct).toHaveBeenCalledWith(10)
		expect(res).toEqual([])
	})

	it('create returns the movement and notifies nothing when no backorder was fulfilled', async () => {
		const dto = {
			movement_type: 'in' as const,
			reference_type: 'purchase' as const,
			reference_id: 1,
			product_id: 1,
			quantity: 5,
		}
		repositoryMock.create.mockResolvedValueOnce({
			movement: { id: 1, product_id: 1 },
			fulfilled: [],
		})

		const res = await service.create(dto)

		expect(repositoryMock.create).toHaveBeenCalledWith(dto)
		expect(res).toEqual({ id: 1, product_id: 1 })
		expect(queueMock.createNotification).not.toHaveBeenCalled()
	})

	it('create enqueues a "ready to finalize" notification for each fulfilled order', async () => {
		repositoryMock.create.mockResolvedValueOnce({
			movement: { id: 2, product_id: 7 },
			fulfilled: [
				{
					seller_id: 'seller-1',
					order_id: 42,
					order_number: 'PED-001',
					product_id: 7,
					product_name: 'Camiseta',
					quantity: 3,
				},
			],
		})

		await service.create({
			movement_type: 'in' as const,
			reference_type: 'purchase' as const,
			reference_id: 1,
			product_id: 7,
			quantity: 5,
		})

		expect(queueMock.createNotification).toHaveBeenCalledTimes(1)
		expect(queueMock.createNotification).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'seller-1',
				type: 'success',
				data: expect.objectContaining({ orderId: 42, orderNumber: 'PED-001', quantity: 3 }),
			}),
		)
	})

	it('create should propagate repository errors (insufficient stock)', async () => {
		repositoryMock.create.mockRejectedValueOnce(new BadRequestException('Insufficient stock'))
		await expect(
			service.create({
				movement_type: 'out' as const,
				reference_type: 'sale' as const,
				reference_id: 3,
				product_id: 1,
				quantity: 5,
			}),
		).rejects.toBeInstanceOf(BadRequestException)
	})

	it('create should propagate repository errors (product not found)', async () => {
		repositoryMock.create.mockRejectedValueOnce(new BadRequestException('Product not found'))
		await expect(
			service.create({
				movement_type: 'in' as const,
				reference_type: 'purchase' as const,
				reference_id: 4,
				product_id: 9,
				quantity: 1,
			}),
		).rejects.toBeInstanceOf(BadRequestException)
	})
})
