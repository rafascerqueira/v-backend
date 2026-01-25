import {
	Injectable,
	type NestInterceptor,
	type ExecutionContext,
	type CallHandler,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tenantStorage, type TenantData } from './tenant.context'

@Injectable()
export class TenantInterceptor implements NestInterceptor {
	intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
		const request = context.switchToHttp().getRequest()
		const user = request.user

		if (user?.sub && user?.role) {
			const tenantData: TenantData = {
				sellerId: user.sub,
				role: user.role,
			}

			return new Observable((subscriber) => {
				tenantStorage.run(tenantData, () => {
					next.handle().subscribe({
						next: (value) => subscriber.next(value),
						error: (err) => subscriber.error(err),
						complete: () => subscriber.complete(),
					})
				})
			})
		}

		return next.handle()
	}
}
