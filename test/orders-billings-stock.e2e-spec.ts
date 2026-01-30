import cookie from "@fastify/cookie";
import { Test, type TestingModule } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/shared/prisma/prisma.service";

describe("Orders + Billings + StoreStock (e2e)", () => {
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
		await prisma.billing.deleteMany();
		await prisma.order_item.deleteMany();
		await prisma.order.deleteMany();
		await prisma.store_stock.deleteMany();
		await prisma.product.deleteMany();
		await prisma.customer.deleteMany();
		await app.close();
	});

	it("should create order, billing and manage store stock", async () => {
		// create customer
		const customerPayload = {
			name: "John Doe",
			email: `john-${Date.now()}@example.com`,
			phone: "11999999999",
			document: "12345678901",
			address: { street: "A", neighborhood: "B" },
			city: "Sao Paulo",
			state: "SP",
			zip_code: "01234000",
		};
		const customerRes = await request(app.getHttpServer())
			.post("/customers")
			.send(customerPayload)
			.expect(201);
		const customer = customerRes.body;

		// create product
		const productPayload = {
			name: "Test Product",
			description: "Desc",
			sku: `SKU-${Date.now()}`,
			category: "Category",
			brand: "Brand",
			unit: "un",
			specifications: { imported: false, moreinfo: "1kg" },
			images: ["https://example.com/p.png"],
			active: true,
		};
		const productRes = await request(app.getHttpServer())
			.post("/product/create-product")
			.send(productPayload)
			.expect(201);
		const product = productRes.body;

		// create order with 1 item
		const orderPayload = {
			customer_id: customer.id,
			order_number: `ORD-${Date.now()}`,
			items: [
				{
					product_id: product.id,
					quantity: 2,
					unit_price: 1500,
					discount: 100,
				},
			],
			notes: "first order",
		};
		const orderRes = await request(app.getHttpServer())
			.post("/orders")
			.send(orderPayload);
		if (orderRes.status !== 201) {
			// Log validation error
			// eslint-disable-next-line no-console
			console.error(
				"Order create error:",
				orderRes.status,
				JSON.stringify(orderRes.body, null, 2),
			);
		}
		expect(orderRes.status).toBe(201);
		const order = orderRes.body;

		// fetch order
		await request(app.getHttpServer()).get(`/orders/${order.id}`).expect(200);

		// create billing for order
		const billingPayload = {
			billing_number: `BILL-${Date.now()}`,
			total_amount: 2900,
			paid_amount: 0,
			payment_method: "cash",
			payment_status: "pending",
			status: "pending",
		};
		const billingRes = await request(app.getHttpServer())
			.post(`/orders/${order.id}/billings`)
			.send(billingPayload)
			.expect(201);
		expect(billingRes.body.order_id).toBe(order.id);

		// list billings for order
		const listRes = await request(app.getHttpServer())
			.get(`/orders/${order.id}/billings`)
			.expect(200);
		expect(Array.isArray(listRes.body)).toBe(true);
		expect(listRes.body.length).toBeGreaterThanOrEqual(1);

		// upsert store stock for product
		const upsertRes = await request(app.getHttpServer())
			.patch(`/store-stock/${product.id}`)
			.send({ quantity: 10 })
			.expect(200);
		expect(upsertRes.body.product_id).toBe(product.id);

		// get store stock
		const getRes = await request(app.getHttpServer())
			.get(`/store-stock/${product.id}`)
			.expect(200);
		expect(getRes.body.quantity).toBe(10);
	});
});
