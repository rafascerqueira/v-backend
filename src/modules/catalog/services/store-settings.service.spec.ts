/**
 * StoreSettingsService unit tests
 * Covers: getSettings, updateSettings, updateStoreLogo, updateStoreBanner, getPreviewLink
 * Verifies: not-found errors, slug conflict detection, catalog URL construction, slug suggestion
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import {
	STORE_SETTINGS_REPOSITORY,
	type StoreSettingsRepository,
} from '@/shared/repositories/store-settings.repository'
import { StoreSettingsService } from './store-settings.service'

const repositoryMock: jest.Mocked<StoreSettingsRepository> = {
	findByAccountId: jest.fn(),
	findSlugConflict: jest.fn(),
	updateSettings: jest.fn(),
	updateLogo: jest.fn(),
	updateBanner: jest.fn(),
	findSlugAndName: jest.fn(),
}

const configServiceMock = {
	get: jest.fn((key: string, def?: unknown) => {
		if (key === 'frontendUrl') return 'http://localhost:3000'
		return def
	}),
}

describe('StoreSettingsService', () => {
	let service: StoreSettingsService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				StoreSettingsService,
				{ provide: STORE_SETTINGS_REPOSITORY, useValue: repositoryMock },
				{ provide: ConfigService, useValue: configServiceMock },
			],
		}).compile()

		service = module.get(StoreSettingsService)
		jest.clearAllMocks()
	})

	describe('getSettings', () => {
		it('should return store settings with catalog URL when slug exists', async () => {
			repositoryMock.findByAccountId.mockResolvedValueOnce({
				id: 'seller-1',
				name: 'My Store',
				store_slug: 'mystore',
				store_name: 'My Store Name',
				store_description: 'Desc',
				store_logo: null,
				store_banner: null,
				store_phone: null,
				store_whatsapp: null,
			} as any)
			repositoryMock.findSlugConflict.mockResolvedValue(false)

			const result = await service.getSettings('seller-1')

			expect(result.slug).toBe('mystore')
			expect(result.catalogUrl).toBe('http://localhost:3000/loja/mystore')
			expect(result.slugSuggestion).toMatch(/^[a-z0-9-]+$/)
		})

		it('should return null catalogUrl when no slug', async () => {
			repositoryMock.findByAccountId.mockResolvedValueOnce({
				id: 'seller-1',
				name: 'My Store',
				store_slug: null,
				store_name: null,
				store_description: null,
				store_logo: null,
				store_banner: null,
				store_phone: null,
				store_whatsapp: null,
			} as any)
			repositoryMock.findSlugConflict.mockResolvedValue(false)

			const result = await service.getSettings('seller-1')

			expect(result.catalogUrl).toBeNull()
			expect(result.slugSuggestion).toBe('my-store')
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findByAccountId.mockResolvedValueOnce(null)

			await expect(service.getSettings('unknown')).rejects.toThrow(NotFoundException)
		})
	})

	describe('updateSettings', () => {
		it('should update and return settings with catalog URL', async () => {
			repositoryMock.findSlugConflict.mockResolvedValueOnce(false)
			repositoryMock.updateSettings.mockResolvedValueOnce({
				id: 'seller-1',
				store_slug: 'newslug',
				store_name: 'New Name',
				store_description: null,
				store_phone: null,
				store_whatsapp: null,
			} as any)

			const result = await service.updateSettings('seller-1', {
				store_slug: 'newslug',
				store_name: 'New Name',
			})

			expect(repositoryMock.updateSettings).toHaveBeenCalled()
			expect(result.catalogUrl).toBe('http://localhost:3000/loja/newslug')
		})

		it('should throw ConflictException when slug is already taken', async () => {
			repositoryMock.findSlugConflict.mockResolvedValueOnce(true)

			await expect(
				service.updateSettings('seller-1', { store_slug: 'taken-slug' }),
			).rejects.toThrow(ConflictException)

			expect(repositoryMock.updateSettings).not.toHaveBeenCalled()
		})

		it('should throw BadRequestException when slug is reserved', async () => {
			await expect(service.updateSettings('seller-1', { store_slug: 'admin' })).rejects.toThrow(
				BadRequestException,
			)

			expect(repositoryMock.findSlugConflict).not.toHaveBeenCalled()
			expect(repositoryMock.updateSettings).not.toHaveBeenCalled()
		})

		it('should reject reserved slug regardless of casing', async () => {
			await expect(service.updateSettings('seller-1', { store_slug: 'Admin' })).rejects.toThrow(
				BadRequestException,
			)
		})

		it('should not check slug conflict when slug is not in update data', async () => {
			repositoryMock.updateSettings.mockResolvedValueOnce({
				id: 'seller-1',
				store_slug: 'existing-slug',
				store_name: 'Updated Name',
				store_description: null,
				store_phone: null,
				store_whatsapp: null,
			} as any)

			await service.updateSettings('seller-1', { store_name: 'Updated Name' })

			expect(repositoryMock.findSlugConflict).not.toHaveBeenCalled()
		})
	})

	describe('updateStoreLogo', () => {
		it('should delegate to repository', async () => {
			repositoryMock.updateLogo.mockResolvedValueOnce({ store_logo: 'https://cdn/logo.png' })

			const result = await service.updateStoreLogo('seller-1', 'https://cdn/logo.png')

			expect(repositoryMock.updateLogo).toHaveBeenCalledWith('seller-1', 'https://cdn/logo.png')
			expect(result.store_logo).toBe('https://cdn/logo.png')
		})
	})

	describe('updateStoreBanner', () => {
		it('should delegate to repository', async () => {
			repositoryMock.updateBanner.mockResolvedValueOnce({ store_banner: 'https://cdn/banner.png' })

			const result = await service.updateStoreBanner('seller-1', 'https://cdn/banner.png')

			expect(repositoryMock.updateBanner).toHaveBeenCalledWith('seller-1', 'https://cdn/banner.png')
		})
	})

	describe('getPreviewLink', () => {
		it('should return catalog URL when slug is set', async () => {
			repositoryMock.findSlugAndName.mockResolvedValueOnce({
				store_slug: 'mystore',
				store_name: null,
				name: 'My Store',
			})

			const result = await service.getPreviewLink('seller-1')

			expect(result.hasSlug).toBe(true)
			expect(result.catalogUrl).toBe('http://localhost:3000/loja/mystore')
			expect(result.suggestion).toBeNull()
		})

		it('should return slug suggestion when no slug is set', async () => {
			repositoryMock.findSlugAndName.mockResolvedValueOnce({
				store_slug: null,
				store_name: null,
				name: 'Loja da Maria',
			})
			repositoryMock.findSlugConflict.mockResolvedValue(false)

			const result = await service.getPreviewLink('seller-1')

			expect(result.hasSlug).toBe(false)
			expect(result.catalogUrl).toBeNull()
			expect(result.suggestion).toBeTruthy()
			expect(result.suggestion).toMatch(/^[a-z0-9-]+$/)
		})

		it('should prefer store_name over personal name for suggestion', async () => {
			repositoryMock.findSlugAndName.mockResolvedValueOnce({
				store_slug: null,
				store_name: 'Loja dos Namorados',
				name: 'Rafael Cerqueira',
			})
			repositoryMock.findSlugConflict.mockResolvedValue(false)

			const result = await service.getPreviewLink('seller-1')

			expect(result.suggestion).toBe('loja-dos-namorados')
		})

		it('should append numeric suffix when suggestion collides', async () => {
			repositoryMock.findSlugAndName.mockResolvedValueOnce({
				store_slug: null,
				store_name: null,
				name: 'Joao Silva',
			})
			repositoryMock.findSlugConflict
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(true)
				.mockResolvedValueOnce(false)

			const result = await service.getPreviewLink('seller-1')

			expect(result.suggestion).toBe('joao-silva-3')
		})

		it('should throw NotFoundException when account not found', async () => {
			repositoryMock.findSlugAndName.mockResolvedValueOnce(null)

			await expect(service.getPreviewLink('unknown')).rejects.toThrow(NotFoundException)
		})
	})
})
