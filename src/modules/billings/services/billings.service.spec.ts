import { Test } from "@nestjs/testing";
import { BillingsService } from "./billings.service";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { TenantContext } from "@/shared/tenant/tenant.context";
import { createUnitTestModule } from "@/test/helpers/unit-test.module";

const prismaMock = {
	billing: {
		findMany: jest.fn(),
		findUnique: jest.fn(),
		create: jest.fn(),
		update: jest.fn(),
	},
	order: {
		findUnique: jest.fn(),
	},
};

const tenantContextMock = {
	getSellerId: jest.fn().mockReturnValue("test-seller-id"),
	requireSellerId: jest.fn().mockReturnValue("test-seller-id"),
	isAdmin: jest.fn().mockReturnValue(false),
};

describe("BillingsService", () => {
	let service: BillingsService;

	beforeEach(async () => {
		const module = await createUnitTestModule([
			BillingsService,
			{ provide: PrismaService, useValue: prismaMock },
			{ provide: TenantContext, useValue: tenantContextMock },
		]).compile();

		service = module.get(BillingsService);
		jest.clearAllMocks();
	});

	it("listByOrder should call prisma.findMany with tenant filter", async () => {
		prismaMock.billing.findMany.mockResolvedValueOnce([]);
		const res = await service.listByOrder(1);
		expect(prismaMock.billing.findMany).toHaveBeenCalled();
		expect(res).toEqual([]);
	});

	it("create should map dates and set order_id", async () => {
		prismaMock.order.findUnique.mockResolvedValueOnce({
			id: 2,
			seller_id: "test-seller-id",
		});
		prismaMock.billing.create.mockResolvedValueOnce({ id: 1 });
		const res = await service.create(2, {
			billing_number: "B-1",
			total_amount: 1000,
			due_date: "2025-01-01T00:00:00.000Z",
		} as any);
		expect(prismaMock.billing.create).toHaveBeenCalled();
		const call = prismaMock.billing.create.mock.calls[0][0];
		expect(call.data.order_id).toBe(2);
		expect(call.data.due_date instanceof Date).toBe(true);
		expect(res).toEqual({ id: 1 });
	});

	it("update should map nullable dates", async () => {
		prismaMock.billing.findUnique.mockResolvedValueOnce({
			id: 3,
			order: { seller_id: "test-seller-id" },
		});
		prismaMock.billing.update.mockResolvedValueOnce({ id: 3 });
		const res = await service.update(3, {
			payment_date: undefined,
			notes: "ok",
		} as any);
		expect(prismaMock.billing.update).toHaveBeenCalledWith({
			where: { id: 3 },
			data: expect.objectContaining({ notes: "ok", payment_date: undefined }),
		});
		expect(res).toEqual({ id: 3 });
	});
});
