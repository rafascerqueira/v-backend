import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/shared/prisma/prisma.service'
import type { SettingsRepository, SystemSetting } from '@/shared/repositories/settings.repository'

@Injectable()
export class PrismaSettingsRepository implements SettingsRepository {
	constructor(private readonly prisma: PrismaService) {}

	async findByKey(key: string): Promise<SystemSetting | null> {
		return this.prisma.system_setting.findUnique({ where: { key } })
	}

	async upsert(key: string, value: string, type: string): Promise<SystemSetting> {
		return this.prisma.system_setting.upsert({
			where: { key },
			update: { value, type },
			create: { key, value, type },
		})
	}

	async deleteByKey(key: string): Promise<boolean> {
		try {
			await this.prisma.system_setting.delete({ where: { key } })
			return true
		} catch {
			return false
		}
	}

	async findAll(): Promise<SystemSetting[]> {
		return this.prisma.system_setting.findMany()
	}
}
