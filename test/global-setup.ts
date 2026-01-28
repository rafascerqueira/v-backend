import { execSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

module.exports = async () => {
	// Start test database container
	execSync("docker compose -f docker-compose.test.yml up -d", {
		stdio: "inherit",
	});

	// Ensure DATABASE_URL points to test DB on port 5433
	const testDbUrl =
		"postgresql://test_user:test_password@localhost:5433/test_db";
	process.env.DATABASE_URL = testDbUrl;

	// Wait for DB to be ready by trying to connect with Prisma
	const adapter = new PrismaPg({ connectionString: testDbUrl });
	const prisma = new PrismaClient({ adapter });

	const timeoutMs = 60000;
	const start = Date.now();
	// eslint-disable-next-line no-constant-condition
	while (true) {
		try {
			await prisma.$connect();
			await prisma.$disconnect();
			break;
		} catch (e) {
			if (Date.now() - start > timeoutMs) {
				// eslint-disable-next-line no-console
				console.error("Database did not become ready in time");
				throw e;
			}
			await new Promise((r) => setTimeout(r, 1000));
		}
	}

	// Apply migrations to ensure a clean state
	execSync("pnpm prisma migrate deploy", {
		stdio: "inherit",
		env: {
			...process.env,
			DATABASE_URL: testDbUrl,
		},
	});
};
