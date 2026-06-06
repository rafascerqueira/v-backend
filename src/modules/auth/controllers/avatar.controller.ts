import { BadRequestException, Controller, Delete, Get, Post, Req, Res } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { AccountService } from '@/modules/users/services/account.service'
import { UploadService } from '@/shared/upload/upload.service'
import { CurrentUser } from '../decorators/current-user.decorator'
import type { TokenPayload } from '../dto/auth-response.dto'
import { resolveAvatarUrl } from '../utils/avatar-url'

/**
 * Profile picture (avatar) — PRIVATE asset.
 *
 * Avatars are stored under the `profiles/` prefix, which is NOT publicly readable
 * in the bucket. They are only ever served through `GET /auth/profile/avatar`,
 * which requires a valid session (the browser's HttpOnly auth cookie rides along
 * with the <img> request), so a user can only fetch their own avatar.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AvatarController {
	constructor(
		private readonly accountService: AccountService,
		private readonly uploadService: UploadService,
		private readonly configService: ConfigService,
	) {}

	@Post('profile/avatar')
	@ApiOperation({ summary: 'Upload current user profile picture' })
	@ApiConsumes('multipart/form-data')
	@ApiResponse({ status: 201, description: 'Avatar uploaded' })
	async upload(@CurrentUser() user: TokenPayload, @Req() req: any) {
		const file = await this.parseMultipartFile(req)

		// Re-encode + store privately; the storage key is persisted on the account
		// server-side so the client can never point its avatar at another user's key.
		const result = await this.uploadService.uploadProfileImage(
			file.buffer,
			file.filename,
			file.mimetype,
			user.sub,
		)
		const account = await this.accountService.setAvatar(user.sub, result.path)

		return {
			avatarUrl: resolveAvatarUrl(account.avatar, this.appUrl, account.updatedAt),
		}
	}

	@Get('profile/avatar')
	@ApiOperation({ summary: 'Stream current user profile picture (owner only)' })
	async serve(@CurrentUser() user: TokenPayload, @Res() reply: FastifyReply) {
		const account = await this.accountService.findById(user.sub)
		const avatar = account?.avatar

		if (!avatar) {
			reply.status(404).send()
			return
		}
		// External (OAuth) avatars are absolute URLs — redirect instead of proxying.
		if (/^https?:\/\//.test(avatar)) {
			reply.redirect(avatar)
			return
		}

		const object = await this.uploadService.getObject(avatar)
		if (!object) {
			reply.status(404).send()
			return
		}

		reply
			.header('Content-Type', object.contentType ?? 'application/octet-stream')
			.header('Cache-Control', 'private, max-age=300')
			.header('X-Content-Type-Options', 'nosniff')
		if (object.contentLength) reply.header('Content-Length', object.contentLength)
		reply.send(object.body)
	}

	@Delete('profile/avatar')
	@ApiOperation({ summary: 'Remove current user profile picture' })
	async remove(@CurrentUser() user: TokenPayload) {
		await this.accountService.removeProfilePicture(user.sub)
		return { avatarUrl: null }
	}

	private get appUrl(): string {
		return this.configService.get<string>('appUrl', 'http://localhost:3001')
	}

	private async parseMultipartFile(
		req: any,
	): Promise<{ buffer: Buffer; filename: string; mimetype: string }> {
		const data = await req.file()
		if (!data) {
			throw new BadRequestException('Nenhum arquivo enviado')
		}
		const buffer = await data.toBuffer()
		return { buffer, filename: data.filename, mimetype: data.mimetype }
	}
}
