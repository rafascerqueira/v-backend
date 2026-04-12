import { Test } from "@nestjs/testing";
import { OrdersService } from "./orders.service";
import { ORDER_REPOSITORY } from "@/shared/repositories/order.repository";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { TenantContext } from "@/shared/tenant/tenant.context";
import { CustomersService } from "../../customers/services/customers.service";
import { BillingsService } from "../../billings/services/billings.service";

const repositoryMock = {
	create: jest.fn(),
	addItem: jest.fn(),
	findById: jest.fn(),
	findAll: jest.fn(),
	updateStatus: jest.fn(),
	delete: jest.fn(),
};

const tenantContextMock = {
	getSellerId: jest.fn().mockReturnValue("test-seller-id"),
	requireSellerId: jest.fn().mockReturnValue("test-seller-id"),
	isAdmin: jest.fn().mockReturnValue(false),
};

const prismaMock = {
	$transaction: jest.fn((cb: any) => cb(prismaMock)),
	order_item: { findMany: jest.fn().mockResolvedValue([]) },
	store_stock: {
		findUnique: jest.fn().mockResolvedValue(null),
		update: jest.fn(),
	},
	stock_movement: { create: jest.fn() },
};

const customersServiceMock = {
	findOne: jest.fn().mockResolvedValue({ billing_mode: "monthly" }),
};

const billingsServiceMock = {
	create: jest.fn().mockResolvedValue({ id: 1 }),
};

describe("OrdersService", () => {
	let service: OrdersService;

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			providers: [
				OrdersService,
				{ provide: ORDER_REPOSITORY, useValue: repositoryMock },
				{ provide: TenantContext, useValue: tenantContextMock },
				{ provide: PrismaService, useValue: prismaMock },
				{ provide: CustomersService, useValue: customersServiceMock },
				{ provide: BillingsService, useValue: billingsServiceMock },
			],
		}).compile();

		service = module.get(OrdersService);
		jest.clearAllMocks();
	});

	it("create should compute totals and delegate to repository", async () => {
		const dto = {
			customer_id: "cuid123",
			order_number: "ORD-1",
			items: [
				{ product_id: 1, quantity: 2, unit_price: 1000, discount: 0 },
				{ product_id: 2, quantity: 1, unit_price: 500, discount: 100 },
			],
		};
		repositoryMock.create.mockResolvedValueOnce({ id: 1 });
		customersServiceMock.findOne.mockResolvedValueOnce({ billing_mode: "monthly" });

		const res = await service.create(dto as any);

		expect(repositoryMock.create).toHaveBeenCalled();
		const call = repositoryMock.create.mock.calls[0][0];
		expect(call.subtotal).toBe(2500);
		expect(call.discount).toBe(100);
		expect(call.total).toBe(2400);
		expect(call.items).toHaveLength(2);
		expect(call.seller_id).toBe("test-seller-id");
		expect(res).toEqual({ id: 1 });
		expect(billingsServiceMock.create).not.toHaveBeenCalled();
	});

	it("create should auto-create billing for per_sale customer", async () => {
		const dto = {
			customer_id: "cuid-ps",
			order_number: "ORD-100",
			items: [
				{ product_id: 1, quantity: 1, unit_price: 5000, discount: 0 },
			],
		};
		repositoryMock.create.mockResolvedValueOnce({ id: 10 });
		customersServiceMock.findOne.mockResolvedValueOnce({ billing_mode: "per_sale" });

		await service.create(dto as any);

		expect(billingsServiceMock.create).toHaveBeenCalledWith(10, expect.objectContaining({
			billing_number: "COB-100",
			total_amount: 5000,
			paid_amount: 0,
			status: "pending",
		}));
	});

	it("addItem should compute total and delegate to repository", async () => {
		repositoryMock.addItem.mockResolvedValueOnce({ id: 10 });
		const res = await service.addItem(1, {
			product_id: 3,
			quantity: 2,
			unit_price: 300,
			discount: 50,
		} as any);
		expect(repositoryMock.addItem).toHaveBeenCalledWith({
			order_id: 1,
			product_id: 3,
			quantity: 2,
			unit_price: 300,
			discount: 50,
			total: 550,
		});
		expect(res).toEqual({ id: 10 });
	});

	it("findById delegates to repository", async () => {
		repositoryMock.findById.mockResolvedValueOnce({
			id: 1,
			seller_id: "test-seller-id",
		});
		const res = await service.findById(1);
		expect(repositoryMock.findById).toHaveBeenCalledWith(1);
		expect(res).toEqual({ id: 1, seller_id: "test-seller-id" });
	});

	it("findAll delegates to repository", async () => {
		repositoryMock.findAll.mockResolvedValueOnce([{ id: 1 }]);
		const res = await service.findAll();
		expect(repositoryMock.findAll).toHaveBeenCalledWith({});
		expect(res).toEqual([{ id: 1 }]);
	});

	it("delete should throw if order not found", async () => {
		repositoryMock.findById.mockResolvedValueOnce(null);
		await expect(service.delete(999)).rejects.toThrow(
			"Order not found or access denied",
		);
		expect(repositoryMock.delete).not.toHaveBeenCalled();
	});

	it("delete should delegate to repository when order exists", async () => {
		repositoryMock.findById.mockResolvedValueOnce({ id: 5, seller_id: "test-seller-id" });
		repositoryMock.delete.mockResolvedValueOnce({ id: 5 });
		const res = await service.delete(5);
		expect(repositoryMock.delete).toHaveBeenCalledWith(5);
		expect(res).toEqual({ id: 5 });
	});
});
