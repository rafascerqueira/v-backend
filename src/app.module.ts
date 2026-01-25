import { Module } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { CryptoModule } from './shared/crypto/crypto.module'
import { RedisModule } from './shared/redis/redis.module'
import { AuthModule } from './modules/auth/auth.module'
import { UsersModule } from './modules/users/users.module'
import { ProductsModule } from './modules/products/products.module'
import { CustomersModule } from './modules/customers/customers.module'
import { ProductPricesModule } from './modules/product-prices/product-prices.module'
import { HealthModule } from './health/health.module'
import { OrdersModule } from './modules/orders/orders.module'
import { BillingsModule } from './modules/billings/billings.module'
import { StoreStockModule } from './modules/store-stock/store-stock.module'
import { StockMovementsModule } from './modules/stock-movements/stock-movements.module'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { ReportsModule } from './modules/reports/reports.module'
import { AppThrottlerModule } from './shared/throttler/throttler.module'
import { AuditModule } from './shared/audit/audit.module'
import { WebSocketModule } from './shared/websocket/websocket.module'
import { PrismaModule } from './shared/prisma/prisma.module'
import { CatalogModule } from './modules/catalog/catalog.module'
import { AdminModule } from './modules/admin/admin.module'
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module'
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard'
import { TenantModule } from './shared/tenant/tenant.module'
import { TenantInterceptor } from './shared/tenant/tenant.interceptor'

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
