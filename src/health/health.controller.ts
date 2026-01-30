import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import {
	DiskHealthIndicator,
	HealthCheck,
	HealthCheckService,
	MemoryHealthIndicator,
	PrismaHealthIndicator,
} from "@nestjs/terminus";
import { Public } from "../modules/auth/decorators/public.decorator";
import { PrismaService } from "../shared/prisma/prisma.service";

@ApiTags("health")
@Controller("health")
@Public()
export class HealthController {
	constructor(
		private health: HealthCheckService,
		private prismaHealth: PrismaHealthIndicator,
		private memory: MemoryHealthIndicator,
		private disk: DiskHealthIndicator,
		private prisma: PrismaService,
	) {}

	@Get()
	@HealthCheck()
	@ApiOperation({ summary: "Check application health" })
	@ApiResponse({ status: 200, description: "Application is healthy" })
	@ApiResponse({ status: 503, description: "Application is unhealthy" })
	check() {
		return this.health.check([
			() => this.prismaHealth.pingCheck("database", this.prisma),
			() => this.memory.checkHeap("memory_heap", 150 * 1024 * 1024), // 150MB
			() => this.memory.checkRSS("memory_rss", 300 * 1024 * 1024), // 300MB
			() =>
				this.disk.checkStorage("storage", {
					path: "/",
					thresholdPercent: 0.9,
				}),
		]);
	}

	@Get("liveness")
	@ApiOperation({ summary: "Liveness probe for Kubernetes" })
	@ApiResponse({ status: 200, description: "Application is alive" })
	liveness() {
		return { status: "ok", timestamp: new Date().toISOString() };
	}

	@Get("readiness")
	@HealthCheck()
	@ApiOperation({ summary: "Readiness probe for Kubernetes" })
	@ApiResponse({ status: 200, description: "Application is ready" })
	@ApiResponse({ status: 503, description: "Application is not ready" })
	readiness() {
		return this.health.check([
			() => this.prismaHealth.pingCheck("database", this.prisma),
		]);
	}
}
