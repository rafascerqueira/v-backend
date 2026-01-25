import { loadEnvFile } from 'node:process'
loadEnvFile()
import { PrismaClient } from '../src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import * as argon2 from 'argon2'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
	throw new Error('DATABASE_URL environment variable is not set')
}

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

const ARGON2_OPTIONS: argon2.Options = {
	type: argon2.argon2id,
	memoryCost: 65536,
	timeCost: 3,
	parallelism: 4,
}

async function hashPassword(password: string): Promise<string> {
	return argon2.hash(password, ARGON2_OPTIONS)
}

async function main() {
	console.log('🌱 Seeding database...')

	// Create admin user
	const adminEmail = 'admin@vendinhas.app'
	const adminPassword = 'qwerty'

	const existingAdmin = await prisma.account.findUnique({
		where: { email: adminEmail },
	})

	if (existingAdmin) {
		// Update existing admin to ensure correct role
		if (existingAdmin.role !== 'admin') {
			await prisma.account.update({
				where: { id: existingAdmin.id },
				data: { role: 'admin', plan_type: 'enterprise' },
			})
			console.log('✅ Admin user role updated to admin')
		} else {
			console.log('✅ Admin user already exists with correct role, skipping...')
		}
	} else {
		const hashedPassword = await hashPassword(adminPassword)

		await prisma.account.create({
			data: {
				name: 'Administrador',
				email: adminEmail,
				password: hashedPassword,
				salt: '',
				role: 'admin',
				plan_type: 'enterprise',
			},
		})

		console.log('✅ Admin user created:')
		console.log(`   Email: ${adminEmail}`)
		console.log(`   Password: ${adminPassword}`)
	}

	console.log('🌱 Seeding completed!')
}

main()
	.catch((e) => {
		console.error('❌ Seeding failed:', e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
