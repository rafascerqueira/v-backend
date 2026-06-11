/**
 * CatalogService unit tests
 * Covers: getStoreBySlug, getStoreProducts, getStoreProductById, getProducts,
 *         getProductById, getCustomerById, createOrder
 * Verifies: not-found errors, product-price-stock assembly, multi-seller rejection,
 *           customer find-or-create, order total calculation (integers)
 */
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { TokenService } from '@/modules/auth/services/token.service'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import { QueueProducer } from '@/shared/queue/queue.producer'
import { RedisService } from '@/shared/redis/redis.service'
import {
	CATALOG_REPOSITORY,
	type CatalogRepository,
} from '@/shared/repositories/catalog.repository'
import { CatalogService } from './catalog.service'

const repositoryMock: jest.Mocked<CatalogRepository> = {
	findStoreBySlug: jest.fn(),
	findStoreIdBySlug: jest.fn(),
	findActiveProducts: jest.fn(),
	findActiveProductById: jest.fn(),
	findActiveProductBySeller: jest.fn(),
	findActivePrices: jest.fn(),
	findLatestPrice: jest.fn(),
	findActivePromotions: jest.fn().mockResolvedValue([]),
	findStocks: jest.fn(),
	findStockByProduct: jest.fn(),
	findCustomerById: jest.fn(),
	findCustomerWithHashById: jest.fn(),
	findCustomerByEmailOrPhone: jest.fn(),
	updateCustomerPasswordHash: jest.fn(),
	findCustomerByContact: jest.fn(),
	createCustomer: jest.fn(),
	findLastOrderId: jest.fn(),
	createOrderWithItems: jest.fn(),
	findOrderByNumber: jest.fn(),
}

const makeProduct = (id: number, sellerId = 'seller-1') => ({
	id,
	seller_id: sellerId,
	name: `Product ${id}`,
	description: null,
	category: 'Electronics',
	brand: null,
	unit: 'piece',
	images: [],
	active: true,
	deletedAt: null,
})

