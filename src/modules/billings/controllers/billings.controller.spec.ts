import { Test } from "@nestjs/testing";
import { BillingsController } from "./billings.controller";
import { BillingsService } from "../services/billings.service";

const serviceMock = {
	listByOrder: jest.fn(),
	create: jest.fn(),
	update: jest.fn(),
	findAll: jest.fn(),
};

describe("BillingsController", () => {
	let controller: BillingsController;

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [BillingsController],
			providers: [{ provide: BillingsService, useValue: serviceMock }],
		}).compile();

		controller = module.get(BillingsController);
		jest.clearAllMocks();
	});

	it("list should call service.listByOrder with numeric id", async () => {
		serviceMock.listByOrder.mockResolvedValueOnce([{ id: 1 }]);
		const res = await controller.list("42");
		expect(serviceMock.listByOrder).toHaveBeenCalledWith(42);
		expect(res).toEqual([{ id: 1 }]);
	});

	it("create should call service.create with numeric orderId and body", async () => {
		const dto: any = {
			billing_number: "B-1",
			total_amount: 1000,
			paid_amount: 0,
			status: "pending",
		};
		serviceMock.create.mockResolvedValueOnce({ id: 10, order_id: 7, ...dto });
		const res = await controller.create("7", dto);
		expect(serviceMock.create).toHaveBeenCalledWith(7, dto);
		expect(res).toEqual({ id: 10, order_id: 7, ...dto });
	});

	it("update should call service.update with numeric id and body", async () => {
		const dto: any = { paid_amount: 500, status: "paid" };
		serviceMock.update.mockResolvedValueOnce({ id: 9, ...dto });
		const res = await controller.update("9", dto);
		expect(serviceMock.update).toHaveBeenCalledWith(9, dto);
		expect(res).toEqual({ id: 9, ...dto });
	});
});
