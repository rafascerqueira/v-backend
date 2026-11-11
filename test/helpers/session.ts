import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import request from 'supertest'

export interface ParsedCookie {
	value: string
	raw: string
	/** Lower-cased attributes, e.g. `httponly`, `path=/auth`, `max-age=900`. */
	attrs: string[]
}

export type CookieJar = Record<string, ParsedCookie>

/** Parse a Set-Cookie header array into { name: { value, attrs } } (last one wins). */
export function parseSetCookies(header: string | string[] | undefined): CookieJar {
	const lines = Array.isArray(header) ? header : header ? [header] : []
	const jar: CookieJar = {}
	for (const line of lines) {
		const [pair, ...rest] = line.split(';')
		const eq = pair.indexOf('=')
		const name = pair.slice(0, eq).trim()
		const value = pair.slice(eq + 1).trim()
		jar[name] = { value, raw: line, attrs: rest.map((a) => a.trim().toLowerCase()) }
	}
	return jar
}

/** Build a Cookie request header from a jar, skipping cookies the server cleared. */
export function cookieHeader(jar: CookieJar, only?: string[]): string {
	return Object.entries(jar)
		.filter(([name, cookie]) => cookie.value !== '' && (!only || only.includes(name)))
		.map(([name, cookie]) => `${name}=${cookie.value}`)
		.join('; ')
}

/** Decode a JWT payload without verifying it (assertions on what the token carries). */
export function decodeJwt(token: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

export interface BrowserSession {
	jar: CookieJar
	/** Cookie header carrying every session cookie. */
	cookies: string
	csrf: string
	sid: string
}

export function toSession(jar: CookieJar): BrowserSession {
	return {
		jar,
		cookies: cookieHeader(jar),
		csrf: jar.csrf_token?.value ?? '',
		sid: String(decodeJwt(jar.access_token.value).sid),
	}
}

/** Log in over HTTP and return the cookies a browser would now hold. */
export async function login(
	app: NestFastifyApplication,
	credentials: { email: string; password: string; remember?: boolean },
): Promise<BrowserSession> {
	const res = await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(200)
	return toSession(parseSetCookies(res.headers['set-cookie']))
}

/** Cookies after a response that rewrote some of them (refresh, change-password). */
export function mergeCookies(
	session: BrowserSession,
	header: string | string[] | undefined,
): BrowserSession {
	return toSession({ ...session.jar, ...parseSetCookies(header) })
}
