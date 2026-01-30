import cookie from "@fastify/cookie";
import { Test, type TestingModule } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/shared/prisma/prisma.service";

describe("Products (e2e)", () => {
	let app: NestFastifyApplication;
	let prisma: PrismaService;

	// Global DB lifecycle handled by Jest globalSetup/globalTeardown

	beforeEach(async () => {
		const moduleFixture: TestingModule = await Test.createTestingModule({
			imports: [AppModule],
		}).compile();

		app = moduleFixture.createNestApplication<NestFastifyApplication>(
			new FastifyAdapter(),
		);
		prisma = app.get<PrismaService>(PrismaService);

		const { ZodExceptionFilter } = await import(
			"../src/shared/filters/zod-exception.filter"
		);
		app.useGlobalFilters(new ZodExceptionFilter());

		await app.register(cookie as any, { secret: "test-secret" });

		await app.init();
		await app.getHttpAdapter().getInstance().ready();
	});

	afterEach(async () => {
		await prisma.product.deleteMany();
		await app.close();
	});

	describe("/product/create-product (POST)", () => {
		const getValidProductData = (suffix: string = "") => ({
			name: `Integration Test Product ${suffix}`,
			description: "Test Description",
			sku: `INT-TEST-${Date.now()}-${suffix}`,
			category: "Electronics",
			brand: "Test Brand",
			unit: "piece",
			specifications: {
				imported: false,
				moreinfo: "Additional info",
			},
			images: [
				"https://example.com/image1.jpg",
				"https://example.com/image2.jpg",
			],
			active: true,
		});

		it("should create a product successfully", () => {
			return request(app.getHttpServer())
				.post("/product/create-product")
				.send(getValidProductData("001"))
				.expect(201);
		});

		it("should reject invalid product data", () => {
			const invalidData = {
				name: "",
				description: "Test Description",
				sku: "INVALID-TEST",
				category: "Electronics",
				brand: "Test Brand",
				specifications: {
					imported: false,
				},
				images: ["not-a-url"],
			};

			return request(app.getHttpServer())
				.post("/product/create-product")
				.send(invalidData)
				.expect(400);
		});

		it("should reject missing required fields", () => {
			const incompleteData = {
				name: "Test Product",
			};

			return request(app.getHttpServer())
				.post("/product/create-product")
				.send(incompleteData)
				.expect(400);
		});
	});
});
