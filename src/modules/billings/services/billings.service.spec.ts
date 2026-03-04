import { Test } from "@nestjs/testing";
import { BillingsService } from "./billings.service";
import { BILLING_REPOSITORY } from "@/shared/repositories/billing.repository";
import { TenantContext } from "@/shared/tenant/tenant.context";

const repositoryMock = {
	findAll: jest.fn(),
	findByOrderId: jest.fn(),
	findById: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	verifyOrderAccess: jest.fn(),
};

const tenantContextMock = {
	getSellerId: jest.fn().mockReturnValue("test-seller-id"),
	requireSellerId: jest.fn().mockReturnValue("test-seller-id"),
	isAdmin: jest.fn().mockReturnValue(false),
};

describe("BillingsService", () => {
	let service: BillingsService;

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				BillingsService,
				{ provide: BILLING_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
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
		).rejects.toThrow("Order not found");
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
		await expect(service.update(999, {} as any)).rejects.toThrow("Billing not found");
	});
});
