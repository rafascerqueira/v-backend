import { z } from 'zod'
import type { AccountRole, PlanType } from '@/generated/prisma/client'

export const authResponseSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresIn: z.number(),
})

export type AuthResponseDto = z.infer<typeof authResponseSchema>

export interface TokenPayload {
	sub: string
	email: string
	role: AccountRole
	plan_type: PlanType
	type?: 'access' | 'refresh'
	iat?: number
	exp?: number
}
