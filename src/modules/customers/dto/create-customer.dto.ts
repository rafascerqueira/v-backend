import { z } from 'zod'
import type { BillingMode } from '@/shared/repositories/customer.repository'

const emptyToNull = (val: string | undefined) => (val === '' || val === undefined ? null : val)

// Billing modes where billing_day is meaningless: the due date derives from the
// sale itself (per_sale), a fixed interval (biweekly), or is set manually (custom).
// See shared/billing/billing-scheduler.ts for how each mode is scheduled.
const MODES_WITHOUT_BILLING_DAY: readonly BillingMode[] = ['per_sale', 'biweekly', 'custom']

// weekly: billing_day is a day of week (0=Sunday … 6=Saturday).
const isWeeklyDayValid = (mode: BillingMode | undefined, day: number | null | undefined) =>
	mode !== 'weekly' || day == null || (day >= 0 && day <= 6)

// monthly: billing_day is a day of month (1 … 31).
const isMonthlyDayValid = (mode: BillingMode | undefined, day: number | null | undefined) =>
	mode !== 'monthly' || day == null || (day >= 1 && day <= 31)

const clearIrrelevantBillingDay = <T extends { billing_day?: number | null }>(
	data: T,
	mode: BillingMode | undefined,
): T => (mode && MODES_WITHOUT_BILLING_DAY.includes(mode) ? { ...data, billing_day: null } : data)

const addressSchema = z
	.object({
		street: z.string().optional(),
		number: z.string().optional(),
		complement: z.string().optional(),
		neighborhood: z.string().optional(),
	})
	.optional()

const baseCustomerSchema = z.object({
	name: z.string().min(1, 'Nome é obrigatório'),
	email: z.string().email('Email inválido').optional().or(z.literal('')).transform(emptyToNull),
	phone: z.string().min(10, 'Telefone inválido'),
	document: z
		.string()
		.min(11, 'Documento inválido')
		.optional()
		.or(z.literal(''))
		.transform(emptyToNull),
	address: addressSchema.default({}),
	city: z.string().min(1, 'Cidade é obrigatória'),
	state: z.string().length(2, 'Estado deve ter 2 caracteres'),
	zip_code: z.string().min(8, 'CEP inválido').optional().or(z.literal('')).transform(emptyToNull),
	// Range is widened to 0–31 so weekly (day of week, 0=Sunday) is accepted; the
	// per-mode rules below narrow it to 0–6 (weekly) or 1–31 (monthly).
	billing_day: z.number().int().min(0).max(31).optional().nullable(),
	billing_mode: z.enum(['per_sale', 'weekly', 'biweekly', 'monthly', 'custom']).optional(),
})

// On create, an absent billing_mode means the DB default (per_sale), so we treat
// it as such for both validation and coercion.
export const createCustomerSchema = baseCustomerSchema
	.refine((data) => isWeeklyDayValid(data.billing_mode ?? 'per_sale', data.billing_day), {
		message: 'Para cobrança semanal, informe um dia da semana (0=Domingo a 6=Sábado)',
		path: ['billing_day'],
	})
	.refine((data) => isMonthlyDayValid(data.billing_mode ?? 'per_sale', data.billing_day), {
		message: 'Para cobrança mensal, informe um dia do mês (1 a 31)',
		path: ['billing_day'],
	})
	.transform((data) => clearIrrelevantBillingDay(data, data.billing_mode ?? 'per_sale'))

// On update, an absent billing_mode means "leave it unchanged", so mode-specific
// validation and coercion only apply when billing_mode is present in the payload.
export const updateCustomerSchema = baseCustomerSchema
	.partial()
	.refine((data) => isWeeklyDayValid(data.billing_mode, data.billing_day), {
		message: 'Para cobrança semanal, informe um dia da semana (0=Domingo a 6=Sábado)',
		path: ['billing_day'],
	})
	.refine((data) => isMonthlyDayValid(data.billing_mode, data.billing_day), {
		message: 'Para cobrança mensal, informe um dia do mês (1 a 31)',
		path: ['billing_day'],
	})
	.transform((data) => clearIrrelevantBillingDay(data, data.billing_mode))

export type CreateCustomerDto = z.infer<typeof createCustomerSchema>
export type UpdateCustomerDto = z.infer<typeof updateCustomerSchema>
