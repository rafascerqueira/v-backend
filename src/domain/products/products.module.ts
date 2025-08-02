import { Module } from '@nestjs/common'
import { CreateProductController } from './controllers/create-product.controller'
import { ProductService } from './services/product.service'
import { PrismaService } from 'src/infrastructure/prisma/prisma.service'

@Module({
  imports: [],
  controllers: [CreateProductController],
  providers: [ProductService, PrismaService],
  exports: [],
})
export class ProductsModule {}
