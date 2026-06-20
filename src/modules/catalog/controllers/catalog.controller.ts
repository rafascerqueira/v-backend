import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { Throttle } from '@nestjs/throttler'
import { Public } from '@/modules/auth/decorators/public.decorator'
import { ZodValidationPipe } from '@/shared/pipes/zod-validation.pipe'
import { type AuthCustomerDto, authCustomerSchema } from '../dto/auth-customer.dto'
import {
	type CreateCatalogOrderDto,
	createCatalogOrderSchema,
} from '../dto/create-catalog-order.dto'
import { type LookupCustomerDto, lookupCustomerSchema } from '../dto/lookup-customer.dto'
import {
	type RedeemInviteDto,
	type RequestCustomerOtpDto,
	redeemInviteSchema,
	requestCustomerOtpSchema,
	type SetCustomerPasswordDto,
	setCustomerPasswordSchema,
} from '../dto/set-customer-password.dto'
import { CatalogService } from '../services/catalog.service'

/** Tight per-IP limits for the unauthenticated customer identity endpoints. */
const CUSTOMER_AUTH_THROTTLE = {
	short: { ttl: 1000, limit: 1 },
	medium: { ttl: 60000, limit: 5 },
	long: { ttl: 3600000, limit: 20 },
}

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
	constructor(private readonly service: CatalogService) {}

	@Public()
	@Get('loja/:slug')
	@ApiOperation({ summary: 'Get store info by slug (public)' })
	@ApiParam({ name: 'slug', type: String, description: 'Store slug (e.g., minha-loja)' })
	@ApiResponse({ status: 200, description: 'Store found' })
	@ApiResponse({ status: 404, description: 'Store not found' })
	async getStore(@Param('slug') slug: string) {
		return this.service.getStoreBySlug(slug)
	}

	@Public()
	@Get('loja/:slug/products')
	@ApiOperation({ summary: 'List products from a specific store (public)' })
	@ApiParam({ name: 'slug', type: String, description: 'Store slug' })
	@ApiResponse({ status: 200, description: 'Products listed successfully' })
	@ApiResponse({ status: 404, description: 'Store not found' })
	async getStoreProducts(@Param('slug') slug: string) {
		return this.service.getStoreProducts(slug)
	}

	@Public()
	@Get('loja/:slug/products/:id')
	@ApiOperation({ summary: 'Get product from a specific store (public)' })
	@ApiParam({ name: 'slug', type: String, description: 'Store slug' })
	@ApiParam({ name: 'id', type: Number, description: 'Product ID' })
	@ApiResponse({ status: 200, description: 'Product found' })
	@ApiResponse({ status: 404, description: 'Product or store not found' })
	async getStoreProduct(@Param('slug') slug: string, @Param('id') id: string) {
		return this.service.getStoreProductById(slug, Number(id))
	}

	@Public()
	@Get('loja/:slug/customers/:id')
	@ApiOperation({
		summary: 'Get customer data for personalized catalog link, scoped to a store (public)',
	})
	@ApiParam({ name: 'slug', type: String, description: 'Store slug' })
	@ApiParam({ name: 'id', type: String, description: 'Customer UUID' })
	@ApiResponse({ status: 200, description: 'Customer found in the given store' })
	@ApiResponse({ status: 404, description: 'Customer not found in this store' })
	async getStoreCustomer(@Param('slug') slug: string, @Param('id') id: string) {
		return this.service.getCustomerInStore(slug, id)
	}

	@Public()
	@Throttle(CUSTOMER_AUTH_THROTTLE)
	@Post('loja/:slug/customer/lookup')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Look up customer by email or phone in a store (public)' })
	@ApiParam({ name: 'slug', type: String })
	@ApiResponse({ status: 200, description: 'Lookup result' })
	async lookupCustomer(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(lookupCustomerSchema)) body: LookupCustomerDto,
	) {
		return this.service.lookupCustomer(slug, body)
	}

	@Public()
	@Throttle(CUSTOMER_AUTH_THROTTLE)
	@Post('loja/:slug/customer/auth')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({ summary: 'Authenticate existing customer in a store (public)' })
	@ApiParam({ name: 'slug', type: String })
	@ApiResponse({ status: 200, description: 'Customer authenticated' })
	@ApiResponse({ status: 401, description: 'Wrong password' })
	@ApiResponse({ status: 404, description: 'Customer or store not found' })
	async authenticateCustomer(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(authCustomerSchema)) body: AuthCustomerDto,
	) {
		return this.service.authenticateCustomer(slug, body)
	}

	@Public()
	@Throttle(CUSTOMER_AUTH_THROTTLE)
	@Post('loja/:slug/customer/password/request')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: 'Request an email verification code to set a password (public)',
	})
	@ApiParam({ name: 'slug', type: String })
	@ApiResponse({ status: 200, description: 'Verification code sent if the contact is eligible' })
	async requestCustomerPasswordOtp(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(requestCustomerOtpSchema)) body: RequestCustomerOtpDto,
	) {
		return this.service.requestPasswordOtp(slug, body)
	}

	@Public()
	@Throttle(CUSTOMER_AUTH_THROTTLE)
	@Post('loja/:slug/customer/password')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: 'Set password for a customer who has none yet (public, requires emailed OTP)',
	})
	@ApiParam({ name: 'slug', type: String })
	@ApiResponse({ status: 200, description: 'Password set and customer authenticated' })
	async setCustomerPassword(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(setCustomerPasswordSchema)) body: SetCustomerPasswordDto,
	) {
		return this.service.setCustomerPassword(slug, body)
	}

	@Public()
	@Throttle(CUSTOMER_AUTH_THROTTLE)
	@Post('loja/:slug/customer/password/invite')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: 'Set or reset password using a seller-issued invite token (public)',
	})
	@ApiParam({ name: 'slug', type: String })
	@ApiResponse({ status: 200, description: 'Password set and customer authenticated' })
	async redeemPasswordInvite(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(redeemInviteSchema)) body: RedeemInviteDto,
	) {
		return this.service.redeemPasswordInvite(slug, body)
	}

	@Public()
	@Get('orders/:orderNumber/track')
	@ApiOperation({ summary: 'Track order status by order number (public)' })
	@ApiParam({ name: 'orderNumber', type: String, description: 'Order number (e.g. PED-LK3X4ABC)' })
	@ApiResponse({ status: 200, description: 'Order tracking info' })
	@ApiResponse({ status: 404, description: 'Order not found' })
	async trackOrder(@Param('orderNumber') orderNumber: string) {
		return this.service.trackOrder(orderNumber)
	}

	@Public()
	@Post('loja/:slug/orders')
	@HttpCode(HttpStatus.CREATED)
	@ApiOperation({ summary: 'Create order from a specific store (public)' })
	@ApiParam({ name: 'slug', type: String, description: 'Store slug' })
	@ApiBody({
		schema: {
			example: {
				customer: {
					name: 'João Silva',
					email: 'joao@email.com',
					phone: '11999999999',
					document: '12345678900',
					address: 'Rua das Flores',
					number: '123',
					complement: 'Apto 45',
					neighborhood: 'Centro',
					city: 'São Paulo',
					state: 'SP',
					zip_code: '01234567',
				},
				items: [{ product_id: 1, quantity: 2 }],
				notes: 'Entregar pela manhã',
			},
		},
	})
	@ApiResponse({ status: 201, description: 'Order created successfully' })
	@ApiResponse({ status: 400, description: 'Invalid data' })
	@ApiResponse({ status: 404, description: 'Store not found' })
	async createOrder(
		@Param('slug') slug: string,
		@Body(new ZodValidationPipe(createCatalogOrderSchema)) body: CreateCatalogOrderDto,
	) {
		return this.service.createOrder(slug, body)
	}
}
