import { z } from 'zod'

export const lookupCustomerSchema = z.object({
	contact: z.string().min(5, 'Informe email ou telefone').max(100, 'Contato muito longo'),
})

export type LookupCustomerDto = z.infer<typeof lookupCustomerSchema>