describe('CatalogService', () => {
	let service: CatalogService

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				CatalogService,
				{ provide: CATALOG_REPOSITORY, useValue: repositoryMock },
				{
					provide: TokenService,
					useValue: {
						sign: jest.fn(),
						verify: jest.fn(),
						signCustomerToken: jest.fn().mockResolvedValue('customer.token'),
					},
				},
				{
					provide: PasswordHasherService,
					useValue: { hash: jest.fn(), verify: jest.fn() },
				},
				{
					provide: RedisService,
					useValue: {
						get: jest.fn(),
						setWithExpiry: jest.fn(),
						delete: jest.fn(),
						exists: jest.fn(),
					},
				},
				{
					provide: QueueProducer,
					useValue: { sendEmail: jest.fn() },
				},
				{
					provide: ConfigService,
					useValue: { get: jest.fn().mockReturnValue('https://app.test') },
				},
			],
		}).compile()

		service = module.get(CatalogService)
		jest.resetAllMocks()
		repositoryMock.findActivePromotions.mockResolvedValue([])
	})

	describe('getStoreBySlug', () => {
		it('should return store info when store exists', async () => {
			repositoryMock.findStoreBySlug.mockResolvedValueOnce({
				id: 'seller-1',
				name: 'My Shop',
				store_slug: 'myshop',
				store_name: 'My Store',
				store_description: 'Desc',
				store_logo: null,
				store_banner: null,
				store_phone: null,
				store_whatsapp: null,
			} as any)

			const result = await service.getStoreBySlug('myshop')

			expect(result.slug).toBe('myshop')
			expect(result.name).toBe('My Store')
		})

		it('should throw NotFoundException when store does not exist', async () => {
			repositoryMock.findStoreBySlug.mockResolvedValueOnce(null)

			await expect(service.getStoreBySlug('unknown')).rejects.toThrow(NotFoundException)
		})
	})

	describe('getStoreProducts', () => {
		it('should throw NotFoundException when store slug not found', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce(null)

			await expect(service.getStoreProducts('unknown')).rejects.toThrow(NotFoundException)
		})

		it('should return products with prices and stock', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' })
			repositoryMock.findActiveProducts.mockResolvedValueOnce([makeProduct(1)] as any)
			repositoryMock.findActivePrices.mockResolvedValueOnce([{ product_id: 1, price: 5000 }] as any)
			repositoryMock.findStocks.mockResolvedValueOnce([
				{ product_id: 1, quantity: 10, reserved_quantity: 2 },
			] as any)

			const result = await service.getStoreProducts('myshop')

			expect(result).toHaveLength(1)
			expect(result[0].price).toBe(5000) // integer cents
			expect(result[0].availableStock).toBe(8)
		})
	})

	describe('getStoreProductById', () => {
		it('should throw NotFoundException when store not found', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce(null)

			await expect(service.getStoreProductById('unknown', 1)).rejects.toThrow(NotFoundException)
		})

		it('should throw NotFoundException when product not found in that store', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' })
			repositoryMock.findActiveProductBySeller.mockResolvedValueOnce(null)

			await expect(service.getStoreProductById('myshop', 999)).rejects.toThrow(NotFoundException)
		})
	})

	describe('getProductById', () => {
		it('should throw NotFoundException when product not found', async () => {
			repositoryMock.findActiveProductById.mockResolvedValueOnce(null)

			await expect(service.getProductById(999)).rejects.toThrow(NotFoundException)
		})

		it('should return product with price and available stock', async () => {
			repositoryMock.findActiveProductById.mockResolvedValueOnce(makeProduct(1) as any)
			repositoryMock.findLatestPrice.mockResolvedValueOnce({ product_id: 1, price: 3000 } as any)
			repositoryMock.findStockByProduct.mockResolvedValueOnce({
				product_id: 1,
				quantity: 20,
				reserved_quantity: 5,
			} as any)

			const result = await service.getProductById(1)

			expect(result.price).toBe(3000)
			expect(result.availableStock).toBe(15)
		})

		it('should return 0 for price and stock when no price or stock record exists', async () => {
			repositoryMock.findActiveProductById.mockResolvedValueOnce(makeProduct(1) as any)
			repositoryMock.findLatestPrice.mockResolvedValueOnce(null)
			repositoryMock.findStockByProduct.mockResolvedValueOnce(null)

			const result = await service.getProductById(1)

			expect(result.price).toBe(0)
			expect(result.availableStock).toBe(0)
		})
	})

	describe('getCustomerInStore', () => {
		it('should throw NotFoundException when store slug not found', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce(null)

			await expect(service.getCustomerInStore('unknown', 'cust-1')).rejects.toThrow(
				NotFoundException,
			)
		})

		it('should throw NotFoundException when customer does not exist', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' })
			repositoryMock.findCustomerById.mockResolvedValueOnce(null)

			await expect(service.getCustomerInStore('myshop', 'ghost')).rejects.toThrow(NotFoundException)
		})

		it('should throw NotFoundException when customer belongs to a different seller', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' })
			repositoryMock.findCustomerById.mockResolvedValueOnce({
				id: 'cust-1',
				name: 'João Silva',
				seller_id: 'other-seller',
				city: 'SP',
				state: 'SP',
			} as any)

			await expect(service.getCustomerInStore('myshop', 'cust-1')).rejects.toThrow(
				NotFoundException,
			)
		})

		it('should return only first name and public fields for a matching customer', async () => {
			repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' })
			repositoryMock.findCustomerById.mockResolvedValueOnce({
				id: 'cust-1',
				name: 'João Silva',
				email: 'j@test.com',
				seller_id: 'seller-1',
				city: 'São Paulo',
				state: 'SP',
			} as any)

			const result = await service.getCustomerInStore('myshop', 'cust-1')

			expect(result.firstName).toBe('João')
			expect((result as any).email).toBeUndefined()
			expect((result as any).storeSlug).toBeUndefined()
		})
	})

	describe('customer first-password setup (email OTP)', () => {
		const passwordlessCustomer = {
			id: 'cust-1',
			name: 'João Silva',
			email: 'j@test.com',
			phone: '11999999999',
			seller_id: 'seller-1',
			password_hash: null,
			address: null,
			city: null,
			state: null,
			zip_code: null,
			document: null,
		}

		const redis = () => (service as any).redis
		const queue = () => (service as any).queueProducer
		const hashOtp = (otp: string) =>
			require('node:crypto').createHash('sha256').update(otp).digest('hex')

		describe('requestPasswordOtp', () => {
			it('emails a code for an eligible password-less customer', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				repositoryMock.findCustomerByEmailOrPhone.mockResolvedValueOnce(passwordlessCustomer as any)
				redis().exists.mockResolvedValueOnce(false) // no cooldown

				const result = await service.requestPasswordOtp('myshop', { contact: 'j@test.com' })

				expect(redis().setWithExpiry).toHaveBeenCalledWith(
					'customer:setpw:otp:cust-1',
					expect.any(String),
					expect.any(Number),
				)
				expect(queue().sendEmail).toHaveBeenCalledWith(
					expect.objectContaining({ to: 'j@test.com' }),
				)
				expect(result.message).toMatch(/código/i)
			})

			it('returns the uniform message and sends nothing for an unknown contact', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				repositoryMock.findCustomerByEmailOrPhone.mockResolvedValueOnce(null as any)

				const result = await service.requestPasswordOtp('myshop', { contact: 'ghost@test.com' })

				expect(queue().sendEmail).not.toHaveBeenCalled()
				expect(result.message).toMatch(/código/i)
			})

			it('does not send when the customer already has a password', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				repositoryMock.findCustomerByEmailOrPhone.mockResolvedValueOnce({
					...passwordlessCustomer,
					password_hash: 'existing',
				} as any)

				await service.requestPasswordOtp('myshop', { contact: 'j@test.com' })

				expect(queue().sendEmail).not.toHaveBeenCalled()
			})
		})

		describe('setCustomerPassword', () => {
			it('rejects when no OTP was issued (blocks takeover by enumeration)', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				repositoryMock.findCustomerByEmailOrPhone.mockResolvedValueOnce(passwordlessCustomer as any)
				redis().get.mockResolvedValueOnce(null) // no stored OTP

				await expect(
					service.setCustomerPassword('myshop', {
						contact: 'j@test.com',
						otp: '123456',
						password: 'supersafe1',
					}),
				).rejects.toThrow(UnauthorizedException)
				expect(repositoryMock.updateCustomerPasswordHash).not.toHaveBeenCalled()
			})

			it('rejects a wrong OTP', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				repositoryMock.findCustomerByEmailOrPhone.mockResolvedValueOnce(passwordlessCustomer as any)
				redis().get.mockResolvedValueOnce(hashOtp('654321')) // stored OTP differs
				redis().get.mockResolvedValueOnce(null) // attempts counter read

				await expect(
					service.setCustomerPassword('myshop', {
						contact: 'j@test.com',
						otp: '123456',
						password: 'supersafe1',
					}),
				).rejects.toThrow(UnauthorizedException)
				expect(repositoryMock.updateCustomerPasswordHash).not.toHaveBeenCalled()
			})

			it('sets the password when the OTP matches', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				repositoryMock.findCustomerByEmailOrPhone.mockResolvedValueOnce(passwordlessCustomer as any)
				redis().get.mockResolvedValueOnce(hashOtp('123456'))
				;(service as any).passwordHasher.hash.mockResolvedValueOnce({ hash: 'hashed', salt: '' })
				;(service as any).tokenService.signCustomerToken.mockResolvedValueOnce('customer.token')

				const result = await service.setCustomerPassword('myshop', {
					contact: 'j@test.com',
					otp: '123456',
					password: 'supersafe1',
				})

				expect(repositoryMock.updateCustomerPasswordHash).toHaveBeenCalledWith('cust-1', 'hashed')
				expect(redis().delete).toHaveBeenCalledWith('customer:setpw:otp:cust-1')
				expect(result.token).toBe('customer.token')
			})
		})
	})

	describe('seller-issued password invite', () => {
		const passwordlessCustomer = {
			id: 'cust-1',
			name: 'João Silva',
			email: null,
			phone: '11999999999',
			seller_id: 'seller-1',
			seller_store_slug: 'minha-loja',
			password_hash: null,
			address: null,
			city: null,
			state: null,
			zip_code: null,
			document: null,
		}

		const redis = () => (service as any).redis

		describe('createCustomerPasswordInvite', () => {
			it('issues a token + link for a password-less customer the seller owns', async () => {
				repositoryMock.findCustomerWithHashById.mockResolvedValueOnce(passwordlessCustomer as any)

				const result = await service.createCustomerPasswordInvite('seller-1', 'cust-1')

				expect(redis().setWithExpiry).toHaveBeenCalledWith(
					expect.stringContaining('customer:setpw:invite:'),
					'cust-1',
					expect.any(Number),
				)
				expect(result.token).toEqual(expect.any(String))
				expect(result.link).toBe(
					`https://app.test/loja/minha-loja/definir-senha?invite=${result.token}`,
				)
			})

			it('rejects a customer owned by another seller (tenant isolation)', async () => {
				repositoryMock.findCustomerWithHashById.mockResolvedValueOnce({
					...passwordlessCustomer,
					seller_id: 'other-seller',
				} as any)

				await expect(service.createCustomerPasswordInvite('seller-1', 'cust-1')).rejects.toThrow(
					NotFoundException,
				)
				expect(redis().setWithExpiry).not.toHaveBeenCalled()
			})

			it('also issues an invite for a customer who already has a password (reset), flagged isReset', async () => {
				repositoryMock.findCustomerWithHashById.mockResolvedValueOnce({
					...passwordlessCustomer,
					password_hash: 'existing',
				} as any)

				const result = await service.createCustomerPasswordInvite('seller-1', 'cust-1')

				expect(result.isReset).toBe(true)
				expect(result.token).toEqual(expect.any(String))
				expect(redis().setWithExpiry).toHaveBeenCalled()
			})
		})

		describe('redeemPasswordInvite', () => {
			it('rejects an unknown/expired token', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				redis().get.mockResolvedValueOnce(null)

				await expect(
					service.redeemPasswordInvite('minha-loja', { token: 'bad', password: 'supersafe1' }),
				).rejects.toThrow(UnauthorizedException)
				expect(repositoryMock.updateCustomerPasswordHash).not.toHaveBeenCalled()
			})

			it('rejects a token for a customer in a different store', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				redis().get.mockResolvedValueOnce('cust-1')
				repositoryMock.findCustomerWithHashById.mockResolvedValueOnce({
					...passwordlessCustomer,
					seller_id: 'other-seller',
				} as any)

				await expect(
					service.redeemPasswordInvite('minha-loja', { token: 'tok', password: 'supersafe1' }),
				).rejects.toThrow(UnauthorizedException)
			})

			it('sets the password and consumes the invite on success', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				redis().get.mockResolvedValueOnce('cust-1')
				repositoryMock.findCustomerWithHashById.mockResolvedValueOnce(passwordlessCustomer as any)
				;(service as any).passwordHasher.hash.mockResolvedValueOnce({ hash: 'hashed', salt: '' })
				;(service as any).tokenService.signCustomerToken.mockResolvedValueOnce('customer.token')

				const result = await service.redeemPasswordInvite('minha-loja', {
					token: 'tok',
					password: 'supersafe1',
				})

				expect(repositoryMock.updateCustomerPasswordHash).toHaveBeenCalledWith('cust-1', 'hashed')
				expect(redis().delete).toHaveBeenCalledWith(
					expect.stringContaining('customer:setpw:invite:'),
				)
				expect(result.token).toBe('customer.token')
			})

			it('overwrites an existing password (seller-assisted reset)', async () => {
				repositoryMock.findStoreIdBySlug.mockResolvedValueOnce({ id: 'seller-1' } as any)
				redis().get.mockResolvedValueOnce('cust-1')
				repositoryMock.findCustomerWithHashById.mockResolvedValueOnce({
					...passwordlessCustomer,
					password_hash: 'old-hash',
				} as any)
				;(service as any).passwordHasher.hash.mockResolvedValueOnce({ hash: 'new-hash', salt: '' })
				;(service as any).tokenService.signCustomerToken.mockResolvedValueOnce('customer.token')

				const result = await service.redeemPasswordInvite('minha-loja', {
					token: 'tok',
					password: 'brandnew1',
				})

				expect(repositoryMock.updateCustomerPasswordHash).toHaveBeenCalledWith('cust-1', 'new-hash')
				expect(result.token).toBe('customer.token')
			})
		})
	})

	describe('createOrder', () => {
		const baseDto = {
			customer: {
				name: 'Alice',
				email: 'alice@test.com',
				phone: '11999999999',
				document: '12345678901',
				address: 'Rua A',
				number: '100',
				complement: undefined,
				neighborhood: 'Centro',
				city: 'SP',
				state: 'SP',
				zip_code: '01001-000',
			},
			items: [{ product_id: 1, quantity: 2 }],
			notes: undefined,
		}

		it('should throw BadRequestException when items is empty', async () => {
			await expect(service.createOrder({ ...baseDto, items: [] })).rejects.toThrow(
				BadRequestException,
			)
		})

		it('should throw when some products not found', async () => {
			repositoryMock.findActiveProducts.mockResolvedValueOnce([]) // no products match

			await expect(service.createOrder(baseDto)).rejects.toThrow(BadRequestException)
		})

		it('should throw when products belong to multiple sellers', async () => {
			repositoryMock.findActiveProducts.mockResolvedValueOnce([
				makeProduct(1, 'seller-1'),
				makeProduct(2, 'seller-2'),
			] as any)
			repositoryMock.findActivePrices.mockResolvedValueOnce([
				{ product_id: 1, price: 1000 },
				{ product_id: 2, price: 2000 },
			] as any)

			await expect(
				service.createOrder({
					...baseDto,
					items: [
						{ product_id: 1, quantity: 1 },
						{ product_id: 2, quantity: 1 },
					],
				}),
			).rejects.toThrow(BadRequestException)
		})

		it('should create order with correct integer totals using existing customer', async () => {
			repositoryMock.findActiveProducts.mockResolvedValueOnce([makeProduct(1)] as any)
			repositoryMock.findActivePrices.mockResolvedValueOnce([{ product_id: 1, price: 1500 }] as any)
			repositoryMock.findCustomerByContact.mockResolvedValueOnce({ id: 'cust-1' } as any)
			repositoryMock.createOrderWithItems.mockResolvedValueOnce({
				id: 100,
				order_number: 'PED-XYZ',
				status: 'pending',
				total: 3000,
				customer: { id: 'cust-1', name: 'Alice' },
				Order_item: [
					{ product: { id: 1, name: 'Product 1' }, quantity: 2, unit_price: 1500, total: 3000 },
				],
			} as any)

			const result = await service.createOrder(baseDto)

			expect(result.total).toBe(3000) // integer cents
			expect(repositoryMock.createCustomer).not.toHaveBeenCalled()
			const orderData = repositoryMock.createOrderWithItems.mock.calls[0][0]
			expect(orderData.subtotal).toBe(3000) // 2 * 1500
			expect(orderData.total).toBe(3000)
			expect(orderData.discount).toBe(0)
		})

		it('should create a new customer when none exists', async () => {
			repositoryMock.findActiveProducts.mockResolvedValueOnce([makeProduct(1)] as any)
			repositoryMock.findActivePrices.mockResolvedValueOnce([{ product_id: 1, price: 1000 }] as any)
			repositoryMock.findCustomerByContact.mockResolvedValueOnce(null)
			repositoryMock.createCustomer.mockResolvedValueOnce({ id: 'new-cust' } as any)
			repositoryMock.createOrderWithItems.mockResolvedValueOnce({
				id: 101,
				order_number: 'PED-NEW',
				status: 'pending',
				total: 1000,
				customer: { id: 'new-cust', name: 'Alice' },
				Order_item: [],
			} as any)

			await service.createOrder(baseDto)

			expect(repositoryMock.createCustomer).toHaveBeenCalled()
		})
	})
})
