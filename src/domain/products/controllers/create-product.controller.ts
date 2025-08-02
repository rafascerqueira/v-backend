import { Body, Controller, Post } from '@nestjs/common'
import { z } from 'zod'
import { ProductService } from '../services/product.service'

const createProductSchema = z.object({
  name: z.string(),
  description: z.string(),
  sku: z.string(),
  category: z.string(),
  brand: z.string(),
  unit: z.string().optional(),
  specifications: z.object({
    imported: z.boolean(),
    moreinfo: z.string().optional(),
  }),
  images: z.string().array(),
  active: z.boolean().optional(),
})

@Controller('product/create-product')
export class CreateProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  async handle(@Body() body: z.infer<typeof createProductSchema>) {
    const {
      name,
      description,
      sku,
      category,
      brand,
      unit,
      specifications,
      images,
      active,
    } = createProductSchema.parse(body)

    const product = await this.productService.create({
      name,
      description,
      sku,
      category,
      brand,
      unit,
      specifications,
      images,
      active,
    })

    return product
  }
}
