/**
 * ExportController unit tests
 * Covers: GET /export/orders, GET /export/products, GET /export/customers
 * Guards mocked: JwtAuthGuard
 * Note: This controller directly uses PrismaService and TenantContext (not via service layer).
 * Both are mocked here. ExportService (generateExcel / generatePDF) is also mocked.
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { FeatureGuard } from '@/modules/subscriptions/guards/feature.guard'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { TenantContext } from '@/shared/tenant/tenant.context'
import { ExportController } from './export.controller'
import { ExportService } from './export.service'

const exportServiceMock = {
	generateExcel: jest.fn(),
	generatePDF: jest.fn(),
}

const prismaMock = {
	order: { findMany: jest.fn() },
	product: { findMany: jest.fn() },
	product_price: { findMany: jest.fn() },
	store_stock: { findMany: jest.fn() },
	customer: { findMany: jest.fn() },
}

const tenantContextMock = {
	requireSellerId: jest.fn(),
}

function makeResponse() {
	return {
		header: jest.fn().mockReturnThis(),
		send: jest.fn().mockReturnThis(),
	}
}

describe('ExportController', () => {
	let controller: ExportController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ExportController],
			providers: [
				{ provide: ExportService, useValue: exportServiceMock },
				{ provide: PrismaService, useValue: prismaMock },
				{ provide: TenantContext, useValue: tenantContextMock },
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(FeatureGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ExportController)
		jest.clearAllMocks()
	})

	describe('exportOrders', () => {
		beforeEach(() => {
			tenantContextMock.requireSellerId.mockReturnValue('seller-uuid-1')
			prismaMock.order.findMany.mockResolvedValue([
				{
					order_number: 'ORD-001',
					customer: { name: 'John Doe' },
					status: 'completed',
					total: 15000,
					Order_item: [{ product: { name: 'Widget' } }],
					createdAt: new Date('2024-01-15'),
				},
			])
		})

		it('should generate and send an Excel file when format is excel', async () => {
			const buffer = Buffer.from('excel-content')
			exportServiceMock.generateExcel.mockResolvedValueOnce(buffer)
			const res = makeResponse()

			await controller.exportOrders('excel', undefined, undefined, res as any)

			expect(tenantContextMock.requireSellerId).toHaveBeenCalled()
			expect(exportServiceMock.generateExcel).toHaveBeenCalled()
			expect(res.header).toHaveBeenCalledWith(
				'Content-Type',
				'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			)
			expect(res.send).toHaveBeenCalledWith(buffer)
		})

		it('should generate and send a PDF file when format is pdf', async () => {
			const buffer = Buffer.from('pdf-content')
			exportServiceMock.generatePDF.mockResolvedValueOnce(buffer)
			const res = makeResponse()

			await controller.exportOrders('pdf', undefined, undefined, res as any)

			expect(exportServiceMock.generatePDF).toHaveBeenCalled()
			expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/pdf')
			expect(res.send).toHaveBeenCalledWith(buffer)
		})

		it('should filter orders by date range when provided', async () => {
			exportServiceMock.generateExcel.mockResolvedValueOnce(Buffer.from(''))
			const res = makeResponse()

			await controller.exportOrders('excel', '2024-01-01', '2024-01-31', res as any)

			expect(prismaMock.order.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({
						seller_id: 'seller-uuid-1',
						createdAt: expect.any(Object),
					}),
				}),
			)
		})
	})

	describe('exportProducts', () => {
		beforeEach(() => {
			tenantContextMock.requireSellerId.mockReturnValue('seller-uuid-1')
			prismaMock.product.findMany.mockResolvedValue([
				{ id: 1, name: 'Widget', sku: 'W-001', category: 'Gadgets', brand: 'Acme', active: true },
			])
			prismaMock.product_price.findMany.mockResolvedValue([{ product_id: 1, price: 9900 }])
			prismaMock.store_stock.findMany.mockResolvedValue([{ product_id: 1, quantity: 50 }])
		})

		it('should generate and send an Excel file for products', async () => {
			const buffer = Buffer.from('excel-content')
			exportServiceMock.generateExcel.mockResolvedValueOnce(buffer)
			const res = makeResponse()

			await controller.exportProducts('excel', res as any)

			expect(exportServiceMock.generateExcel).toHaveBeenCalled()
			expect(res.send).toHaveBeenCalledWith(buffer)
		})

		it('should generate and send a PDF file for products', async () => {
			const buffer = Buffer.from('pdf-content')
			exportServiceMock.generatePDF.mockResolvedValueOnce(buffer)
			const res = makeResponse()

			await controller.exportProducts('pdf', res as any)

			expect(exportServiceMock.generatePDF).toHaveBeenCalled()
			expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/pdf')
		})
	})

	describe('exportCustomers', () => {
		beforeEach(() => {
			tenantContextMock.requireSellerId.mockReturnValue('seller-uuid-1')
			prismaMock.customer.findMany.mockResolvedValue([
				{
					name: 'Jane Doe',
					email: 'jane@example.com',
					phone: '11999999999',
					city: 'São Paulo',
					state: 'SP',
					createdAt: new Date('2024-01-01'),
				},
			])
		})

		it('should generate and send an Excel file for customers', async () => {
			const buffer = Buffer.from('excel-content')
			exportServiceMock.generateExcel.mockResolvedValueOnce(buffer)
			const res = makeResponse()

			await controller.exportCustomers('excel', res as any)

			expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { seller_id: 'seller-uuid-1' },
				}),
			)
			expect(exportServiceMock.generateExcel).toHaveBeenCalled()
			expect(res.send).toHaveBeenCalledWith(buffer)
		})

		it('should generate and send a PDF file for customers', async () => {
			const buffer = Buffer.from('pdf-content')
			exportServiceMock.generatePDF.mockResolvedValueOnce(buffer)
			const res = makeResponse()

			await controller.exportCustomers('pdf', res as any)

			expect(exportServiceMock.generatePDF).toHaveBeenCalled()
			expect(res.header).toHaveBeenCalledWith('Content-Type', 'application/pdf')
		})
	})
})
