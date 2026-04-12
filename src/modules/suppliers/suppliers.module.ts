import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { SUPPLIER_REPOSITORY } from '@/shared/repositories/supplier.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { SuppliersController } from './controllers/suppliers.controller'
import { PrismaSupplierRepository } from './repositories/prisma-supplier.repository'
import { SuppliersService } from './services/suppliers.service'

@Module({
	imports: [PrismaModule, TenantModule],
	controllers: [SuppliersController],
	providers: [
		SuppliersService,
		{ provide: SUPPLIER_REPOSITORY, useClass: PrismaSupplierRepository },
	],
})
export class SuppliersModule {}
