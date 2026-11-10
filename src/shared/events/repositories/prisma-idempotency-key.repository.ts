import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { IdempotencyKeyRepository } from '@/shared/repositories/idempotency-key.repository'

@Injectable()
export class PrismaIdempotencyKeyRepository implements IdempotencyKeyRepository {
	constructor(private readonly prisma: PrismaService) {}

	async deleteCreatedBefore(cutoff: Date): Promise<number> {
		const { count } = await this.prisma.idempotencyKey.deleteMany({
			where: { created_at: { lt: cutoff } },
		})
		return count
	}
}
