import { BadRequestException, Injectable } from "@nestjs/common";
import * as OTPAuth from "otpauth";
import { PrismaService } from "@/shared/prisma/prisma.service";

const authenticator = {
	generateSecret: () => {
		const bytes = new Uint8Array(20);
		crypto.getRandomValues(bytes);
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	},
	keyuri: (email: string, issuer: string, secret: string) => {
		const totp = new OTPAuth.TOTP({ issuer, label: email, secret });
		return totp.toString();
	},
	verify: ({ token, secret }: { token: string; secret: string }) => {
		const totp = new OTPAuth.TOTP({ secret });
		return totp.validate({ token, window: 1 }) !== null;
	},
};

import * as QRCode from "qrcode";

@Injectable()
export class TwoFactorService {
	private readonly APP_NAME = "Vendinhas";

	constructor(private readonly prisma: PrismaService) {}

	async generateSecret(userId: string) {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { email: true, two_factor_enabled: true },
		});

		if (!user) {
			throw new BadRequestException("User not found");
		}

		if (user.two_factor_enabled) {
			throw new BadRequestException("2FA is already enabled");
		}

		const secret = authenticator.generateSecret();
		const otpauthUrl = authenticator.keyuri(user.email, this.APP_NAME, secret);

		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_secret: secret },
		});

		const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

		return {
			secret,
			qrCode: qrCodeDataUrl,
			otpauthUrl,
		};
	}

	async enableTwoFactor(userId: string, token: string) {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_secret: true, two_factor_enabled: true },
		});

		if (!user) {
			throw new BadRequestException("User not found");
		}

		if (user.two_factor_enabled) {
			throw new BadRequestException("2FA is already enabled");
		}

		if (!user.two_factor_secret) {
			throw new BadRequestException("Generate a secret first");
		}

		const isValid = authenticator.verify({
			token,
			secret: user.two_factor_secret,
		});

		if (!isValid) {
			throw new BadRequestException("Invalid verification code");
		}

		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_enabled: true },
		});

		return { message: "2FA enabled successfully" };
	}

	async disableTwoFactor(userId: string, token: string) {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_secret: true, two_factor_enabled: true },
		});

		if (!user) {
			throw new BadRequestException("User not found");
		}

		if (!user.two_factor_enabled) {
			throw new BadRequestException("2FA is not enabled");
		}

		const isValid = authenticator.verify({
			token,
			secret: user.two_factor_secret!,
		});

		if (!isValid) {
			throw new BadRequestException("Invalid verification code");
		}

		await this.prisma.account.update({
			where: { id: userId },
			data: {
				two_factor_enabled: false,
				two_factor_secret: null,
			},
		});

		return { message: "2FA disabled successfully" };
	}

	async verifyToken(userId: string, token: string): Promise<boolean> {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_secret: true, two_factor_enabled: true },
		});

		if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
			return false;
		}

		return authenticator.verify({
			token,
			secret: user.two_factor_secret,
		});
	}

	async isTwoFactorEnabled(userId: string): Promise<boolean> {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_enabled: true },
		});

		return user?.two_factor_enabled ?? false;
	}

	async generateBackupCodes(userId: string): Promise<string[]> {
		const codes: string[] = [];
		for (let i = 0; i < 10; i++) {
			const code = this.generateRandomCode();
			codes.push(code);
		}

		// Hash codes before storing
		const hashedCodes = codes.map((code) => this.hashCode(code));

		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_backup: hashedCodes },
		});

		return codes;
	}

	async verifyBackupCode(userId: string, code: string): Promise<boolean> {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_backup: true, two_factor_enabled: true },
		});

		if (!user || !user.two_factor_enabled) {
			return false;
		}

		const hashedInput = this.hashCode(code.replace(/-/g, ""));
		const backupCodes = user.two_factor_backup as string[];

		const codeIndex = backupCodes.findIndex((c) => c === hashedInput);

		if (codeIndex === -1) {
			return false;
		}

		// Remove used code
		const updatedCodes = [...backupCodes];
		updatedCodes.splice(codeIndex, 1);

		await this.prisma.account.update({
			where: { id: userId },
			data: { two_factor_backup: updatedCodes },
		});

		return true;
	}

	async getRemainingBackupCodesCount(userId: string): Promise<number> {
		const user = await this.prisma.account.findUnique({
			where: { id: userId },
			select: { two_factor_backup: true },
		});

		return (user?.two_factor_backup as string[])?.length || 0;
	}

	private generateRandomCode(): string {
		const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
		let code = "";
		for (let i = 0; i < 8; i++) {
			const randomIndex = Math.floor(Math.random() * chars.length);
			code += chars[randomIndex];
		}
		return `${code.slice(0, 4)}-${code.slice(4)}`;
	}

	private hashCode(code: string): string {
		const crypto = require("crypto");
		return crypto
			.createHash("sha256")
			.update(code.replace(/-/g, ""))
			.digest("hex");
	}
}
