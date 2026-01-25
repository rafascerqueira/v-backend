import { NestFactory } from '@nestjs/core'
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify'
import cookie from '@fastify/cookie'
import { AppModule } from './app.module'
import { ZodExceptionFilter } from './shared/filters/zod-exception.filter'
import { GlobalExceptionFilter } from './shared/filters/global-exception.filter'
import { setupSwagger } from './config/swagger.config'

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  )

  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })

  await app.register(cookie as any, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
  })
  
  app.useGlobalFilters(
    new GlobalExceptionFilter(),
    new ZodExceptionFilter()
  )
  
  setupSwagger(app)
  
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0')
}

bootstrap()
