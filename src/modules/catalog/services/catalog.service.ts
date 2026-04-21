import {
	BadRequestException,
	Inject,
	Injectable,
	NotFoundException,
	UnauthorizedException,
} from '@nestjs/common'
import { TokenService } from '@/modules/auth/services/token.service'
import { PasswordHasherService } from '@/shared/crypto/password-hasher.service'
import {
	CATALOG_REPOSITORY,
	type CatalogRepository,
} from '@/shared/repositories/catalog.repository'
import type { AuthCustomerDto } from '../dto/auth-customer.dto'
import type { CreateCatalogOrderDto } from '../dto/create-catalog-order.dto'
import type { LookupCustomerDto } from '../dto/lookup-customer.dto'

@Injectable()
export class CatalogService {
	constructor(
		@Inject(CATALOG_REPOSITORY) private readonly catalogRepository: CatalogRepository,
		private readonly tokenService: TokenService,
		private readonly passwordHasher: PasswordHasherService,
	) {}

	async getStoreBySlug(slug: string) {
		const store = await this.catalogRepository.findStoreBySlug(slug)

		if (!store) {
			throw new NotFoundException('Loja não encontrada')
		}

		return {
			id: store.id,
			slug: store.store_slug,
			name: store.store_name || store.name,
			description: store.store_description,
			logo: store.store_logo,
			banner: store.store_banner,
			phone: store.store_phone,
			whatsapp: store.store_whatsapp,
		}
	}

	async getStoreProducts(slug: string) {
		const store = await this.catalogRepository.findStoreIdBySlug(slug)

		if (!store) {
			throw new NotFoundException('Loja não encontrada')
		}

		return this.listProductsForSeller(store.id)
	}

	private async listProductsForSeller(sellerId: string) {
		const products = await this.catalogRepository.findActiveProducts(sellerId)

		const productIds = products.map((p) => p.id)

		const prices = await this.catalogRepository.findActivePrices(productIds)

		const stocks = await this.catalogRepository.findStocks(productIds)

		const promotions = await this.catalogRepository.findActivePromotions(productIds)

		const priceMap = new Map<number, number>()
		for (const price of prices) {
			if (!priceMap.has(price.product_id)) {
				priceMap.set(price.product_id, price.price)
			}
		}

		const promotionMap = new Map<number, number>()
		for (const promo of promotions) {
			if (!promotionMap.has(promo.product_id)) {
				promotionMap.set(promo.product_id, promo.promotional_price)
			}
		}

		const stockMap = new Map<number, number>()
		for (const stock of stocks) {
			const available = stock.quantity - stock.reserved_quantity
			stockMap.set(stock.product_id, available > 0 ? available : 0)
		}

		return products
			.filter((p) => priceMap.has(p.id))
			.map((product) => ({
				id: product.id,
				name: product.name,
				description: product.description,
				category: product.category,
				brand: product.brand,
				unit: product.unit,
				images: product.images,
				price: promotionMap.get(product.id) ?? priceMap.get(product.id) ?? 0,
				originalPrice: promotionMap.has(product.id) ? priceMap.get(product.id) : undefined,
				availableStock: stockMap.get(product.id) || 0,
			}))
	}

	async getStoreProductById(slug: string, productId: number) {
		const store = await this.catalogRepository.findStoreIdBySlug(slug)

		if (!store) {
			throw new NotFoundException('Loja não encontrada')
		}

		const product = await this.catalogRepository.findActiveProductBySeller(productId, store.id)

		if (!product) {
			throw new NotFoundException('Produto não encontrado')
		}

		return this.getProductById(productId)
	}

	async getCustomerInStore(slug: string, customerId: string) {
		const store = await this.catalogRepository.findStoreIdBySlug(slug)

		if (!store) {
			throw new NotFoundException('Loja não encontrada')
		}

		const customer = await this.catalogRepository.findCustomerById(customerId)

		if (!customer || customer.seller_id !== store.id) {
			throw new NotFoundException('Cliente não encontrado nesta loja')
		}

		// Return only first name for public display (privacy)
		const firstName = customer.name.split(' ')[0]

		return {
			id: customer.id,
			firstName,
			city: customer.city,
			state: customer.state,
		}
	}

	async getProductById(id: number) {
		const product = await this.catalogRepository.findActiveProductById(id)

		if (!product) {
			throw new NotFoundException('Produto não encontrado')
		}

		const price = await this.catalogRepository.findLatestPrice(id)

		const stock = await this.catalogRepository.findStockByProduct(id)

		const available = stock ? stock.quantity - stock.reserved_quantity : 0

		return {
			id: product.id,
			name: product.name,
			description: product.description,
			category: product.category,
			brand: product.brand,
			unit: product.unit,
			images: product.images,
			specifications: product.specifications,
			price: price?.price || 0,
			availableStock: available > 0 ? available : 0,
		}
	}

