import { execSync } from 'node:child_process'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'

// Wire the e2e environment before any Nest app boots in a test file. The booted
// app (RedisService + BullMQ via ConfigService) and these helpers must agree on
// where Postgres/Redis live and which JWT keys to use. `||=` means CI can inject
// its own values (the service-container ports) while local runs fall back to the
// docker-compose.test.yml ports (5433 / 6380). Without this the e2e config never
// set REDIS_*, so BullMQ silently fell back to 6379 — fine locally (dev Redis is
// there) but a hang/leak in CI where the test Redis is on 6380.
process.env.NODE_ENV ||= 'test'
process.env.DATABASE_URL ||= 'postgresql://test_user:test_password@localhost:5433/test_db'
process.env.REDIS_HOST ||= 'localhost'
process.env.REDIS_PORT ||= '6380'
process.env.REDIS_PASSWORD ||= ''
process.env.REDIS_KEY_PREFIX ||= 'vendinhas:test:'
process.env.JWT_KEYS_DIR ||= './keys'

const testDbUrl = 'postgresql://test_user:test_password@localhost:5433/test_db'
const adapter = new PrismaPg({ connectionString: testDbUrl })
const prisma = new PrismaClient({ adapter })

export async function setupTestDatabase() {
	try {
		execSync('pnpm prisma migrate deploy', {
			env: {
				...process.env,
				DATABASE_URL: 'postgresql://test_user:test_password@localhost:5433/test_db',
			},
		})
	} catch (error) {
		console.error('Failed to run migrations:', error)
	}
}

export async function cleanupTestDatabase() {
	try {
		// Deletar todos os dados em ordem respeitando as foreign keys
		await prisma.order_item.deleteMany()
		await prisma.billing.deleteMany()
		await prisma.order.deleteMany()
		await prisma.stock_movement.deleteMany()
		await prisma.product_price.deleteMany()
		await prisma.store_stock.deleteMany()
		await prisma.product.deleteMany()
		await prisma.customer.deleteMany()
		await prisma.account.deleteMany()
	} catch (error) {
		console.error('Failed to cleanup test database:', error)
	}
}

export { prisma }
