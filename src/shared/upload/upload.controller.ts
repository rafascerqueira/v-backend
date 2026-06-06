import {
	BadRequestException,
	Controller,
	Delete,
	ForbiddenException,
	Param,
	Post,
	Req,
	UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '@/modules/auth/guards/jwt-auth.guard'
import { UploadService } from './upload.service'

@ApiTags('upload')
@Controller('upload')
@UseGuards(JwtAuthGuard)
export class UploadController {
	constructor(private readonly uploadService: UploadService) {}

	@Post('product')
	@ApiOperation({ summary: 'Upload product image' })
	@ApiConsumes('multipart/form-data')
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				file: { type: 'string', format: 'binary' },
			},
		},
	})
	@ApiResponse({ status: 201, description: 'Image uploaded successfully' })
	@ApiResponse({ status: 400, description: 'Invalid file' })
	async uploadProductImage(@Req() req: any) {
		const file = await this.parseMultipartFile(req)
		const sellerId = req.user.sub

		return this.uploadService.uploadProductImage(
			file.buffer,
			file.filename,
			file.mimetype,
			sellerId,
		)
	}

	// NOTE: profile pictures (avatars) are PRIVATE and handled by the auth module
	// (POST/GET/DELETE /auth/profile/avatar) — they are never uploaded here, which
	// only serves the public product-image flow.

	@Delete(':encodedPath')
	@ApiOperation({ summary: 'Delete uploaded file (path must be base64 encoded)' })
	@ApiParam({ name: 'encodedPath', type: String, description: 'Base64 encoded file path' })
	@ApiResponse({ status: 200, description: 'File deleted' })
	async deleteFile(@Param('encodedPath') encodedPath: string, @Req() req: any) {
		const path = Buffer.from(encodedPath, 'base64').toString('utf-8').replace(/\\/g, '/')
		const userId = req.user.sub

		// Ownership check: callers may only delete files under their own product folder
		// or their own profile image. Prevents deleting another tenant's uploads.
		const ownsProductImage = path.startsWith(`products/${userId}/`)
		const ownsProfileImage = path.startsWith(`profiles/${userId}-profile.`)
		if (!ownsProductImage && !ownsProfileImage) {
			throw new ForbiddenException('Você não tem permissão para excluir este arquivo')
		}

		const deleted = await this.uploadService.deleteFile(path)
		return { deleted }
	}

	private async parseMultipartFile(
		req: any,
	): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
		const data = await req.file()

		if (!data) {
			throw new BadRequestException('Nenhum arquivo enviado')
		}

		const buffer = await data.toBuffer()

		return {
			buffer,
			filename: data.filename,
			mimetype: data.mimetype,
		}
	}
}
