/**
 * StoreSettingsController unit tests
 * Covers: GET /store/settings, PATCH /store/settings, GET /store/preview-link
 * Guards mocked: JwtAuthGuard
 */

import { ConflictException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { StoreSettingsService } from '../services/store-settings.service'
import { StoreSettingsController } from './store-settings.controller'

const serviceMock = {
	getSettings: jest.fn(),
	updateSettings: jest.fn(),
	getPreviewLink: jest.fn(),
}

function makeRequest(sub = 'user-uuid-1') {
	return { user: { sub } }
}

describe('StoreSettingsController', () => {
	let controller: StoreSettingsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [StoreSettingsController],
			providers: [{ provide: StoreSettingsService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(StoreSettingsController)
		jest.clearAllMocks()
	})

	describe('getSettings', () => {
		it('should return store settings for the current user', async () => {
			const settings = { store_slug: 'my-shop', store_name: 'My Shop' }
			serviceMock.getSettings.mockResolvedValueOnce(settings)

			const result = await controller.getSettings(makeRequest())

			expect(serviceMock.getSettings).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(settings)
		})
	})

	describe('updateSettings', () => {
		it('should update and return store settings', async () => {
			const updated = { store_slug: 'new-slug', store_name: 'New Name' }
			serviceMock.updateSettings.mockResolvedValueOnce(updated)

			const result = await controller.updateSettings(makeRequest(), {
				store_slug: 'new-slug',
				store_name: 'New Name',
			})

			expect(serviceMock.updateSettings).toHaveBeenCalledWith('user-uuid-1', {
				store_slug: 'new-slug',
				store_name: 'New Name',
			})
			expect(result).toEqual(updated)
		})

		it('should propagate ConflictException when slug is already in use', async () => {
			serviceMock.updateSettings.mockRejectedValueOnce(new ConflictException('Slug already in use'))

			await expect(
				controller.updateSettings(makeRequest(), { store_slug: 'taken-slug' }),
			).rejects.toThrow(ConflictException)
		})
	})

	describe('getPreviewLink', () => {
		it('should return the store preview link', async () => {
			const link = { url: 'https://vendinhas.app/loja/my-shop' }
			serviceMock.getPreviewLink.mockResolvedValueOnce(link)

			const result = await controller.getPreviewLink(makeRequest())

			expect(serviceMock.getPreviewLink).toHaveBeenCalledWith('user-uuid-1')
			expect(result).toEqual(link)
		})
	})
})
