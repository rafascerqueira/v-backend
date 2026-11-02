import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { OutboxRelayService } from '@/shared/events/outbox-relay.service'
import { STOCK_MOVEMENT_REPOSITORY } from '@/shared/repositories/stock-movement.repository'
import { StockMovementsService } from './stock-movements.service'

const repositoryMock = {
	findByProduct: jest.fn(),
	create: jest.fn(),
	adjustTo: jest.fn(),
}

const outboxMock = { kick: jest.fn(), relayPending: jest.fn() }

const dto = {
	movement_type: 'in' as const,
	reference_type: 'purchase' as const,
	reference_id: 1,
	product_id: 7,
	quantity: 5,
}

describe('StockMovementsService', () => {
	let service: StockMovementsService

	beforeEach(async () => {
		jest.resetAllMocks()
		const module = await Test.createTestingModule({
			providers: [
				StockMovementsService,
				{ provide: STOCK_MOVEMENT_REPOSITORY, useValue: repositoryMock },
				{ provide: OutboxRelayService, useValue: outboxMock },
			],
		}).compile()

		service = module.get(StockMovementsService)
	})

	it('listByProduct should delegate to repository', async () => {
		repositoryMock.findByProduct.mockResolvedValueOnce([])
		await expect(service.listByProduct(10)).resolves.toEqual([])
		expect(repositoryMock.findByProduct).toHaveBeenCalledWith(10)
	})

	it('create returns the movement and kicks the relay (notifications follow from stock.moved)', async () => {
		repositoryMock.create.mockResolvedValueOnce({
			movement: { id: 2, product_id: 7 },
			fulfilled: [{ order_id: 42, order_number: 'PED-000042' }],
		})

		const res = await service.create(dto)

		expect(repositoryMock.create).toHaveBeenCalledWith(dto)
		expect(res).toEqual({ id: 2, product_id: 7 })
		expect(outboxMock.kick).toHaveBeenCalledTimes(1)
	})

	it('create propagates repository errors (insufficient stock / product not found)', async () => {
		repositoryMock.create.mockRejectedValueOnce(new BadRequestException('Insufficient stock'))
		await expect(service.create({ ...dto, movement_type: 'out' })).rejects.toBeInstanceOf(
			BadRequestException,
		)
		expect(outboxMock.kick).not.toHaveBeenCalled()
	})

	it('adjustTo records the adjustment and kicks the relay; a no-op returns null', async () => {
		repositoryMock.adjustTo
			.mockResolvedValueOnce({ movement: { id: 3 }, fulfilled: [] })
			.mockResolvedValueOnce(null)

		await expect(service.adjustTo(7, 4)).resolves.toEqual({ id: 3 })
		await expect(service.adjustTo(7, 4)).resolves.toBeNull()

		expect(repositoryMock.adjustTo).toHaveBeenCalledWith(7, 4)
		expect(outboxMock.kick).toHaveBeenCalledTimes(1)
	})
})
