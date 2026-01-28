import { Module } from "@nestjs/common";
import { PrismaModule } from "@/shared/prisma/prisma.module";
import { TenantModule } from "@/shared/tenant/tenant.module";
import { PRODUCT_REPOSITORY } from "@/shared/repositories/product.repository";
import { CreateProductController } from "./controllers/create-product.controller";
import { ListProductsController } from "./controllers/list-products.controller";
import { RemoveProductController } from "./controllers/remove-product.controller";
import { UpdateProductController } from "./controllers/update-product.controller";
import { PrismaProductRepository } from "./repositories/prisma-product.repository";
import { ProductService } from "./services/product.service";

@Module({
	imports: [PrismaModule, TenantModule],
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
