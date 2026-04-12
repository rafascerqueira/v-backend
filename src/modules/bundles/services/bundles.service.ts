import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { BUNDLE_REPOSITORY, type BundleRepository } from '@/shared/repositories/bundle.repository'
import type { CreateBundleDto } from '../dto/create-bundle.dto'
import type { UpdateBundleDto } from '../dto/update-bundle.dto'

@Injectable()
export class BundlesService {
	constructor(
		@Inject(BUNDLE_REPOSITORY)
		private readonly bundleRepository: BundleRepository,
	) {}

	findAll() {
		return this.bundleRepository.findAll()
	}

	async findOne(id: number) {
		const bundle = await this.bundleRepository.findById(id)
		if (!bundle) throw new NotFoundException('Bundle not found')
		return bundle
	}

	create(data: CreateBundleDto & { seller_id: string }) {
		return this.bundleRepository.create(data)
	}

	async update(id: number, data: UpdateBundleDto) {
		await this.findOne(id)
		return this.bundleRepository.update(id, data)
	}

	async remove(id: number) {
		await this.findOne(id)
		return this.bundleRepository.delete(id)
	}
}
