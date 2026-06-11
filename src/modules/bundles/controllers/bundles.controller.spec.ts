import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { BundlesService } from '../services/bundles.service'
import { BundlesController } from './bundles.controller'

const serviceMock = {
	findAll: jest.fn(),
	findOne: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	remove: jest.fn(),
}

const req = { user: { sub: 'seller-1' } }
const bundle = { id: 1, seller_id: 'seller-1', name: 'Kit A', discount_percent: 10, items: [] }

describe('BundlesController', () => {
	let controller: BundlesController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [BundlesController],
			providers: [{ provide: BundlesService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(BundlesController)
		jest.resetAllMocks()
	})

	it('findAll should return all bundles', async () => {
		serviceMock.findAll.mockResolvedValueOnce([bundle])
		const result = await controller.findAll()
		expect(serviceMock.findAll).toHaveBeenCalled()
		expect(result).toEqual([bundle])
	})

	it('findOne should call service with numeric id', async () => {
		serviceMock.findOne.mockResolvedValueOnce(bundle)
		const result = await controller.findOne('1')
		expect(serviceMock.findOne).toHaveBeenCalledWith(1)
		expect(result).toEqual(bundle)
	})

	it('create should attach seller_id from request user', async () => {
		serviceMock.create.mockResolvedValueOnce(bundle)
		const dto: any = {
			name: 'Kit A',
			discount_percent: 10,
			active: true,
			items: [{ product_id: 1, quantity: 1 }],
		}
		const result = await controller.create(dto, req)
		expect(serviceMock.create).toHaveBeenCalledWith({ ...dto, seller_id: 'seller-1' })
		expect(result).toEqual(bundle)
	})

	it('update should call service with numeric id and body', async () => {
		serviceMock.update.mockResolvedValueOnce({ ...bundle, name: 'Kit B' })
		const result = await controller.update('1', { name: 'Kit B' })
		expect(serviceMock.update).toHaveBeenCalledWith(1, { name: 'Kit B' })
		expect(result).toEqual({ ...bundle, name: 'Kit B' })
	})

	it('remove should call service with numeric id', async () => {
		serviceMock.remove.mockResolvedValueOnce(undefined)
		await controller.remove('1')
		expect(serviceMock.remove).toHaveBeenCalledWith(1)
	})
})
