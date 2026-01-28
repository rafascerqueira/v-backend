// Load test environment variables
require('dotenv').config({ path: '.env.test' })

// Set NODE_ENV to test
process.env.NODE_ENV = 'test'

// Override DATABASE_URL to use test database
process.env.DATABASE_URL =
	'postgresql://test_user:test_password@localhost:5433/test_db?schema=vendinhas'

// Override Redis to use test instance
process.env.REDIS_HOST = 'localhost'
process.env.REDIS_PORT = '6380'
process.env.REDIS_PASSWORD = ''
process.env.REDIS_KEY_PREFIX = 'vendinhas:test:'

// Disable RSA keys for tests (use HS256)
process.env.JWT_KEYS_DIR = ''
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests'
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests'
