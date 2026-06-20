/**
 * ReportsController unit tests
 * Covers: GET /reports (full), /reports/sales, /reports/products,
 *         /reports/customers, /reports/charts, /reports/growth
 * Guards mocked: JwtAuthGuard
 */

import { Test } from '@nestjs/testing'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { FeatureGuard } from '@/modules/subscriptions/guards/feature.guard'
import { ReportsService } from '../services/reports.service'
import { ReportsController } from './reports.controller'

const serviceMock = {
	getFullReport: jest.fn(),
	getSalesReport: jest.fn(),
	getProductsReport: jest.fn(),
	getCustomersReport: jest.fn(),
	getChartsData: jest.fn(),
	getGrowthMetrics: jest.fn(),
}

describe('ReportsController', () => {
	let controller: ReportsController

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [ReportsController],
			providers: [{ provide: ReportsService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.overrideGuard(FeatureGuard)
			.useValue({ canActivate: () => true })
			.compile()

		controller = module.get(ReportsController)
		jest.clearAllMocks()
	})

	describe('getFullReport', () => {
		it('should default to month period when not specified', async () => {
			const report = { revenue: 50000, orders: 25 }
			serviceMock.getFullReport.mockResolvedValueOnce(report)

			const result = await controller.getFullReport()

			expect(serviceMock.getFullReport).toHaveBeenCalledWith('month')
			expect(result).toEqual(report)
		})

		it('should pass the specified period to the service', async () => {
			serviceMock.getFullReport.mockResolvedValueOnce({})

			await controller.getFullReport('year')

			expect(serviceMock.getFullReport).toHaveBeenCalledWith('year')
		})
	})

	describe('getSalesReport', () => {
		it('should return sales report with date range', async () => {
			const report = { totalSales: 200, totalRevenue: 100000 }
			serviceMock.getSalesReport.mockResolvedValueOnce(report)

			const result = await controller.getSalesReport('2024-01-01', '2024-01-31')

			expect(serviceMock.getSalesReport).toHaveBeenCalledWith('2024-01-01', '2024-01-31')
			expect(result).toEqual(report)
		})

		it('should pass undefined when no date range specified', async () => {
			serviceMock.getSalesReport.mockResolvedValueOnce({})

			await controller.getSalesReport()

			expect(serviceMock.getSalesReport).toHaveBeenCalledWith(undefined, undefined)
		})
	})

	describe('getProductsReport', () => {
		it('should use default limit of 10 when not specified', async () => {
			serviceMock.getProductsReport.mockResolvedValueOnce([])

			await controller.getProductsReport()

			expect(serviceMock.getProductsReport).toHaveBeenCalledWith(10)
		})

		it('should parse limit query param as integer', async () => {
			serviceMock.getProductsReport.mockResolvedValueOnce([])

			await controller.getProductsReport('25')

			expect(serviceMock.getProductsReport).toHaveBeenCalledWith(25)
		})
	})

	describe('getCustomersReport', () => {
		it('should use default limit of 10 when not specified', async () => {
			serviceMock.getCustomersReport.mockResolvedValueOnce([])

			await controller.getCustomersReport()

			expect(serviceMock.getCustomersReport).toHaveBeenCalledWith(10)
		})

		it('should parse limit as integer', async () => {
			serviceMock.getCustomersReport.mockResolvedValueOnce([])

			await controller.getCustomersReport('5')

			expect(serviceMock.getCustomersReport).toHaveBeenCalledWith(5)
		})
	})

	describe('getChartsData', () => {
		it('should default to month period', async () => {
			const charts = { labels: [], datasets: [] }
			serviceMock.getChartsData.mockResolvedValueOnce(charts)

			const result = await controller.getChartsData()

			expect(serviceMock.getChartsData).toHaveBeenCalledWith('month')
			expect(result).toEqual(charts)
		})

		it('should pass specified period', async () => {
			serviceMock.getChartsData.mockResolvedValueOnce({})

			await controller.getChartsData('week')

			expect(serviceMock.getChartsData).toHaveBeenCalledWith('week')
		})
	})

	describe('getGrowthMetrics', () => {
		it('should return growth metrics', async () => {
			const metrics = { ordersGrowth: 15.5, revenueGrowth: 22.3 }
			serviceMock.getGrowthMetrics.mockResolvedValueOnce(metrics)

			const result = await controller.getGrowthMetrics()

			expect(serviceMock.getGrowthMetrics).toHaveBeenCalled()
			expect(result).toEqual(metrics)
		})
	})
})
