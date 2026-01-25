import { execSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

module.exports = async () => {

  // Start test database container
  execSync('docker compose -f docker-compose.test.yml up -d', {
    stdio: 'inherit',
  })

  // Ensure DATABASE_URL points to test DB on port 5433
  const testDbUrl = 'postgresql://test_user:test_password@localhost:5433/test_db'
  process.env.DATABASE_URL = testDbUrl

  // Wait for DB to be ready by trying to connect with Prisma
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL || testDbUrl,
      },
    },
  })

  const timeoutMs = 60000
  const start = Date.now()
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await prisma.$connect()
      await prisma.$disconnect()
      break
    } catch (e) {
      if (Date.now() - start > timeoutMs) {
        // eslint-disable-next-line no-console
        console.error('Database did not become ready in time')
        throw e
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  // Reset database and apply all migrations to ensure a clean state
  execSync('pnpm prisma migrate reset --force --skip-seed', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: testDbUrl,
    },
  })
}
