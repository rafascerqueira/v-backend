import { z } from 'zod'

export const twoFactorCodeSchema = z.object({
	code: z.string().regex(/^\d{6}$/, 'Código de verificação deve ter 6 dígitos'),
})

export type TwoFactorCodeDto = z.infer<typeof twoFactorCodeSchema>
