import { z } from 'zod'

/**
 * Body of a successful login / refresh. The tokens themselves travel only in
 * HttpOnly cookies; the body tells the client how long the access token lasts.
 */
export const authResponseSchema = z.object({
	expiresIn: z.number(),
})

export type AuthResponseDto = z.infer<typeof authResponseSchema>
