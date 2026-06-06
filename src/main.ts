import { loadEnvFile } from 'node:process'

try {
	loadEnvFile()
} catch {}

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
			// In production only the configured frontend origin(s) are allowed —
			// CORS_ORIGIN may be a comma-separated list (e.g. apex + www). The exact
			// origin is echoed back (never '*'), which is mandatory alongside
			// credentials. Loopback origins (any 127.0.0.1 port) are accepted only
			// outside production for local development.
			const allowedOrigins: Array<string | RegExp> = configService
				.get<string>('cors.origin', 'http://localhost:3000')
				.split(',')
				.map((o) => o.trim())
				.filter(Boolean)
			if (!isProduction) {
				allowedOrigins.push('http://127.0.0.1:3000', /^http:\/\/127\.0\.0\.1:\d+$/)
			}
			if (
				!origin ||
				allowedOrigins.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin))
			) {
				callback(null, true)
			} else {
				callback(null, false)
			}
		},
		credentials: true,
		methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
		allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'stripe-signature', 'X-CSRF-Token'],
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
		await app.register(fastifyStatic as any, {
			root: configService.get<string>('upload.dir') || join(process.cwd(), 'uploads'),
			prefix: '/uploads/',
			decorateReply: false,
			// Defense-in-depth: stop browsers from MIME-sniffing uploaded files into an
			// executable type (e.g. treating a file as HTML/SVG).
			setHeaders: (res: any) => {
				res.setHeader('X-Content-Type-Options', 'nosniff')
			},
		})
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
