import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import configuration from './config/configuration'
import { HealthModule } from './health/health.module'
import { AdminModule } from './modules/admin/admin.module'
import { AuthModule } from './modules/auth/auth.module'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'
import { BillingsModule } from './modules/billings/billings.module'
import { BundlesModule } from './modules/bundles/bundles.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { CustomersModule } from './modules/customers/customers.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { OrdersModule } from './modules/orders/orders.module'
import { ProductPricesModule } from './modules/product-prices/product-prices.module'
import { ProductsModule } from './modules/products/products.module'
import { PromotionsModule } from './modules/promotions/promotions.module'
import { ReportsModule } from './modules/reports/reports.module'
import { StockMovementsModule } from './modules/stock-movements/stock-movements.module'
import { StoreStockModule } from './modules/store-stock/store-stock.module'
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module'
import { SuppliersModule } from './modules/suppliers/suppliers.module'
import { UsersModule } from './modules/users/users.module'
import { AuditInterceptor } from './shared/audit/audit.interceptor'
import { AuditModule } from './shared/audit/audit.module'
import { CryptoModule } from './shared/crypto/crypto.module'
import { EmailModule } from './shared/email/email.module'
import { ExportModule } from './shared/export/export.module'
import { PrismaModule } from './shared/prisma/prisma.module'
import { QueueModule } from './shared/queue/queue.module'
import { RedisModule } from './shared/redis/redis.module'
import { TenantInterceptor } from './shared/tenant/tenant.interceptor'
import { TenantModule } from './shared/tenant/tenant.module'
import { AppThrottlerModule } from './shared/throttler/throttler.module'
import { UploadModule } from './shared/upload/upload.module'
import { WebSocketModule } from './shared/websocket/websocket.module'

@Module({
	imports: [
		ConfigModule.forRoot({ load: [configuration], isGlobal: true }),
		PrismaModule,
		TenantModule,
		RedisModule,
		CryptoModule,
		EmailModule,
		QueueModule,
		AuthModule,
		UsersModule,
		ProductsModule,
		CustomersModule,
		ProductPricesModule,
		OrdersModule,
		BillingsModule,
		BundlesModule,
		StoreStockModule,
		StockMovementsModule,
		DashboardModule,
		ReportsModule,
		AppThrottlerModule,
		AuditModule,
		WebSocketModule,
		CatalogModule,
		AdminModule,
		SubscriptionsModule,
		SuppliersModule,
		PromotionsModule,
		HealthModule,
		UploadModule,
		ExportModule,
	],
	controllers: [AppController],
	providers: [
		AppService,
		{
			provide: APP_GUARD,
			useClass: JwtAuthGuard,
		},
		{
			provide: APP_INTERCEPTOR,
			useClass: TenantInterceptor,
		},
		{
			provide: APP_INTERCEPTOR,
			useClass: AuditInterceptor,
		},
	],
})
export class AppModule {}
