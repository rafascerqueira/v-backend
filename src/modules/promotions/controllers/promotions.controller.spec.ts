import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { PromotionsService } from '../services/promotions.service'
import { PromotionsController } from './promotions.controller'

const serviceMock = {
	findAll: jest.fn(),
	create: jest.fn(),
	end: jest.fn(),
}

describe('PromotionsController', () => {
	let controller: PromotionsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [PromotionsController],
			providers: [{ provide: PromotionsService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(PromotionsController)
		jest.clearAllMocks()
	})

	it('findAll delegates to the service', async () => {
		serviceMock.findAll.mockResolvedValueOnce([{ id: 1 }])
		expect(await controller.findAll()).toEqual([{ id: 1 }])
		expect(serviceMock.findAll).toHaveBeenCalled()
	})

	it('create injects the authenticated seller_id from the token', async () => {
		const body: any = { name: 'Black Friday', discount_percent: 10 }
		serviceMock.create.mockResolvedValueOnce({ id: 1 })

		await controller.create(body, { user: { sub: 'seller-1' } })

		expect(serviceMock.create).toHaveBeenCalledWith({ ...body, seller_id: 'seller-1' })
	})

	it('end coerces the id to a number', async () => {
		serviceMock.end.mockResolvedValueOnce({ id: 3, ended: true })
		await controller.end('3')
		expect(serviceMock.end).toHaveBeenCalledWith(3)
	})
})
