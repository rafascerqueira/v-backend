import { Test, TestingModule } from "@nestjs/testing";
import { UpdateProductController } from "./update-product.controller";
import { ProductService } from "../services/product.service";
import { JwtAuthGuard } from "@/modules/auth/guards/jwt-auth.guard";

describe("UpdateProductController", () => {
	let controller: UpdateProductController;
	let productService: ProductService;

	const mockProductService = {
		update: jest.fn(),
	};

	beforeEach(async () => {
		const module: TestingModule = await Test.createTestingModule({
			controllers: [UpdateProductController],
			providers: [
				{
					provide: ProductService,
					useValue: mockProductService,
				},
			],
		})
			.overrideGuard(JwtAuthGuard)
			.useValue({ canActivate: () => true })
			.compile();

		controller = module.get<UpdateProductController>(UpdateProductController);
		productService = module.get<ProductService>(ProductService);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	it("should be defined", () => {
		expect(controller).toBeDefined();
	});

	describe("handle", () => {
		it("should update a product with all fields", async () => {
			const productId = "123";
			const updateData = {
				name: "Updated Product",
				description: "Updated Description",
				sku: "SKU123",
				category: "Electronics",
				brand: "TestBrand",
				unit: "piece",
				specifications: {
					imported: true,
					moreinfo: "Additional info",
				},
				images: ["image1.jpg", "image2.jpg"],
				active: true,
			};

			const expectedResult = {
				id: 123,
				...updateData,
				createdAt: new Date(),
				updatedAt: new Date(),
			};

			mockProductService.update.mockResolvedValue(expectedResult);

			const result = await controller.handle(productId, updateData);

			expect(result).toBe(expectedResult);
			expect(productService.update).toHaveBeenCalledWith(productId, updateData);
			expect(productService.update).toHaveBeenCalledTimes(1);
		});

		it("should update a product with partial fields", async () => {
			const productId = "456";
			const updateData = {
				name: "Partial Update",
				active: false,
			};

			const expectedResult = {
				id: 456,
				name: "Partial Update",
				description: "Original Description",
				active: false,
				updatedAt: new Date(),
			};

			mockProductService.update.mockResolvedValue(expectedResult);

			const result = await controller.handle(productId, updateData);

			expect(result).toBe(expectedResult);
			expect(productService.update).toHaveBeenCalledWith(productId, updateData);
		});

		it("should update only specifications", async () => {
			const productId = "789";
			const updateData = {
				specifications: {
					imported: false,
					moreinfo: "Local product",
				},
			};

			const expectedResult = {
				id: 789,
				name: "Product",
				specifications: {
					imported: false,
					moreinfo: "Local product",
				},
				updatedAt: new Date(),
			};

			mockProductService.update.mockResolvedValue(expectedResult);

			const result = await controller.handle(productId, updateData);

			expect(result).toBe(expectedResult);
			expect(productService.update).toHaveBeenCalledWith(productId, updateData);
		});

		it("should handle service errors", async () => {
			const productId = "999";
			const updateData = {
				name: "Test Product",
			};
			const error = new Error("Product not found");

			mockProductService.update.mockRejectedValue(error);

			await expect(controller.handle(productId, updateData)).rejects.toThrow(
				"Product not found",
			);

			expect(productService.update).toHaveBeenCalledWith(productId, updateData);
		});

		it("should handle empty update object", async () => {
			const productId = "123";
			const updateData = {};

			const expectedResult = {
				id: 123,
				name: "Original Product",
				updatedAt: new Date(),
			};

			mockProductService.update.mockResolvedValue(expectedResult);

			const result = await controller.handle(productId, updateData);

			expect(result).toBe(expectedResult);
			expect(productService.update).toHaveBeenCalledWith(productId, updateData);
		});
	});
});
