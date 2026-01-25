export interface BaseRepository<T, CreateDto, UpdateDto = Partial<CreateDto>> {
	create(data: CreateDto): Promise<T>
	findById(id: string): Promise<T | null>
	findAll(): Promise<T[]>
	update(id: string, data: UpdateDto): Promise<T>
	delete(id: string): Promise<T>
}
