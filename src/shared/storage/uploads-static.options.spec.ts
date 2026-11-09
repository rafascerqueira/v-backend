/**
 * Regression guard for the `/uploads/` static route options.
 *
 * The `@fastify/static` `setHeaders` contract changed between majors: v9 passed the
 * raw Node response, v10 passes the Fastify reply. A callback written for the wrong
 * one throws on every request and turns each served upload into a 500.
 *
 * The callback is exercised against a REAL Fastify reply (not a hand-rolled fake).
 * `@fastify/static` itself is not loaded here: v10 pulls in an ESM-only dependency
 * that Jest's CommonJS runtime cannot require.
 */
import fastify, { type FastifyInstance } from 'fastify'
import { buildUploadsStaticOptions, UPLOADS_STATIC_PREFIX } from './uploads-static.options'

describe('buildUploadsStaticOptions', () => {
	const options = buildUploadsStaticOptions('/var/app/uploads')
	let app: FastifyInstance

	beforeAll(async () => {
		app = fastify()
		// Mirrors how @fastify/static v10 invokes the callback: setHeaders(reply, path, stat).
		app.get('/probe', (_request, reply) => {
			options.setHeaders(reply)
			return reply.send('ok')
		})
		await app.ready()
	})

	afterAll(async () => {
		await app.close()
	})

	it('serves the given root under the /uploads/ prefix without decorating the reply', () => {
		expect(options.root).toBe('/var/app/uploads')
		expect(options.prefix).toBe('/uploads/')
		expect(UPLOADS_STATIC_PREFIX).toBe('/uploads/')
		expect(options.serve).toBe(true)
		expect(options.decorateReply).toBe(false)
	})

	it('sets the nosniff header through the Fastify reply without throwing', async () => {
		const res = await app.inject({ url: '/probe' })

		expect(res.statusCode).toBe(200)
		expect(res.headers['x-content-type-options']).toBe('nosniff')
	})
})
