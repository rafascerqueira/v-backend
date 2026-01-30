import { Injectable } from "@nestjs/common";
import { RedisService } from "@/shared/redis/redis.service";

@Injectable()
export class TokenBlacklistService {
	private readonly BLACKLIST_PREFIX = "token:blacklist:";

	constructor(private readonly redisService: RedisService) {}

	async addToBlacklist(token: string, expiresInSeconds: number): Promise<void> {
		const key = `${this.BLACKLIST_PREFIX}${this.hashToken(token)}`;
		await this.redisService.setWithExpiry(key, "1", expiresInSeconds);
	}

	async isBlacklisted(token: string): Promise<boolean> {
		const key = `${this.BLACKLIST_PREFIX}${this.hashToken(token)}`;
		return this.redisService.exists(key);
	}

	private hashToken(token: string): string {
		const crypto = require("node:crypto");
		return crypto.createHash("sha256").update(token).digest("hex");
	}
}
