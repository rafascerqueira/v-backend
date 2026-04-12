import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { BUNDLE_REPOSITORY } from '@/shared/repositories/bundle.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { BundlesController } from './controllers/bundles.controller'
import { PrismaBundleRepository } from './repositories/prisma-bundle.repository'
import { BundlesService } from './services/bundles.service'

@Module({
	imports: [PrismaModule, TenantModule],
	controllers: [BundlesController],
	providers: [BundlesService, { provide: BUNDLE_REPOSITORY, useClass: PrismaBundleRepository }],
})
export class BundlesModule {}
