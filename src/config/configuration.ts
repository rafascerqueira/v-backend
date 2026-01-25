export default () => ({
	port: parseInt(process.env.PORT || '3000', 10),
	database: {
		url:
			process.env.DATABASE_URL ||
			'postgresql://user:password@localhost:5432/db',
	},
	jwt: {
		secret: process.env.JWT_SECRET || 'your-secret-key',
		expiresIn: process.env.JWT_EXPIRES_IN || '7d',
	},
	bcrypt: {
		saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10', 10),
	},
	cors: {
		origin: process.env.CORS_ORIGIN || '*',
		credentials: true,
	},
	rateLimit: {
		ttl: parseInt(process.env.RATE_LIMIT_TTL || '60', 10),
		limit: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
	},
	environment: process.env.NODE_ENV || 'development',
	isProduction: process.env.NODE_ENV === 'production',
	isDevelopment: process.env.NODE_ENV === 'development',
	isTest: process.env.NODE_ENV === 'test',
})