	async createOrder(dto: CreateCatalogOrderDto) {
		const { items, notes } = dto

		if (items.length === 0) {
			throw new BadRequestException('O pedido deve ter pelo menos um item')
		}

		// Verify products exist, have stock, and belong to same seller
		const productIds = items.map((item) => item.product_id)
		const products = await this.catalogRepository.findActiveProducts()
		const validProducts = products.filter((p) => productIds.includes(p.id))

		if (validProducts.length !== productIds.length) {
			throw new BadRequestException('Um ou mais produtos não foram encontrados')
		}

		// Ensure all products belong to the same seller
		const sellerIds = new Set(validProducts.map((p) => p.seller_id))
		if (sellerIds.size > 1) {
			throw new BadRequestException('Todos os produtos devem pertencer à mesma loja')
		}

		// Get prices and active promotions
		const prices = await this.catalogRepository.findActivePrices(productIds)
		const promotions = await this.catalogRepository.findActivePromotions(productIds)

		const priceMap = new Map<number, number>()
		for (const price of prices) {
			if (!priceMap.has(price.product_id)) {
				priceMap.set(price.product_id, price.price)
			}
		}

		for (const promo of promotions) {
			if (!priceMap.has(promo.product_id)) continue
			priceMap.set(promo.product_id, promo.promotional_price)
		}

		// Get seller_id from products
		const firstProduct = validProducts[0]
		const sellerId = firstProduct?.seller_id
		if (!sellerId) {
			throw new BadRequestException('Não foi possível identificar o vendedor')
		}

		// Resolve customer: by ID (personalized link) or by contact (new/anonymous)
		let customerId: string
		let orderAddress: Record<string, string | undefined>

		if (dto.customerId) {
			const existing = await this.catalogRepository.findCustomerById(dto.customerId)
			if (!existing) throw new BadRequestException('Cliente não encontrado')
			if (existing.seller_id !== sellerId) {
				throw new BadRequestException('Cliente não pertence a esta loja')
			}
			customerId = existing.id
			const addr = existing.address as Record<string, string> | null
			orderAddress = {
				street: addr?.street,
				number: addr?.number,
				complement: addr?.complement,
				neighborhood: addr?.neighborhood,
				city: existing.city ?? undefined,
				state: existing.state ?? undefined,
				zip_code: existing.zip_code ?? undefined,
			}
		} else {
			const customer = dto.customer
			if (!customer) throw new BadRequestException('Forneça customerId ou os dados do cliente')

			const existingCustomer = await this.catalogRepository.findCustomerByContact(
				customer.email,
				customer.phone,
				customer.document,
				sellerId,
			)

			if (existingCustomer) {
				customerId = existingCustomer.id
			} else {
				const newCustomer = await this.catalogRepository.createCustomer({
					seller_id: sellerId,
					name: customer.name,
					email: customer.email,
					phone: customer.phone,
					document: customer.document,
					address: {
						street: customer.address,
						number: customer.number,
						complement: customer.complement || '',
						neighborhood: customer.neighborhood,
					},
					city: customer.city,
					state: customer.state,
					zip_code: customer.zip_code,
				})
				customerId = newCustomer.id
			}
			orderAddress = {
				street: customer.address,
				number: customer.number,
				complement: customer.complement,
				neighborhood: customer.neighborhood,
				city: customer.city,
				state: customer.state,
				zip_code: customer.zip_code,
			}
		}

		// Generate order number with timestamp + random suffix to avoid collisions
		const timestamp = Date.now().toString(36).toUpperCase()
		const random = Math.random().toString(36).substring(2, 6).toUpperCase()
		const orderNumber = `PED-${timestamp}${random}`

		// Calculate totals
		const orderItems = items.map((item) => {
			const unitPrice = priceMap.get(item.product_id) || 0
			return {
				product_id: item.product_id,
				quantity: item.quantity,
				unit_price: unitPrice,
				discount: 0,
				total: unitPrice * item.quantity,
			}
		})

		const subtotal = orderItems.reduce((acc, item) => acc + item.total, 0)

		// Create order with items
		const order = await this.catalogRepository.createOrderWithItems({
			seller_id: sellerId,
			order_number: orderNumber,
			customer_id: customerId,
			status: 'pending',
			payment_status: 'pending',
			subtotal,
			discount: 0,
			total: subtotal,
			notes: notes || `Pedido via catálogo online`,
			metadata: {
				source: 'catalog',
				customer_address: orderAddress,
			},
			items: orderItems,
		})

		return {
			id: order.id,
			order_number: order.order_number,
			status: order.status,
			total: order.total,
			customer: order.customer,
			items: order.Order_item.map((item) => ({
				product: item.product,
				quantity: item.quantity,
				unit_price: item.unit_price,
				total: item.total,
			})),
			message: 'Pedido criado com sucesso! Em breve entraremos em contato.',
		}
	}

