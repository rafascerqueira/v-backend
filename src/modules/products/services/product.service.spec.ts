import { Test, type TestingModule } from "@nestjs/testing";
import { ProductService } from "./product.service";
import {
	PRODUCT_REPOSITORY,
	type ProductRepository,
	type Product,
	type CreateProductData,
	type UpdateProductData,
} from "@/shared/repositories/product.repository";
import { PrismaService } from "@/shared/prisma/prisma.service";
import { TenantContext } from "@/shared/tenant/tenant.context";

describe("ProductService", () => {
	let service: ProductService;
	let productRepository: jest.Mocked<ProductRepository>;

	let productsStore: Product[];
	let idSeq: number;

	const createRepositoryMock = (): jest.Mocked<ProductRepository> => {
		productsStore = [];
		idSeq = 1;
		return {
			create: jest.fn(async (data: CreateProductData): Promise<Product> => {
				const newItem: Product = {
					id: idSeq++,
					deletedAt: null,
					createdAt: new Date(),
					updatedAt: new Date(),
					seller_id: data.seller_id,
					name: data.name,
					description: data.description || null,
					sku: data.sku || null,
					category: data.category || null,
					brand: data.brand || null,
					unit: data.unit,
					specifications: data.specifications || {},
					images: data.images || [],
					active: data.active ?? true,
				};
				productsStore.push(newItem);
				return newItem;
			}),
			findAll: jest.fn(async () => [...productsStore]),
			findAllPaginated: jest.fn(
				async (params: {
					page: number;
					limit: number;
					search?: string;
					category?: string;
					status?: string;
					sortBy?: string;
					sortOrder?: "asc" | "desc";
				}) => {
					const { page, limit } = params;
					const start = (page - 1) * limit;
					const end = start + limit;
					const data = productsStore.slice(start, end);
					return { data, total: productsStore.length };
				},
			),
			findById: jest.fn(async (id: number) => {
				return productsStore.find((p) => p.id === id) ?? null;
			}),
			findBySku: jest.fn(async (sellerId: string, sku: string) => {
				return (
					productsStore.find(
						(p) => p.sku === sku && p.seller_id === sellerId,
					) ?? null
				);
			}),
			update: jest.fn(async (id: number, data: UpdateProductData) => {
				const idx = productsStore.findIndex((p) => p.id === id);
				if (idx === -1) throw new Error("Not found");
				productsStore[idx] = { ...productsStore[idx], ...data };
				return productsStore[idx];
			}),
			softDelete: jest.fn(async (id: number) => {
				const idx = productsStore.findIndex((p) => p.id === id);
				if (idx === -1) throw new Error("Not found");
				productsStore[idx].deletedAt = new Date();
				return productsStore[idx];
			}),
		};
	};

	beforeEach(async () => {
		const repositoryMock = createRepositoryMock();
		const prismaMock = {
			product_price: {
				updateMany: jest.fn(),
				create: jest.fn(),
				findMany: jest.fn(),
			},
			$transaction: jest.fn((callback) => callback(prismaMock)),
		};

		const tenantMock = {
			getSellerId: () => "test-seller-id",
			getRole: () => "seller",
			isAdmin: () => false,
			requireSellerId: () => "test-seller-id",
		};

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				ProductService,
				{ provide: PRODUCT_REPOSITORY, useValue: repositoryMock },
				{ provide: PrismaService, useValue: prismaMock },
				{ provide: TenantContext, useValue: tenantMock },
			],
		}).compile();

		service = module.get<ProductService>(ProductService);
		productRepository = module.get(PRODUCT_REPOSITORY);
	});

	it("should be defined", () => {
		expect(service).toBeDefined();
	});

	describe("create", () => {
		const productData = {
			seller_id: "test-seller-id",
			name: "Test Product",
			description: "Test Description",
			sku: "TEST-SKU-001",
			category: "Electronics",
			brand: "Test Brand",
			unit: "piece",
			specifications: { imported: false },
			images: ["image1.jpg"],
			active: true,
		};

		it("should create a product", async () => {
			const result = await service.create(productData);

			expect(productRepository.create).toHaveBeenCalledWith(productData);
			expect(result).toBeTruthy();
			expect(result?.name).toBe(productData.name);
		});
	});

	describe("findAll", () => {
		it("should return all products", async () => {
			await productRepository.create({
				seller_id: "test-seller-id",
				name: "Product 1",
				sku: "SKU-001",
				unit: "piece",
			});
			await productRepository.create({
				seller_id: "test-seller-id",
				name: "Product 2",
				sku: "SKU-002",
				unit: "piece",
			});

			const result = await service.findAll();

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe("Product 1");
		});
	});

	describe("findById", () => {
		it("should find product by id", async () => {
			const created = await productRepository.create({
				seller_id: "test-seller-id",
				name: "Test Product",
				sku: "TEST-SKU",
				unit: "piece",
			});

			const result = await service.findById(created.id.toString());

			expect(result).toBeTruthy();
			expect(result?.id).toBe(created.id);
		});
	});

	describe("update", () => {
		it("should update product", async () => {
			const created = await productRepository.create({
				seller_id: "test-seller-id",
				name: "Original Product",
				sku: "ORIG-SKU",
				unit: "piece",
			});

			const result = await service.update(created.id.toString(), {
				name: "Updated Product",
			});

			expect(result).toBeTruthy();
			expect(result?.name).toBe("Updated Product");
		});
	});

	describe("remove", () => {
		it("should soft delete product", async () => {
			const created = await productRepository.create({
				seller_id: "test-seller-id",
				name: "To Delete Product",
				sku: "DELETE-SKU",
				unit: "piece",
			});

			const result = await service.remove(created.id.toString());

			expect(result).toBeTruthy();
			expect(result?.deletedAt).toBeTruthy();
		});
	});
});
