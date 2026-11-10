import { z } from 'zod'

/** POST /billings/:id/payments — the amount RECEIVED now (not a new total), in cents. */
export const recordPaymentSchema = z.object({
	amount: z.coerce
		.number()
		.int('O valor deve estar em centavos')
		.positive('O valor deve ser maior que zero')
		.max(100_000_000),
	method: z.enum(['cash', 'credit_card', 'debit_card', 'pix']),
	paid_at: z.iso.datetime().optional(),
	note: z.string().trim().max(500).optional(),
})

/** POST /billings/:id/payments/:paymentId/reverse */
export const reversePaymentSchema = z.object({
	reason: z
		.string()
		.trim()
		.min(3, 'Informe o motivo do estorno')
		.max(500, 'O motivo pode ter no máximo 500 caracteres'),
})

export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>
export type ReversePaymentDto = z.infer<typeof reversePaymentSchema>
