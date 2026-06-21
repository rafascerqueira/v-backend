import { Inject, Injectable } from '@nestjs/common'
import {
	BACKORDER_REPOSITORY,
	type BackorderRepository,
} from '@/shared/repositories/backorder.repository'
import type { ListBackordersDto } from '../dto/list-backorders.dto'

@Injectable()
export class BackordersService {
	constructor(
		@Inject(BACKORDER_REPOSITORY) private readonly backorderRepository: BackorderRepository,
	) {}

	// Defaults to pending — the only consumer today is the "aguardando reposição"
	// breakdown, which always wants the open ones. An explicit status overrides it.
	async list(query: ListBackordersDto) {
		return this.backorderRepository.list({
			productId: query.product_id,
			status: query.status ?? 'pending',
		})
	}
}
