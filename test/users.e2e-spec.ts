import { Test, type TestingModule } from '@nestjs/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/shared/prisma/prisma.service';

describe('Users (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  // Global DB lifecycle handled by Jest globalSetup/globalTeardown

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    prisma = app.get<PrismaService>(PrismaService);

    const { ZodExceptionFilter } = await import('../src/shared/filters/zod-exception.filter');
    app.useGlobalFilters(new ZodExceptionFilter());

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await prisma.account.deleteMany();
    await app.close();
  });

  describe('/create-account (POST)', () => {
    const validAccountData = {
      name: 'John Doe',
      email: 'john@example.com',
      password: 'Password123',
    };

    it('should create account successfully', () => {
      return request(app.getHttpServer())
        .post('/create-account')
        .send(validAccountData)
        .expect(201);
    });

    it('should reject duplicate email', async () => {
      await request(app.getHttpServer())
        .post('/create-account')
        .send(validAccountData)
        .expect(201);

      return request(app.getHttpServer())
        .post('/create-account')
        .send(validAccountData)
        .expect(400);
    });

    it('should reject invalid email format', () => {
      const invalidData = {
        ...validAccountData,
        email: 'invalid-email',
      };

      return request(app.getHttpServer())
        .post('/create-account')
        .send(invalidData)
        .expect(400);
    });

    it('should reject short password', () => {
      const invalidData = {
        ...validAccountData,
        password: '123',
      };

      return request(app.getHttpServer())
        .post('/create-account')
        .send(invalidData)
        .expect(400);
    });

    it('should reject missing required fields', () => {
      const incompleteData = {
        name: 'John Doe',
      };

      return request(app.getHttpServer())
        .post('/create-account')
        .send(incompleteData)
        .expect(400);
    });
  });
});