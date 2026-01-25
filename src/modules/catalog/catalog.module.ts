import { Module } from '@nestjs/common'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { CatalogController } from './controllers/catalog.controller'
import { CatalogService } from './services/catalog.service'

@Module({
  imports: [PrismaModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
