import cookie from "@fastify/cookie";
import { Test, type TestingModule } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/shared/prisma/prisma.service";

describe("Stock Movements (e2e)", () => {
	let app: NestFastifyApplication;
	let prisma: PrismaService;

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
		await prisma.stock_movement.deleteMany();
		await prisma.store_stock.deleteMany();
		await prisma.product.deleteMany();
		await app.close();
	});

	it("should create IN and OUT movements and update store stock", async () => {
		// create product
		const productPayload = {
			name: "Stock Test",
			description: "Desc",
			sku: `SKU-${Date.now()}`,
			category: "Category",
			brand: "Brand",
			unit: "un",
			specifications: { imported: false, moreinfo: "..." },
			images: ["https://example.com/img.png"],
			active: true,
		};
		const productRes = await request(app.getHttpServer())
			.post("/product/create-product")
			.send(productPayload)
			.expect(201);
		const product = productRes.body;

		// IN movement +5
		const inRes = await request(app.getHttpServer())
			.post("/stock-movements")
			.send({
				movement_type: "in",
				reference_type: "purchase",
				reference_id: 1,
				product_id: product.id,
				quantity: 5,
			})
			.expect(201);
		expect(inRes.body.product_id).toBe(product.id);

		// OUT movement -3
		const outRes = await request(app.getHttpServer())
			.post("/stock-movements")
			.send({
				movement_type: "out",
				reference_type: "sale",
				reference_id: 2,
				product_id: product.id,
				quantity: 3,
			})
			.expect(201);
		expect(outRes.body.product_id).toBe(product.id);

		// stock should be 2
		const stockRes = await request(app.getHttpServer())
			.get(`/store-stock/${product.id}`)
			.expect(200);
		expect(stockRes.body.quantity).toBe(2);

		// list movements
		const listRes = await request(app.getHttpServer())
			.get(`/stock-movements/product/${product.id}`)
			.expect(200);
		expect(Array.isArray(listRes.body)).toBe(true);
		expect(listRes.body.length).toBe(2);
	});

	it("should reject OUT movement when insufficient stock", async () => {
		const productPayload = {
			name: "Stock Fail",
			description: "Desc",
			sku: `SKU-${Date.now()}`,
			category: "Category",
			brand: "Brand",
			unit: "un",
			specifications: { imported: false, moreinfo: "..." },
			images: ["https://example.com/img.png"],
			active: true,
		};
		const product = (
			await request(app.getHttpServer())
				.post("/product/create-product")
				.send(productPayload)
				.expect(201)
		).body;

		// try OUT without stock
		await request(app.getHttpServer())
			.post("/stock-movements")
			.send({
				movement_type: "out",
				reference_type: "sale",
				reference_id: 99,
				product_id: product.id,
				quantity: 1,
			})
			.expect(400);
	});
});
