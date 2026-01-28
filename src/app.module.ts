import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { HealthModule } from './health/health.module'
import { AdminModule } from './modules/admin/admin.module'
import { AuthModule } from './modules/auth/auth.module'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'
import { BillingsModule } from './modules/billings/billings.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { CustomersModule } from './modules/customers/customers.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { OrdersModule } from './modules/orders/orders.module'
import { ProductPricesModule } from './modules/product-prices/product-prices.module'
import { ProductsModule } from './modules/products/products.module'
import { ReportsModule } from './modules/reports/reports.module'
import { StockMovementsModule } from './modules/stock-movements/stock-movements.module'
import { StoreStockModule } from './modules/store-stock/store-stock.module'
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module'
import { UsersModule } from './modules/users/users.module'
import { AuditModule } from './shared/audit/audit.module'
import { CryptoModule } from './shared/crypto/crypto.module'
import { PrismaModule } from './shared/prisma/prisma.module'
import { RedisModule } from './shared/redis/redis.module'
import { TenantInterceptor } from './shared/tenant/tenant.interceptor'
import { TenantModule } from './shared/tenant/tenant.module'
import { AppThrottlerModule } from './shared/throttler/throttler.module'
import { WebSocketModule } from './shared/websocket/websocket.module'

@Module({
	imports: [
		PrismaModule,
		TenantModule,
		RedisModule,
		CryptoModule,
		AuthModule,
		UsersModule,
		ProductsModule,
		CustomersModule,
		ProductPricesModule,
		OrdersModule,
		BillingsModule,
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
		HealthModule,
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
	],
})
export class AppModule {}
