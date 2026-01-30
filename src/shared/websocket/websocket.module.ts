import { Global, Module } from "@nestjs/common";
import { NotificationController } from "./notification.controller";
import { NotificationService } from "./notification.service";
import { NotificationsGateway } from "./notifications.gateway";

@Global()
@Module({
	controllers: [NotificationController],
	providers: [NotificationsGateway, NotificationService],
	exports: [NotificationsGateway, NotificationService],
})
export class WebSocketModule {}
