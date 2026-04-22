export default () => ({
	port: parseInt(process.env.PORT || '3001', 10),
	environment: process.env.NODE_ENV || 'development',
	isProduction: process.env.NODE_ENV === 'production',

	database: {
		url: process.env.DATABASE_URL,
	},

	redis: {
		host: process.env.REDIS_HOST || 'localhost',
		port: parseInt(process.env.REDIS_PORT || '6379', 10),
		password: process.env.REDIS_PASSWORD || undefined,
		db: parseInt(process.env.REDIS_DB || '0', 10),
		keyPrefix: process.env.REDIS_KEY_PREFIX || 'vendinhas:',
	},

	jwt: {
		keysDir: process.env.JWT_KEYS_DIR,
		accessTokenExpiresIn: process.env.JWT_ACCESS_TOKEN_EXPIRES_IN || '1d',
		refreshTokenExpiresIn: process.env.JWT_REFRESH_TOKEN_EXPIRES_IN || '7d',
	},

	cors: {
		origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
	},

	cookie: {
		secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
	},

	smtp: {
		host: process.env.SMTP_HOST,
		port: parseInt(process.env.SMTP_PORT || '587', 10),
		user: process.env.SMTP_USER,
		pass: process.env.SMTP_PASS,
		from: process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@vendinhas.app',
	},

	stripe: {
		secretKey: process.env.STRIPE_SECRET_KEY,
		webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
		priceIds: {
			pro: process.env.STRIPE_PRICE_PRO,
			enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
		},
	},

	upload: {
		dir: process.env.UPLOAD_DIR,
	},

	frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
	appUrl: process.env.APP_URL || 'http://localhost:3001',

	oauth: {
		google: {
			clientId: process.env.GOOGLE_CLIENT_ID,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET,
			callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback',
		},
		facebook: {
			clientId: process.env.FACEBOOK_CLIENT_ID,
			clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
			callbackUrl:
				process.env.FACEBOOK_CALLBACK_URL || 'http://localhost:3001/auth/facebook/callback',
		},
	},
})