	async lookupCustomer(slug: string, dto: LookupCustomerDto) {
		const store = await this.catalogRepository.findStoreIdBySlug(slug)
		if (!store) throw new NotFoundException('Loja não encontrada')

		const customer = await this.catalogRepository.findCustomerByEmailOrPhone(dto.contact, store.id)

		if (!customer) return { found: false }

		const firstName = customer.name.split(' ')[0]
		return { found: true, firstName, hasPassword: customer.password_hash !== null }
	}

	async authenticateCustomer(slug: string, dto: AuthCustomerDto) {
		const store = await this.catalogRepository.findStoreIdBySlug(slug)
		if (!store) throw new NotFoundException('Loja não encontrada')

		const customer = await this.catalogRepository.findCustomerByEmailOrPhone(dto.contact, store.id)

		if (!customer) throw new NotFoundException('Cliente não encontrado')

		if (customer.password_hash === null) {
			throw new BadRequestException(
				'Cliente sem senha cadastrada. Use o endpoint de definição de senha.',
			)
		}

		const valid = await this.passwordHasher.verify(dto.password, customer.password_hash, '')
		if (!valid) throw new UnauthorizedException('Senha incorreta')

		const token = await this.tokenService.signCustomerToken(customer.id, store.id)
		const address = customer.address as Record<string, string> | null

		return {
			token,
			customer: {
				id: customer.id,
				firstName: customer.name.split(' ')[0],
				name: customer.name,
				email: customer.email,
				phone: customer.phone,
				document: customer.document,
				address: address?.street ?? '',
				number: address?.number ?? '',
				complement: address?.complement ?? '',
				neighborhood: address?.neighborhood ?? '',
				city: customer.city,
				state: customer.state,
				zip_code: customer.zip_code,
			},
		}
	}

	async setCustomerPassword(slug: string, dto: AuthCustomerDto) {
		const store = await this.catalogRepository.findStoreIdBySlug(slug)
		if (!store) throw new NotFoundException('Loja não encontrada')

		const customer = await this.catalogRepository.findCustomerByEmailOrPhone(dto.contact, store.id)

		if (!customer) throw new NotFoundException('Cliente não encontrado')
		if (customer.password_hash !== null) {
			throw new BadRequestException('Senha já cadastrada. Use o endpoint de login.')
		}

		const { hash } = await this.passwordHasher.hash(dto.password)
		await this.catalogRepository.updateCustomerPasswordHash(customer.id, hash)

		const token = await this.tokenService.signCustomerToken(customer.id, store.id)
		const address = customer.address as Record<string, string> | null

		return {
			token,
			customer: {
				id: customer.id,
				firstName: customer.name.split(' ')[0],
				name: customer.name,
				email: customer.email,
				phone: customer.phone,
				document: customer.document,
				address: address?.street ?? '',
				number: address?.number ?? '',
				complement: address?.complement ?? '',
				neighborhood: address?.neighborhood ?? '',
				city: customer.city,
				state: customer.state,
				zip_code: customer.zip_code,
			},
		}
	}

	async trackOrder(orderNumber: string) {
		const order = await this.catalogRepository.findOrderByNumber(orderNumber)
		if (!order) throw new NotFoundException('Pedido não encontrado')

		const sellerFirstName = order.store?.name?.trim().split(/\s+/)[0]
		const storeName =
			order.store?.store_name ?? (sellerFirstName ? `Loja de ${sellerFirstName}` : 'Loja')

		return {
			order_number: order.order_number,
			status: order.status,
			payment_status: order.payment_status,
			total: order.total,
			subtotal: order.subtotal,
			discount: order.discount,
			delivery_date: order.delivery_date,
			created_at: order.createdAt,
			updated_at: order.updatedAt,
			store_name: storeName,
			items: order.items.map((item) => ({
				product: item.product,
				quantity: item.quantity,
				unit_price: item.unit_price,
				total: item.total,
			})),
		}
	}
}
