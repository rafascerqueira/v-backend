import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { PROMOTION_REPOSITORY } from '@/shared/repositories/promotion.repository'
import { TenantModule } from '@/shared/tenant/tenant.module'
import { PromotionsController } from './controllers/promotions.controller'
import { PrismaPromotionRepository } from './repositories/prisma-promotion.repository'
import { PromotionsService } from './services/promotions.service'

@Module({
	imports: [PrismaModule, TenantModule],
	controllers: [PromotionsController],
	providers: [
		PromotionsService,
		{ provide: PROMOTION_REPOSITORY, useClass: PrismaPromotionRepository },
	],
})
export class PromotionsModule {}
