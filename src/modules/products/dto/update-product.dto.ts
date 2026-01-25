import { z } from 'zod'
import { createProductSchema } from './create-product.dto'

export const updateProductSchema = createProductSchema.partial()

export type UpdateProductDto = z.infer<typeof updateProductSchema>
