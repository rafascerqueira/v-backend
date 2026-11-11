// MUST be first: loads .env as a side effect before any import below evaluates
// process.env at module-load time (e.g. ConfigModule's configuration()). See
// load-env.ts for the full rationale — this ordering is load-bearing.
import './load-env'
import { join } from 'node:path'
import cookie from '@fastify/cookie'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './app.module'
import { setupSwagger } from './config/swagger.config'
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter'
import { ZodExceptionFilter } from './shared/filters/zod-exception.filter'
import { allowedOriginsFromConfig, isOriginAllowed } from './shared/security/allowed-origins'
import { buildUploadsStaticOptions } from './shared/storage/uploads-static.options'

async function bootstrap() {
	const app = await NestFactory.create<NestFastifyApplication>(
		AppModule,
		// trustProxy: the API runs behind nginx (which sits behind Cloudflare). The real
		// client IP must come from X-Forwarded-For — but trusting the WHOLE chain (`true`)
		// lets any client spoof `X-Forwarded-For` and evade every IP-keyed rate limit. So
		// trust ONLY the local reverse proxy (nginx on loopback) by default; nginx is
		// responsible for setting a trustworthy XFF from Cloudflare's CF-Connecting-IP.
		// Override via TRUST_PROXY when the proxy is not on loopback (e.g. a Docker network).
		new FastifyAdapter({ trustProxy: process.env.TRUST_PROXY || 'loopback' }),
		{
			rawBody: true,
		},
	)
	const configService = app.get(ConfigService)
	const isProduction = configService.get<boolean>('isProduction', false)

	app.enableCors({
		origin: (origin, callback) => {
			// One list answers CORS, the WebSocket handshake and the Origin check on
			// login/refresh (see allowed-origins.ts). The exact origin is echoed back
			// (never '*'), which is mandatory alongside credentials. Requests without an
			// Origin header are not cross-origin browser requests and need no CORS headers.
			callback(null, !origin || isOriginAllowed(origin, allowedOriginsFromConfig(configService)))
		},
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: [
			'Content-Type',
			'Authorization',
			'Accept',
			'stripe-signature',
			'X-CSRF-Token',
			'Idempotency-Key',
		],
	})

	await app.register(cookie as any, {
		secret: configService.get<string>('cookie.secret'),
	})

	await app.register(multipart as any, {
		limits: {
			fileSize: 5 * 1024 * 1024, // 5MB
		},
	})

	// Only the local storage driver serves uploads from disk. With the S3 driver
	// objects are served directly from the bucket/CDN, so no static route is needed.
	if (configService.get<string>('storage.driver', 'local') === 'local') {
		await app.register(
			fastifyStatic as any,
			buildUploadsStaticOptions(
				configService.get<string>('upload.dir') || join(process.cwd(), 'uploads'),
			),
		)
	}

	app.useGlobalFilters(new GlobalExceptionFilter(), new ZodExceptionFilter())

	// Don't expose the API docs / full endpoint surface in production.
	if (!isProduction) {
		setupSwagger(app)
	}

	const port = configService.get<number>('port', 3001)
	await app.listen(port, '0.0.0.0')
}

bootstrap()
