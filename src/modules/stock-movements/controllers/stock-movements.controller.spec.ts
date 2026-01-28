import { Test } from "@nestjs/testing";
import { StockMovementsController } from "./stock-movements.controller";
import { StockMovementsService } from "../services/stock-movements.service";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";

const serviceMock = {
	listByProduct: jest.fn(),
	create: jest.fn(),
};

describe("StockMovementsController", () => {
	let controller: StockMovementsController;

	beforeEach(async () => {
		const module = await Test.createTestingModule({
			controllers: [StockMovementsController],
			providers: [{ provide: StockMovementsService, useValue: serviceMock }],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile();

		controller = module.get(StockMovementsController);
		jest.clearAllMocks();
	});

	it("list should call service.listByProduct with numeric id", async () => {
		serviceMock.listByProduct.mockResolvedValueOnce([{ id: 1 }]);
		const res = await controller.list("42");
		expect(serviceMock.listByProduct).toHaveBeenCalledWith(42);
		expect(res).toEqual([{ id: 1 }]);
	});

	it("create should call service.create and return movement", async () => {
		const dto = {
			movement_type: "in" as const,
			reference_type: "purchase" as const,
			reference_id: 1,
			product_id: 1,
			quantity: 10,
		};
		serviceMock.create.mockResolvedValueOnce({ id: 1, ...dto });
		const res = await controller.create(dto);
		expect(serviceMock.create).toHaveBeenCalledWith(dto);
		expect(res).toEqual({ id: 1, ...dto });
	});
});
