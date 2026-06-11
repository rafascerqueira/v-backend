/**
 * SuppliersService unit tests
 *
 * Focus on the "check existence before mutate" pattern. Without these guards,
 * a missing supplier ID would silently create orphan debts (createDebt) or
 * the repository would throw a Prisma P2025 which gets translated to a generic
 * 404 — losing the domain-level "Supplier not found" message.
 */
import { NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import {
	SUPPLIER_REPOSITORY,
	type SupplierRepository,
} from '@/shared/repositories/supplier.repository'
import { SuppliersService } from './suppliers.service'

const repo: jest.Mocked<SupplierRepository> = {
	findAll: jest.fn(),
	findById: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
	findDebts: jest.fn(),
	createDebt: jest.fn(),
	payDebt: jest.fn(),
}

describe('SuppliersService', () => {
	let service: SuppliersService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [SuppliersService, { provide: SUPPLIER_REPOSITORY, useValue: repo }],
		}).compile()
		service = module.get(SuppliersService)
		jest.clearAllMocks()
	})

	describe('findOne', () => {
		it('returns the supplier when found', async () => {
			const supplier = { id: 'sup-1' } as never
			repo.findById.mockResolvedValueOnce(supplier)
			await expect(service.findOne('sup-1')).resolves.toBe(supplier)
		})

		it('throws NotFound when missing', async () => {
			repo.findById.mockResolvedValueOnce(null)
			await expect(service.findOne('missing')).rejects.toThrow(NotFoundException)
		})
	})

	describe('create', () => {
		it('delegates to repository with the payload', async () => {
			const payload = { seller_id: 'seller-1', name: 'ACME' }
			repo.create.mockResolvedValueOnce({ id: 'sup-1' } as never)

			await service.create(payload as never)

			expect(repo.create).toHaveBeenCalledWith(payload)
		})
	})

	describe('update', () => {
		it('checks existence before updating', async () => {
			repo.findById.mockResolvedValueOnce(null)

			await expect(service.update('missing', { name: 'New' })).rejects.toThrow(NotFoundException)
			expect(repo.update).not.toHaveBeenCalled()
		})

		it('forwards to repo when supplier exists', async () => {
			repo.findById.mockResolvedValueOnce({ id: 'sup-1' } as never)
			repo.update.mockResolvedValueOnce({ id: 'sup-1', name: 'New' } as never)

			const result = await service.update('sup-1', { name: 'New' })

			expect(repo.update).toHaveBeenCalledWith('sup-1', { name: 'New' })
			expect(result).toEqual({ id: 'sup-1', name: 'New' })
		})
	})

	describe('remove', () => {
		it('checks existence before deleting (avoid silent no-op on bad id)', async () => {
			repo.findById.mockResolvedValueOnce(null)

			await expect(service.remove('missing')).rejects.toThrow(NotFoundException)
			expect(repo.delete).not.toHaveBeenCalled()
		})

		it('deletes when supplier exists', async () => {
			repo.findById.mockResolvedValueOnce({ id: 'sup-1' } as never)
			repo.delete.mockResolvedValueOnce(undefined)

			await service.remove('sup-1')

			expect(repo.delete).toHaveBeenCalledWith('sup-1')
		})
	})

	describe('createDebt', () => {
		it('refuses to create an orphan debt when supplier does not exist', async () => {
			repo.findById.mockResolvedValueOnce(null)

			await expect(
				service.createDebt('missing', { amount: 1000, description: 'x' }),
			).rejects.toThrow(NotFoundException)
			expect(repo.createDebt).not.toHaveBeenCalled()
		})

		it('forwards to repo when supplier exists', async () => {
			repo.findById.mockResolvedValueOnce({ id: 'sup-1' } as never)
			repo.createDebt.mockResolvedValueOnce({ id: 1 } as never)

			await service.createDebt('sup-1', { amount: 1000, description: 'invoice 42' })

			expect(repo.createDebt).toHaveBeenCalledWith('sup-1', {
				amount: 1000,
				description: 'invoice 42',
			})
		})
	})

	describe('payDebt', () => {
		it('passes the amount through to the repository (operates on debtId, not supplier)', async () => {
			repo.payDebt.mockResolvedValueOnce({ id: 7 } as never)

			await service.payDebt(7, { amount: 250 })

			expect(repo.payDebt).toHaveBeenCalledWith(7, 250)
		})
	})

	describe('findAll / findDebts', () => {
		it('findAll delegates without preconditions', async () => {
			repo.findAll.mockResolvedValueOnce([])
			await expect(service.findAll()).resolves.toEqual([])
		})

		it('findDebts delegates without preconditions (returns empty for nonexistent supplier)', async () => {
			repo.findDebts.mockResolvedValueOnce([])
			await expect(service.findDebts('whatever')).resolves.toEqual([])
		})
	})
})
