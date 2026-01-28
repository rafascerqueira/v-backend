import { BadRequestException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { StockMovementsService } from "./stock-movements.service";

function makePrismaMock() {
	const tx = {
		product: { findUnique: jest.fn() },
		store_stock: { findUnique: jest.fn(), upsert: jest.fn() },
		stock_movement: { create: jest.fn() },
	};
	const prisma = {
		$transaction: jest.fn((fn: any) => fn(tx)),
		stock_movement: { findMany: jest.fn() },
	};
	return { prisma, tx };
}

describe("StockMovementsService", () => {
	let service: StockMovementsService;
	let prismaMock: ReturnType<typeof makePrismaMock>["prisma"];
	let tx: ReturnType<typeof makePrismaMock>["tx"];

	beforeEach(async () => {
		const mocks = makePrismaMock();
		prismaMock = mocks.prisma as any;
		tx = mocks.tx as any;

		const module = await Test.createTestingModule({
			providers: [
				StockMovementsService,
				{ provide: PrismaService, useValue: prismaMock },
			],
		}).compile();

		service = module.get(StockMovementsService);
		jest.clearAllMocks();
	});

	it("listByProduct should query prisma with sorting", async () => {
		(prismaMock.stock_movement.findMany as jest.Mock).mockResolvedValueOnce([]);
		await service.listByProduct(10);
		expect(prismaMock.stock_movement.findMany).toHaveBeenCalledWith({
			where: { product_id: 10 },
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		});
	});

	it("create IN movement should increase stock and create movement", async () => {
		tx.product.findUnique.mockResolvedValueOnce({
			id: 1,
			seller_id: "test-seller",
		});
		tx.store_stock.findUnique.mockResolvedValueOnce({
			product_id: 1,
			quantity: 2,
			reserved_quantity: 0,
			min_stock: 0,
			max_stock: 0,
		});
		tx.store_stock.upsert.mockResolvedValueOnce({ product_id: 1, quantity: 7 });
		tx.stock_movement.create.mockResolvedValueOnce({ id: 1, product_id: 1 });

		const res = await service.create({
			movement_type: "in",
			reference_type: "purchase",
			reference_id: 1,
			product_id: 1,
			quantity: 5,
		});

		expect(tx.store_stock.upsert).toHaveBeenCalledWith({
			where: { product_id: 1 },
			create: {
				seller_id: "test-seller",
				product_id: 1,
				quantity: 7,
				reserved_quantity: 0,
				min_stock: 0,
				max_stock: 0,
			},
			update: { quantity: 7 },
		});
		expect(tx.stock_movement.create).toHaveBeenCalled();
		expect(res).toEqual({ id: 1, product_id: 1 });
	});

	it("create OUT movement should decrease stock", async () => {
		tx.product.findUnique.mockResolvedValueOnce({
			id: 1,
			seller_id: "test-seller",
		});
		tx.store_stock.findUnique.mockResolvedValueOnce({
			product_id: 1,
			quantity: 5,
			reserved_quantity: 0,
			min_stock: 0,
			max_stock: 0,
		});
		tx.store_stock.upsert.mockResolvedValueOnce({ product_id: 1, quantity: 2 });
		tx.stock_movement.create.mockResolvedValueOnce({ id: 2, product_id: 1 });

		const res = await service.create({
			movement_type: "out",
			reference_type: "sale",
			reference_id: 2,
			product_id: 1,
			quantity: 3,
		});

		expect(tx.store_stock.upsert).toHaveBeenCalledWith({
			where: { product_id: 1 },
			create: {
				seller_id: "test-seller",
				product_id: 1,
				quantity: 2,
				reserved_quantity: 0,
				min_stock: 0,
				max_stock: 0,
			},
			update: { quantity: 2 },
		});
		expect(res).toEqual({ id: 2, product_id: 1 });
	});

	it("should reject OUT when insufficient stock", async () => {
		tx.product.findUnique.mockResolvedValueOnce({
			id: 1,
			seller_id: "test-seller",
		});
		tx.store_stock.findUnique.mockResolvedValueOnce({
			product_id: 1,
			quantity: 1,
			reserved_quantity: 0,
			min_stock: 0,
			max_stock: 0,
		}),
			await expect(
				service.create({
					movement_type: "out",
					reference_type: "sale",
					reference_id: 3,
					product_id: 1,
					quantity: 5,
				}),
			).rejects.toBeInstanceOf(BadRequestException);
	});

	it("should reject when product not found", async () => {
		tx.product.findUnique.mockResolvedValueOnce(null);
		await expect(
			service.create({
				movement_type: "in",
				reference_type: "purchase",
				reference_id: 4,
				product_id: 9,
				quantity: 1,
			}),
		).rejects.toBeInstanceOf(BadRequestException);
	});
});
