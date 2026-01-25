import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { execSync } from 'child_process'

const testDbUrl = 'postgresql://test_user:test_password@localhost:5433/test_db'
const adapter = new PrismaPg({ connectionString: testDbUrl })
const prisma = new PrismaClient({ adapter })

export async function setupTestDatabase() {
	try {
		execSync('pnpm prisma migrate deploy', {
			env: {
				...process.env,
				DATABASE_URL:
					'postgresql://test_user:test_password@localhost:5433/test_db',
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
