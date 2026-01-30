import cookie from "@fastify/cookie";
import { Test, type TestingModule } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/shared/prisma/prisma.service";

describe("Auth (e2e)", () => {
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

		await app.register(cookie as any, {
			secret:
				process.env.COOKIE_SECRET || process.env.JWT_SECRET || "test-secret",
		});

		await app.init();
		await app.getHttpAdapter().getInstance().ready();
	});

	afterEach(async () => {
		await prisma.account.deleteMany();
		await app.close();
	});

	const validUser = {
		name: "Test User",
		email: "test@example.com",
		password: "Password123",
	};

	describe("POST /auth/register", () => {
		it("should register a new user", async () => {
			const response = await request(app.getHttpServer())
				.post("/auth/register")
				.send(validUser)
				.expect(201);

			expect(response.body).toEqual({});
		});

		it("should reject duplicate email", async () => {
			await request(app.getHttpServer())
				.post("/auth/register")
				.send(validUser)
				.expect(201);

			await request(app.getHttpServer())
				.post("/auth/register")
				.send(validUser)
				.expect(400);
		});

		it("should reject invalid email", async () => {
			await request(app.getHttpServer())
				.post("/auth/register")
				.send({ ...validUser, email: "invalid" })
				.expect(400);
		});

		it("should reject weak password", async () => {
			await request(app.getHttpServer())
				.post("/auth/register")
				.send({ ...validUser, password: "123" })
				.expect(400);
		});
	});

	describe("POST /auth/login", () => {
		beforeEach(async () => {
			await request(app.getHttpServer()).post("/auth/register").send(validUser);
		});

		it("should login and return tokens", async () => {
			const response = await request(app.getHttpServer())
				.post("/auth/login")
				.send({
					email: validUser.email,
					password: validUser.password,
				})
				.expect(200);

			expect(response.body).toHaveProperty("accessToken");
			expect(response.body).toHaveProperty("refreshToken");
			expect(response.body).toHaveProperty("expiresIn");
			expect(typeof response.body.accessToken).toBe("string");
			expect(typeof response.body.refreshToken).toBe("string");
		});

		it("should reject wrong password", async () => {
			await request(app.getHttpServer())
				.post("/auth/login")
				.send({
					email: validUser.email,
					password: "WrongPassword123",
				})
				.expect(401);
		});

		it("should reject non-existent user", async () => {
			await request(app.getHttpServer())
				.post("/auth/login")
				.send({
					email: "nonexistent@example.com",
					password: validUser.password,
				})
				.expect(401);
		});
	});

	describe("POST /auth/refresh", () => {
		let refreshToken: string;

		beforeEach(async () => {
			await request(app.getHttpServer()).post("/auth/register").send(validUser);

			const loginResponse = await request(app.getHttpServer())
				.post("/auth/login")
				.send({
					email: validUser.email,
					password: validUser.password,
				});

			refreshToken = loginResponse.body.refreshToken;
		});

		it("should refresh tokens", async () => {
			const response = await request(app.getHttpServer())
				.post("/auth/refresh")
				.send({ refreshToken })
				.expect(200);

			expect(response.body).toHaveProperty("accessToken");
			expect(response.body).toHaveProperty("refreshToken");
			expect(response.body.accessToken).not.toBe(refreshToken);
		});

		it("should reject invalid refresh token", async () => {
			await request(app.getHttpServer())
				.post("/auth/refresh")
				.send({ refreshToken: "invalid-token" })
				.expect(401);
		});
	});

	describe("Protected routes", () => {
		let accessToken: string;

		beforeEach(async () => {
			await request(app.getHttpServer()).post("/auth/register").send(validUser);

			const loginResponse = await request(app.getHttpServer())
				.post("/auth/login")
				.send({
					email: validUser.email,
					password: validUser.password,
				});

			accessToken = loginResponse.body.accessToken;
		});

		it("should access protected route with valid token", async () => {
			await request(app.getHttpServer())
				.get("/products")
				.set("Authorization", `Bearer ${accessToken}`)
				.expect((res) => {
					expect([200, 404]).toContain(res.status);
				});
		});

		it("should reject access without token", async () => {
			await request(app.getHttpServer()).get("/products").expect(401);
		});

		it("should reject access with invalid token", async () => {
			await request(app.getHttpServer())
				.get("/products")
				.set("Authorization", "Bearer invalid-token")
				.expect(401);
		});
	});
});
