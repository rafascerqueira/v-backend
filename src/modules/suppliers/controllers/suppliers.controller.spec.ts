import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { SuppliersService } from '../services/suppliers.service'
import { SuppliersController } from './suppliers.controller'

const serviceMock = {
	findAll: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	remove: jest.fn(),
	findDebts: jest.fn(),
	createDebt: jest.fn(),
	payDebt: jest.fn(),
}

describe('SuppliersController', () => {
	let controller: SuppliersController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [SuppliersController],
			providers: [{ provide: SuppliersService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(SuppliersController)
		jest.clearAllMocks()
	})

	it('findAll delegates to the service', async () => {
		serviceMock.findAll.mockResolvedValueOnce([{ id: 's1' }])
		expect(await controller.findAll()).toEqual([{ id: 's1' }])
	})

	it('create injects the authenticated seller_id', async () => {
		const body: any = { name: 'ACME', email: 'acme@x.com' }
		serviceMock.create.mockResolvedValueOnce({ id: 's1' })

		await controller.create(body, { user: { sub: 'seller-1' } })

		expect(serviceMock.create).toHaveBeenCalledWith({ ...body, seller_id: 'seller-1' })
	})

	it('update delegates with the id and partial body', async () => {
		const body: any = { name: 'New name' }
		serviceMock.update.mockResolvedValueOnce({ id: 's1', ...body })
		await controller.update('s1', body)
		expect(serviceMock.update).toHaveBeenCalledWith('s1', body)
	})

	it('remove delegates to the service', async () => {
		serviceMock.remove.mockResolvedValueOnce(undefined)
		await controller.remove('s1')
		expect(serviceMock.remove).toHaveBeenCalledWith('s1')
	})

	it('findDebts delegates with the supplier id', async () => {
		serviceMock.findDebts.mockResolvedValueOnce([{ id: 1 }])
		expect(await controller.findDebts('s1')).toEqual([{ id: 1 }])
		expect(serviceMock.findDebts).toHaveBeenCalledWith('s1')
	})

	it('createDebt delegates with the supplier id and body', async () => {
		const body: any = { amount: 5000, description: 'stock' }
		serviceMock.createDebt.mockResolvedValueOnce({ id: 1 })
		await controller.createDebt('s1', body)
		expect(serviceMock.createDebt).toHaveBeenCalledWith('s1', body)
	})

	it('payDebt coerces the debt id to a number', async () => {
		const body: any = { amount: 5000 }
		serviceMock.payDebt.mockResolvedValueOnce({ id: 1, paid: true })
		await controller.payDebt('9', body)
		expect(serviceMock.payDebt).toHaveBeenCalledWith(9, body)
	})
})
