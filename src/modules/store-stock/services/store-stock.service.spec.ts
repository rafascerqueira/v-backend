import { Test } from '@nestjs/testing'
import { StockMovementsService } from '@/modules/stock-movements/services/stock-movements.service'
import { STORE_STOCK_REPOSITORY } from '@/shared/repositories/store-stock.repository'
import { StoreStockService } from './store-stock.service'

const repositoryMock = {
	findAll: jest.fn(),
	findByProduct: jest.fn(),
	upsert: jest.fn(),
}

const stockMovementsMock = { adjustTo: jest.fn() }

describe('StoreStockService', () => {
	let service: StoreStockService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				StoreStockService,
				{ provide: STORE_STOCK_REPOSITORY, useValue: repositoryMock },
				{ provide: StockMovementsService, useValue: stockMovementsMock },
			],
		}).compile()

		service = module.get(StoreStockService)
		jest.clearAllMocks()
	})

	it('getByProduct should delegate to repository', async () => {
		repositoryMock.findByProduct.mockResolvedValueOnce({ product_id: 1, quantity: 5 })
		const res = await service.getByProduct(1)
		expect(repositoryMock.findByProduct).toHaveBeenCalledWith(1)
		expect(res).toEqual({ product_id: 1, quantity: 5 })
	})

	it('upsert turns a quantity change into an adjustment movement, never an absolute write', async () => {
		repositoryMock.upsert.mockResolvedValueOnce({ product_id: 2, quantity: 10, min_stock: 3 })

		const res = await service.upsert(2, { quantity: 10, min_stock: 3 })

		expect(stockMovementsMock.adjustTo).toHaveBeenCalledWith(2, 10)
		expect(repositoryMock.upsert).toHaveBeenCalledWith(2, { min_stock: 3 })
		expect(stockMovementsMock.adjustTo.mock.invocationCallOrder[0]).toBeLessThan(
			repositoryMock.upsert.mock.invocationCallOrder[0],
		)
		expect(res).toEqual({ product_id: 2, quantity: 10, min_stock: 3 })
	})

	it('upsert without a quantity only saves the settings', async () => {
		repositoryMock.upsert.mockResolvedValueOnce({ product_id: 2, min_stock: 1 })

		await service.upsert(2, { min_stock: 1 })

		expect(stockMovementsMock.adjustTo).not.toHaveBeenCalled()
		expect(repositoryMock.upsert).toHaveBeenCalledWith(2, { min_stock: 1 })
	})

	it('findAll should delegate to repository', async () => {
		repositoryMock.findAll.mockResolvedValueOnce([])
		const res = await service.findAll()
		expect(repositoryMock.findAll).toHaveBeenCalledWith({})
		expect(res).toEqual([])
	})
})
