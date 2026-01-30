import { Injectable } from "@nestjs/common";
import { PrismaService } from "@/shared/prisma/prisma.service";
import type {
	Account,
	AccountRepository,
	CreateAccountData,
} from "@/shared/repositories/account.repository";

@Injectable()
export class PrismaAccountRepository implements AccountRepository {
	constructor(private readonly prisma: PrismaService) {}

	async create(data: CreateAccountData): Promise<Account> {
		return this.prisma.account.create({ data });
	}

	async findById(id: string): Promise<Account | null> {
		return this.prisma.account.findUnique({ where: { id } });
	}

	async findByEmail(email: string): Promise<Account | null> {
		return this.prisma.account.findUnique({ where: { email } });
	}

	async update(id: string, data: Partial<CreateAccountData>): Promise<Account> {
		return this.prisma.account.update({ where: { id }, data });
	}

	async delete(id: string): Promise<Account> {
		return this.prisma.account.delete({ where: { id } });
	}
}
