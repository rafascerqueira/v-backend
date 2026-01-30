import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { ExportService } from './export.service'

@ApiTags('export')
@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
	constructor(
		private readonly exportService: ExportService,
		private readonly prisma: PrismaService,
		private readonly tenantContext: TenantContext,
	) {}

	@Get('orders')
	@ApiOperation({ summary: 'Export orders to Excel or PDF' })
	@ApiQuery({ name: 'format', enum: ['excel', 'pdf'], required: true })
	@ApiQuery({ name: 'startDate', required: false })
	@ApiQuery({ name: 'endDate', required: false })
	@ApiResponse({ status: 200, description: 'File download' })
	async exportOrders(
		@Query('format') format: 'excel' | 'pdf',
		@Query('startDate') startDate?: string,
		@Query('endDate') endDate?: string,
		@Res() res?: FastifyReply,
	) {
		const sellerId = this.tenantContext.getSellerId()

		const where: any = { seller_id: sellerId }
		if (startDate) where.createdAt = { gte: new Date(startDate) }
		if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) }

		const orders = await this.prisma.order.findMany({
			where,
			include: {
				customer: { select: { name: true } },
				Order_item: { include: { product: { select: { name: true } } } },
			},
			orderBy: { createdAt: 'desc' },
		})

		const data = orders.map((order) => ({
			order_number: order.order_number,
			customer: order.customer?.name || 'N/A',
			status: order.status,
			total: order.total,
			items: order.Order_item.length,
			createdAt: order.createdAt,
		}))

		const options = {
			title: 'Relatório de Pedidos',
			subtitle: startDate || endDate
				? `Período: ${startDate || 'início'} a ${endDate || 'hoje'}`
				: undefined,
			columns: [
				{ key: 'order_number', header: 'Nº Pedido', width: 15 },
				{ key: 'customer', header: 'Cliente', width: 25 },
				{ key: 'status', header: 'Status', width: 12 },
				{ key: 'items', header: 'Itens', width: 8, format: 'number' as const },
				{ key: 'total', header: 'Total', width: 15, format: 'currency' as const },
				{ key: 'createdAt', header: 'Data', width: 12, format: 'date' as const },
			],
			data,
			filename: `pedidos-${Date.now()}`,
		}

		if (format === 'excel') {
			const buffer = await this.exportService.generateExcel(options)
			res?.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
			res?.header('Content-Disposition', `attachment; filename="${options.filename}.xlsx"`)
			return res?.send(buffer)
		}

		const buffer = await this.exportService.generatePDF(options)
		res?.header('Content-Type', 'application/pdf')
		res?.header('Content-Disposition', `attachment; filename="${options.filename}.pdf"`)
		return res?.send(buffer)
	}

	@Get('products')
	@ApiOperation({ summary: 'Export products to Excel or PDF' })
	@ApiQuery({ name: 'format', enum: ['excel', 'pdf'], required: true })
	@ApiResponse({ status: 200, description: 'File download' })
	async exportProducts(
		@Query('format') format: 'excel' | 'pdf',
		@Res() res?: FastifyReply,
	) {
		const sellerId = this.tenantContext.getSellerId()

		const products = await this.prisma.product.findMany({
			where: { seller_id: sellerId, deletedAt: null },
			orderBy: { name: 'asc' },
		})

		const productIds = products.map((p) => p.id)
		const prices = await this.prisma.product_price.findMany({
			where: { product_id: { in: productIds }, active: true, price_type: 'sale' },
		})

		const priceMap = new Map<number, number>()
		prices.forEach((p) => {
			if (!priceMap.has(p.product_id)) priceMap.set(p.product_id, p.price)
		})

		const stocks = await this.prisma.store_stock.findMany({
			where: { product_id: { in: productIds } },
		})
		const stockMap = new Map<number, number>()
		stocks.forEach((s) => stockMap.set(s.product_id, s.quantity))

		const data = products.map((product) => ({
			name: product.name,
			sku: product.sku || '-',
			category: product.category || '-',
			brand: product.brand || '-',
			price: priceMap.get(product.id) || 0,
			stock: stockMap.get(product.id) || 0,
			active: product.active ? 'Sim' : 'Não',
		}))

		const options = {
			title: 'Catálogo de Produtos',
			columns: [
				{ key: 'name', header: 'Produto', width: 30 },
				{ key: 'sku', header: 'SKU', width: 15 },
				{ key: 'category', header: 'Categoria', width: 15 },
				{ key: 'brand', header: 'Marca', width: 15 },
				{ key: 'price', header: 'Preço', width: 12, format: 'currency' as const },
				{ key: 'stock', header: 'Estoque', width: 10, format: 'number' as const },
				{ key: 'active', header: 'Ativo', width: 8 },
			],
			data,
			filename: `produtos-${Date.now()}`,
		}

		if (format === 'excel') {
			const buffer = await this.exportService.generateExcel(options)
			res?.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
			res?.header('Content-Disposition', `attachment; filename="${options.filename}.xlsx"`)
			return res?.send(buffer)
		}

		const buffer = await this.exportService.generatePDF(options)
		res?.header('Content-Type', 'application/pdf')
		res?.header('Content-Disposition', `attachment; filename="${options.filename}.pdf"`)
		return res?.send(buffer)
	}

	@Get('customers')
	@ApiOperation({ summary: 'Export customers to Excel or PDF' })
	@ApiQuery({ name: 'format', enum: ['excel', 'pdf'], required: true })
	@ApiResponse({ status: 200, description: 'File download' })
	async exportCustomers(
		@Query('format') format: 'excel' | 'pdf',
		@Res() res?: FastifyReply,
	) {
		const sellerId = this.tenantContext.getSellerId()

		const customers = await this.prisma.customer.findMany({
			where: { seller_id: sellerId },
			orderBy: { name: 'asc' },
		})

		const data = customers.map((customer) => ({
			name: customer.name,
			email: customer.email || '-',
			phone: customer.phone,
			city: customer.city,
			state: customer.state,
			createdAt: customer.createdAt,
		}))

		const options = {
			title: 'Lista de Clientes',
			columns: [
				{ key: 'name', header: 'Nome', width: 25 },
				{ key: 'email', header: 'Email', width: 25 },
				{ key: 'phone', header: 'Telefone', width: 15 },
				{ key: 'city', header: 'Cidade', width: 15 },
				{ key: 'state', header: 'UF', width: 5 },
				{ key: 'createdAt', header: 'Cadastro', width: 12, format: 'date' as const },
			],
			data,
			filename: `clientes-${Date.now()}`,
		}

		if (format === 'excel') {
			const buffer = await this.exportService.generateExcel(options)
			res?.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
			res?.header('Content-Disposition', `attachment; filename="${options.filename}.xlsx"`)
			return res?.send(buffer)
		}

		const buffer = await this.exportService.generatePDF(options)
		res?.header('Content-Type', 'application/pdf')
		res?.header('Content-Disposition', `attachment; filename="${options.filename}.pdf"`)
		return res?.send(buffer)
	}
}
