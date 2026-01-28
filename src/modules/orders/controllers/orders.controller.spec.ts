import { Test } from "@nestjs/testing";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "../services/orders.service";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";

const serviceMock = {
	create: jest.fn(),
	addItem: jest.fn(),
	findById: jest.fn(),
	findAll: jest.fn(),
	updateStatus: jest.fn(),
	delete: jest.fn(),
};

describe("OrdersController", () => {
	let controller: OrdersController;

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [OrdersController],
			providers: [{ provide: OrdersService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile();

		controller = module.get(OrdersController);
		jest.clearAllMocks();
	});

	it("create should call service.create and return order", async () => {
		const dto: any = {
			customer_id: "c1",
			order_number: "ORD-1",
			items: [{ product_id: 1, quantity: 1, unit_price: 1000 }],
		};
		serviceMock.create.mockResolvedValueOnce({ id: 1, ...dto });
		const res = await controller.create(dto);
		expect(serviceMock.create).toHaveBeenCalledWith(dto);
		expect(res.id).toBe(1);
	});

	it("addItem should call service.addItem with numeric order id", async () => {
		const item: any = { product_id: 2, quantity: 3, unit_price: 500 };
		serviceMock.addItem.mockResolvedValueOnce({ id: 10, order_id: 7, ...item });
		const res = await controller.addItem("7", item);
		expect(serviceMock.addItem).toHaveBeenCalledWith(7, item);
		expect(res.order_id).toBe(7);
	});

	it("get should call service.findById with numeric id", async () => {
		serviceMock.findById.mockResolvedValueOnce({ id: 5 });
		const res = await controller.get("5");
		expect(serviceMock.findById).toHaveBeenCalledWith(5);
		expect(res).toEqual({ id: 5 });
	});
});
