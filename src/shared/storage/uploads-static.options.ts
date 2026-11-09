import type { FastifyStaticOptions } from '@fastify/static'
import type { FastifyReply } from 'fastify'

export const UPLOADS_STATIC_PREFIX = '/uploads/'

/**
 * Options for the `@fastify/static` route that serves locally stored uploads
 * (registered in `main.ts` only when the local storage driver is active).
 */
export function buildUploadsStaticOptions(root: string) {
	return {
		serve: true,
		root,
		prefix: UPLOADS_STATIC_PREFIX,
		decorateReply: false,
		// Defense-in-depth: stop browsers from MIME-sniffing uploaded files into an
		// executable type (e.g. treating a file as HTML/SVG).
		// @fastify/static v10 passes the Fastify reply here (v9 passed the raw response).
		setHeaders: (reply: FastifyReply) => {
			reply.header('X-Content-Type-Options', 'nosniff')
		},
	} as const satisfies FastifyStaticOptions
}
