import { z } from 'zod'

export const authResponseSchema = z.object({
	accessToken: z.string(),
	refreshToken: z.string(),
	expiresIn: z.number(),
})

export type AuthResponseDto = z.infer<typeof authResponseSchema>

export interface TokenPayload {
	sub: string
	email: string
	iat?: number
	exp?: number
}
