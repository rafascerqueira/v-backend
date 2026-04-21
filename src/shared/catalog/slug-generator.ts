/**
 * Slug generation for public store catalogs.
 *
 * Exposes:
 *  - RESERVED_SLUGS: slugs that collide with application routes, brand or
 *    would be confusing as a public URL, and must be rejected.
 *  - slugifyBase: deterministic base slug from a trade name (or personal name
 *    as fallback). Strips diacritics, lowercases, replaces non-alphanumerics
 *    with hyphens and trims to 45 characters (leaving room for a suffix).
 *  - generateUniqueSlug: finds a free slug by appending -2, -3, ... until
 *    neither the reserved list nor the caller-provided `isTaken` check flags
 *    it. The `isTaken` callback lets each caller use its own repository
 *    without this helper taking a Prisma dependency.
 */

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
	'about',
	'admin',
	'api',
	'app',
	'auth',
	'billings',
	'blog',
	'bundles',
	'careers',
	'cart',
	'catalog',
	'catalog-share',
	'checkout',
	'contact',
	'contato',
	'cookies',
	'customers',
	'dashboard',
	'docs',
	'forgot-password',
	'help',
	'home',
	'lgpd',
	'loja',
	'login',
	'logout',
	'mail',
	'null',
	'orders',
	'pedido',
	'pedidos',
	'plans',
	'privacy',
	'products',
	'promotions',
	'register',
	'reports',
	'reset-password',
	'root',
	'settings',
	'signup',
	'status',
	'stock',
	'suppliers',
	'support',
	'system',
	'terms',
	'test',
	'undefined',
	'vendinha',
	'vendinhas',
	'www',
])

export function slugifyBase(storeName: string | null, personalName: string): string {
	const source = storeName?.trim() || personalName
	const slug = source
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.substring(0, 45)
	return slug || 'loja'
}

export async function generateUniqueSlug(
	isTaken: (slug: string) => Promise<boolean>,
	storeName: string | null,
	personalName: string,
): Promise<string> {
	const base = slugifyBase(storeName, personalName)
	let candidate = base
	let suffix = 2
	while (RESERVED_SLUGS.has(candidate) || (await isTaken(candidate))) {
		candidate = `${base}-${suffix}`
		suffix += 1
		if (suffix > 100) break
	}
	return candidate
}
