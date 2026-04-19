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
	const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
		rawBody: true,
	})
	const configService = app.get(ConfigService)

	app.enableCors({
		origin: (origin, callback) => {
			const allowedOrigins = [
				configService.get<string>('cors.origin', 'http://localhost:3000'),
				'http://127.0.0.1:3000',
				/^http:\/\/127\.0\.0\.1:\d+$/,
			]
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
		allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'stripe-signature'],
	})

	await app.register(cookie as any, {
		secret: configService.get<string>('cookie.secret'),
	})

	await app.register(multipart as any, {
		limits: {
			fileSize: 5 * 1024 * 1024, // 5MB
		},
	})

	await app.register(fastifyStatic as any, {
		root: configService.get<string>('upload.dir') || join(process.cwd(), 'uploads'),
		prefix: '/uploads/',
		decorateReply: false,
	})

	app.useGlobalFilters(new GlobalExceptionFilter(), new ZodExceptionFilter())

	setupSwagger(app)

	const port = configService.get<number>('port', 3001)
	await app.listen(port, '0.0.0.0')
}

bootstrap()
