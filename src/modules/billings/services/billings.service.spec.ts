import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { BillingsService } from "./billings.service";
import { BILLING_REPOSITORY } from "@/shared/repositories/billing.repository";
import { RedisService } from "@/shared/redis/redis.service";
import { TenantContext } from "@/shared/tenant/tenant.context";

const repositoryMock = {
	findAll: jest.fn(),
	findByOrderId: jest.fn(),
	findById: jest.fn(),
	findUnbilledPerSaleOrders: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	delete: jest.fn(),
	verifyOrderAccess: jest.fn(),
};

const tenantContextMock = {
	getSellerId: jest.fn().mockReturnValue("test-seller-id"),
	requireSellerId: jest.fn().mockReturnValue("test-seller-id"),
	isAdmin: jest.fn().mockReturnValue(false),
};

const redisMock = {
	delete: jest.fn().mockResolvedValue(undefined),
};

describe("BillingsService", () => {
	let service: BillingsService;

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				BillingsService,
				{ provide: BILLING_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: RedisService, useValue: redisMock },
			],
		}).compile();

		service = module.get(BillingsService);
		jest.clearAllMocks();
	});

	it("listByOrder should delegate to repository", async () => {
		repositoryMock.findByOrderId.mockResolvedValueOnce([]);
		const res = await service.listByOrder(1);
		expect(repositoryMock.findByOrderId).toHaveBeenCalledWith(1, {});
		expect(res).toEqual([]);
	});

	it("create should map dates and delegate to repository", async () => {
		repositoryMock.verifyOrderAccess.mockResolvedValueOnce({
			id: 2,
			seller_id: "test-seller-id",
		});
		repositoryMock.create.mockResolvedValueOnce({ id: 1 });
		const res = await service.create(2, {
			billing_number: "B-1",
			total_amount: 1000,
			due_date: "2025-01-01T00:00:00.000Z",
		} as any);
		expect(repositoryMock.create).toHaveBeenCalled();
		const call = repositoryMock.create.mock.calls[0][0];
		expect(call.order_id).toBe(2);
		expect(call.due_date instanceof Date).toBe(true);
		expect(res).toEqual({ id: 1 });
	});

	it("create should throw if order not found", async () => {
		repositoryMock.verifyOrderAccess.mockResolvedValueOnce(null);
		await expect(
			service.create(999, { billing_number: "B-X" } as any),
		).rejects.toThrow(NotFoundException);
	});

	it("update should map nullable dates and delegate to repository", async () => {
		repositoryMock.findById.mockResolvedValueOnce({
			id: 3,
			order: { seller_id: "test-seller-id" },
		});
		repositoryMock.update.mockResolvedValueOnce({ id: 3 });
		const res = await service.update(3, {
			payment_date: undefined,
			notes: "ok",
		} as any);
		expect(repositoryMock.update).toHaveBeenCalledWith(
			3,
			expect.objectContaining({ notes: "ok", payment_date: undefined }),
		);
		expect(res).toEqual({ id: 3 });
	});

	it("update should throw if billing not found", async () => {
		repositoryMock.findById.mockResolvedValueOnce(null);
		await expect(service.update(999, {} as any)).rejects.toThrow(NotFoundException);
	});

	it("syncBillings should create billings for unbilled per_sale orders", async () => {
		repositoryMock.findUnbilledPerSaleOrders.mockResolvedValueOnce([
			{ id: 1, order_number: "ORD-001", total: 10000, seller_id: "s1" },
			{ id: 2, order_number: "ORD-002", total: 10177, seller_id: "s1" },
		]);
		repositoryMock.create.mockResolvedValue({ id: 99 });

		const result = await service.syncBillings();

		expect(result.created).toBe(2);
		expect(result.orders).toEqual(["COB-001", "COB-002"]);
		expect(repositoryMock.create).toHaveBeenCalledTimes(2);
		expect(repositoryMock.create).toHaveBeenCalledWith(
			expect.objectContaining({
				order_id: 1,
				billing_number: "COB-001",
				total_amount: 10000,
				paid_amount: 0,
				status: "pending",
			}),
		);
	});

	it("syncBillings should return empty when no unbilled orders", async () => {
		repositoryMock.findUnbilledPerSaleOrders.mockResolvedValueOnce([]);
		const result = await service.syncBillings();
		expect(result.created).toBe(0);
		expect(result.orders).toEqual([]);
	});

	describe("findAll", () => {
		it("should pass status filter to repository when not overdue", async () => {
			repositoryMock.findAll.mockResolvedValueOnce([]);
			await service.findAll("pending");
			expect(repositoryMock.findAll).toHaveBeenCalledWith({ status: "pending" });
		});

		it("should pass empty filter for overdue and filter in-memory", async () => {
			const billings = [
				{ id: 1, status: "overdue" },
				{ id: 2, status: "pending" },
			];
			repositoryMock.findAll.mockResolvedValueOnce(billings);
			const result = await service.findAll("overdue");
			expect(repositoryMock.findAll).toHaveBeenCalledWith({});
			expect(result).toEqual([{ id: 1, status: "overdue" }]);
		});

		it("should return all billings when no status given", async () => {
			const billings = [{ id: 1, status: "pending" }, { id: 2, status: "paid" }];
			repositoryMock.findAll.mockResolvedValueOnce(billings);
			const result = await service.findAll();
			expect(repositoryMock.findAll).toHaveBeenCalledWith({});
			expect(result).toHaveLength(2);
		});
	});

	describe("create overpayment guard", () => {
		it("should throw BadRequestException when paid_amount exceeds total_amount", async () => {
			repositoryMock.verifyOrderAccess.mockResolvedValueOnce({ id: 1, seller_id: "test-seller-id" });
			await expect(
				service.create(1, { billing_number: "B-1", total_amount: 500, paid_amount: 600 } as any),
			).rejects.toThrow(BadRequestException);
		});
	});

	describe("update", () => {
		it("should throw ForbiddenException when seller does not own billing", async () => {
			repositoryMock.findById.mockResolvedValueOnce({
				id: 5,
				order: { seller_id: "other-seller" },
			});
			await expect(service.update(5, { notes: "x" } as any)).rejects.toThrow(ForbiddenException);
		});

		it("should throw BadRequestException when paid_amount exceeds total_amount after merge", async () => {
			repositoryMock.findById.mockResolvedValueOnce({
				id: 6,
				total_amount: 1000,
				paid_amount: 0,
				payment_date: null,
				order: { seller_id: "test-seller-id" },
			});
			await expect(
				service.update(6, { paid_amount: 1500 } as any),
			).rejects.toThrow(BadRequestException);
		});

		it("should auto-set payment_date when paid_amount > 0 and no existing payment_date", async () => {
			repositoryMock.findById.mockResolvedValueOnce({
				id: 7,
				total_amount: 1000,
				paid_amount: 0,
				payment_date: null,
				order: { seller_id: "test-seller-id" },
			});
			repositoryMock.update.mockResolvedValueOnce({ id: 7 });
			await service.update(7, { paid_amount: 500 } as any);
			const call = repositoryMock.update.mock.calls[0][1];
			expect(call.payment_date).toBeInstanceOf(Date);
		});

		it("should not override payment_date when already set", async () => {
			const existingDate = new Date("2025-06-01");
			repositoryMock.findById.mockResolvedValueOnce({
				id: 8,
				total_amount: 1000,
				paid_amount: 0,
				payment_date: existingDate,
				order: { seller_id: "test-seller-id" },
			});
			repositoryMock.update.mockResolvedValueOnce({ id: 8 });
			await service.update(8, { paid_amount: 500 } as any);
			const call = repositoryMock.update.mock.calls[0][1];
			expect(call.payment_date).toBeUndefined();
		});
	});

	describe("delete", () => {
		it("should throw NotFoundException when billing not found", async () => {
			repositoryMock.findById.mockResolvedValueOnce(null);
			await expect(service.delete(999)).rejects.toThrow(NotFoundException);
		});

		it("should throw ForbiddenException when seller does not own billing", async () => {
			repositoryMock.findById.mockResolvedValueOnce({
				id: 10,
				order: { seller_id: "other-seller" },
			});
			await expect(service.delete(10)).rejects.toThrow(ForbiddenException);
		});

		it("should call repository.delete when authorized", async () => {
			repositoryMock.findById.mockResolvedValueOnce({
				id: 11,
				order: { seller_id: "test-seller-id" },
			});
			repositoryMock.delete.mockResolvedValueOnce(undefined);
			await service.delete(11);
			expect(repositoryMock.delete).toHaveBeenCalledWith(11);
		});

		it("should allow admin to delete any billing", async () => {
			tenantContextMock.isAdmin.mockReturnValueOnce(true);
			repositoryMock.findById.mockResolvedValueOnce({
				id: 12,
				order: { seller_id: "other-seller" },
			});
			repositoryMock.delete.mockResolvedValueOnce(undefined);
			await service.delete(12);
			expect(repositoryMock.delete).toHaveBeenCalledWith(12);
		});
	});
});
