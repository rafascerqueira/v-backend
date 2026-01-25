import { createParamDecorator, ExecutionContext } from '@nestjs/common'
import type { TokenPayload } from '../dto/auth-response.dto'

export const CurrentUser = createParamDecorator(
	(data: keyof TokenPayload | undefined, ctx: ExecutionContext) => {
		const request = ctx.switchToHttp().getRequest()
		const user = request.user as TokenPayload

		if (data) {
			return user?.[data]
		}

		return user
	},
)
