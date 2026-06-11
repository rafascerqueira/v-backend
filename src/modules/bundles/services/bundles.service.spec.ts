import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { BUNDLE_REPOSITORY } from '@/shared/repositories/bundle.repository'
import { BundlesService } from './bundles.service'

const repoMock = {
	findAll: jest.fn(),
	findById: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
}

const bundle = { id: 1, seller_id: 'seller-1', name: 'Kit A', discount_percent: 10, items: [] }

describe('BundlesService', () => {
	let service: BundlesService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [BundlesService, { provide: BUNDLE_REPOSITORY, useValue: repoMock }],
		}).compile()

		service = module.get(BundlesService)
		jest.resetAllMocks()
	})

	it('findAll delegates to repository', async () => {
		repoMock.findAll.mockResolvedValueOnce([bundle])
		const result = await service.findAll()
		expect(repoMock.findAll).toHaveBeenCalled()
		expect(result).toEqual([bundle])
	})

	it('findOne returns bundle when found', async () => {
		repoMock.findById.mockResolvedValueOnce(bundle)
		const result = await service.findOne(1)
		expect(repoMock.findById).toHaveBeenCalledWith(1)
		expect(result).toEqual(bundle)
	})

	it('findOne throws NotFoundException when not found', async () => {
		repoMock.findById.mockResolvedValueOnce(null)
		await expect(service.findOne(99)).rejects.toBeInstanceOf(NotFoundException)
	})

	it('create delegates to repository with seller_id', async () => {
		repoMock.create.mockResolvedValueOnce(bundle)
		const dto = {
			name: 'Kit A',
			discount_percent: 10,
			active: true,
			items: [{ product_id: 1, quantity: 2 }],
		}
		const result = await service.create({ ...dto, seller_id: 'seller-1' })
		expect(repoMock.create).toHaveBeenCalledWith(expect.objectContaining({ seller_id: 'seller-1' }))
		expect(result).toEqual(bundle)
	})

	it('update throws NotFoundException when bundle not found', async () => {
		repoMock.findById.mockResolvedValueOnce(null)
		await expect(service.update(99, { name: 'X' })).rejects.toBeInstanceOf(NotFoundException)
	})

	it('update delegates to repository when bundle exists', async () => {
		repoMock.findById.mockResolvedValueOnce(bundle)
		repoMock.update.mockResolvedValueOnce({ ...bundle, name: 'Kit B' })
		const result = await service.update(1, { name: 'Kit B' })
		expect(repoMock.update).toHaveBeenCalledWith(1, { name: 'Kit B' })
		expect(result).toEqual({ ...bundle, name: 'Kit B' })
	})

	it('remove throws NotFoundException when bundle not found', async () => {
		repoMock.findById.mockResolvedValueOnce(null)
		await expect(service.remove(99)).rejects.toBeInstanceOf(NotFoundException)
	})

	it('remove delegates to repository when bundle exists', async () => {
		repoMock.findById.mockResolvedValueOnce(bundle)
		repoMock.delete.mockResolvedValueOnce(undefined)
		await service.remove(1)
		expect(repoMock.delete).toHaveBeenCalledWith(1)
	})
})
