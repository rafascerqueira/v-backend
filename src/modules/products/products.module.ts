import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { CreateProductController } from './controllers/create-product.controller'
import { UpdateProductController } from './controllers/update-product.controller'
import { RemoveProductController } from './controllers/remove-product.controller'
import { ListProductsController } from './controllers/list-products.controller'
import { ProductService } from './services/product.service'
import { PrismaProductRepository } from './repositories/prisma-product.repository'
import { PRODUCT_REPOSITORY } from '@/shared/repositories/product.repository'

@Module({
	imports: [PrismaModule],
	controllers: [
		CreateProductController,
		UpdateProductController,
		RemoveProductController,
		ListProductsController,
	],
	providers: [
		ProductService,
		{
			provide: PRODUCT_REPOSITORY,
			useClass: PrismaProductRepository,
		},
	],
	exports: [ProductService],
})
export class ProductsModule {}
