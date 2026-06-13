import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { CatalogService } from '../services/catalog.service'
import { CustomerInviteController } from './customer-invite.controller'

const serviceMock = {
	createCustomerPasswordInvite: jest.fn(),
}

describe('CustomerInviteController', () => {
	let controller: CustomerInviteController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [CustomerInviteController],
			providers: [{ provide: CatalogService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(CustomerInviteController)
		jest.clearAllMocks()
	})

	it('scopes the invite to the authenticated seller (req.user.sub), never the caller-supplied body', async () => {
		serviceMock.createCustomerPasswordInvite.mockResolvedValueOnce({
			token: 't',
			link: 'https://x/y',
			isReset: false,
		})

		const res = await controller.createInvite({ user: { sub: 'seller-1' } }, 'customer-9')

		// The seller is taken from the verified token, so one seller can never mint an
		// invite for a customer that belongs to another seller's store.
		expect(serviceMock.createCustomerPasswordInvite).toHaveBeenCalledWith('seller-1', 'customer-9')
		expect(res.isReset).toBe(false)
	})
})
