import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/shared/prisma/prisma.service";

export const SETTINGS_KEYS = {
	FREE_PERIOD_END_DATE: "free_period_end_date",
	EARLY_ADOPTER_DISCOUNT: "early_adopter_discount",
	MAINTENANCE_MODE: "maintenance_mode",
} as const;

type SettingType = "string" | "number" | "boolean" | "date" | "json";

export interface SettingValue {
	key: string;
	value: string;
	type: SettingType;
	parsed: unknown;
}

@Injectable()
export class SettingsService {
	constructor(private readonly prisma: PrismaService) {}

	private parseValue(value: string, type: SettingType): unknown {
		switch (type) {
			case "number":
				return Number(value);
			case "boolean":
				return value === "true";
			case "date":
				return new Date(value);
			case "json":
				try {
					return JSON.parse(value);
				} catch {
					return null;
				}
			default:
				return value;
		}
	}

	private stringifyValue(value: unknown, type: SettingType): string {
		switch (type) {
			case "date":
				return value instanceof Date ? value.toISOString() : String(value);
			case "json":
				return JSON.stringify(value);
			case "boolean":
				return value ? "true" : "false";
			default:
				return String(value);
		}
	}

	async get(key: string): Promise<SettingValue | null> {
		const setting = await this.prisma.system_setting.findUnique({
			where: { key },
		});

		if (!setting) return null;

		return {
			key: setting.key,
			value: setting.value,
			type: setting.type as SettingType,
			parsed: this.parseValue(setting.value, setting.type as SettingType),
		};
	}

	async set(
		key: string,
		value: unknown,
		type: SettingType = "string",
	): Promise<SettingValue> {
		const stringValue = this.stringifyValue(value, type);

		const setting = await this.prisma.system_setting.upsert({
			where: { key },
			update: { value: stringValue, type },
			create: { key, value: stringValue, type },
		});

		return {
			key: setting.key,
			value: setting.value,
			type: setting.type as SettingType,
			parsed: this.parseValue(setting.value, setting.type as SettingType),
		};
	}

	async delete(key: string): Promise<boolean> {
		try {
			await this.prisma.system_setting.delete({ where: { key } });
			return true;
		} catch {
			return false;
		}
	}

	async getAll(): Promise<SettingValue[]> {
		const settings = await this.prisma.system_setting.findMany();
		return settings.map((s) => ({
			key: s.key,
			value: s.value,
			type: s.type as SettingType,
			parsed: this.parseValue(s.value, s.type as SettingType),
		}));
	}

	async getFreePeriodEndDate(): Promise<Date> {
		const setting = await this.get(SETTINGS_KEYS.FREE_PERIOD_END_DATE);
		if (setting) {
			return setting.parsed as Date;
		}
		return new Date("2026-02-28T23:59:59Z");
	}

	async setFreePeriodEndDate(date: Date): Promise<void> {
		await this.set(SETTINGS_KEYS.FREE_PERIOD_END_DATE, date, "date");
	}

	async isFreePeriodActive(): Promise<boolean> {
		const endDate = await this.getFreePeriodEndDate();
		return new Date() < endDate;
	}

	async getEarlyAdopterDiscount(): Promise<number> {
		const setting = await this.get(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT);
		return setting ? (setting.parsed as number) : 20;
	}

	async setEarlyAdopterDiscount(percent: number): Promise<void> {
		await this.set(SETTINGS_KEYS.EARLY_ADOPTER_DISCOUNT, percent, "number");
	}
}
