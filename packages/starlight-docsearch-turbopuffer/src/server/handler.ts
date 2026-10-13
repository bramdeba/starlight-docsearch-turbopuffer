import {
	LANG_PLACEHOLDER,
	baseURLFor,
	namespaceFor,
	resolveRanking,
	type SearchRankingOptions,
} from '../shared/options';
import type { SearchResponseBody } from '../shared/types';
import { buildQuery, fuse, toHit, type ResultRow } from './search';

export type { SearchRankingOptions } from '../shared/options';
export type { SearchResponseBody, DocSearchHit } from '../shared/types';

export interface SearchHandlerOptions {
	/**
	 * A turbopuffer API key. Use a read-only key: the handler only queries.
	 */
	apiKey: string;
	/** The namespace (or `{lang}` template) the site was indexed into. */
	namespace: string;
	/** The turbopuffer region, e.g. `gcp-europe-west1`. */
	region?: string | undefined;
	/** A custom turbopuffer API base URL. Takes precedence over `region`. */
	baseURL?: string | undefined;
	/** Ranking and hybrid search settings. Should match the plugin’s `search` option. */
	search?: SearchRankingOptions | undefined;
	/**
	 * Language tags accepted for the `{lang}` placeholder. When unset, any well-formed language
	 * tag is accepted.
	 */
	langs?: string[] | undefined;
	/**
	 * Origins allowed to call the handler from a browser. Only needed when the handler is served
	 * from a different origin than your docs.
	 */
	allowedOrigins?: '*' | string[] | undefined;
	/**
	 * `Cache-Control` header for search responses.
	 * @default 'public, max-age=60'
	 */
	cacheControl?: string | undefined;
	/** Custom `fetch` implementation. */
	fetch?: typeof fetch | undefined;
}

const MAX_QUERY_LENGTH = 256;
const LANG_RE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/**
 * Create a search request handler using the standard `Request`/`Response` API. It works on
 * Cloudflare Workers, Vercel, Netlify, Deno, Bun and Node.js.
 *
 * - `GET ?q=<query>&lang=<lang>` runs a hybrid search and returns DocSearch hits.
 * - `GET ?warm&lang=<lang>` asks turbopuffer to load the namespace into cache.
 *
 * @example
 * // Cloudflare Worker
 * import { createSearchHandler } from 'starlight-docsearch-turbopuffer/handler';
 *
 * export default {
 *   fetch: (request, env) =>
 *     createSearchHandler({
 *       apiKey: env.TURBOPUFFER_API_KEY,
 *       region: 'gcp-europe-west1',
 *       namespace: 'my-docs-{lang}',
 *       allowedOrigins: ['https://docs.example.com'],
 *     })(request),
 * };
 */
export function createSearchHandler(options: SearchHandlerOptions) {
	if (!options.apiKey) throw new Error('`apiKey` is required to create a search handler.');
	const ranking = resolveRanking(options.search);
	const baseURL = baseURLFor(options);
	const fetchFn = options.fetch ?? fetch;
	const langs = options.langs?.map((lang) => lang.toLowerCase());
	const headers = { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' };

	return async function handleSearch(request: Request): Promise<Response> {
		const cors = corsHeaders(request, options.allowedOrigins);
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
		if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);

		const params = new URL(request.url).searchParams;
		let namespace: string;
		try {
			namespace = resolveNamespace(options.namespace, params.get('lang'), langs);
		} catch (error) {
			return json({ error: (error as Error).message }, 400, cors);
		}
		const namespaceURL = `${baseURL}/v1/namespaces/${encodeURIComponent(namespace)}`;

		if (params.has('warm')) {
			const response = await fetchFn(`${namespaceURL}/hint_cache_warm`, { headers }).catch(logError);
			return new Response(null, { status: response?.ok ? 204 : 502, headers: cors });
		}

		const query = (params.get('q') ?? '').trim().slice(0, MAX_QUERY_LENGTH);
		if (!query) return json(emptyResult(), 200, cors);

		const response = await fetchFn(`${baseURL}/v2/namespaces/${encodeURIComponent(namespace)}/query`, {
			method: 'POST',
			headers,
			body: JSON.stringify(buildQuery(query, ranking)),
		}).catch(logError);
		if (!response) return json({ error: 'Search failed' }, 502, cors);
		// The namespace doesn’t exist until the site is indexed for the first time.
		if (response.status === 404) return json(emptyResult(), 200, cors);
		if (!response.ok) {
			console.error(`[starlight-docsearch-turbopuffer] turbopuffer returned ${response.status}: ${await response.text()}`);
			return json({ error: 'Search failed' }, 502, cors);
		}

		const data = (await response.json()) as {
			results: { rows?: ResultRow[] }[];
			performance?: { server_total_ms?: number };
		};
		const rows = data.results.map((result) => result.rows ?? []);
		const fused = fuse(
			rows.length === 2 ? { semantic: rows[0], keyword: rows[1]! } : { keyword: rows[0]! },
			query,
			ranking
		);
		const hits = fused.map((row) => toHit(row, query, ranking));
		const body: SearchResponseBody = {
			hits,
			nbHits: hits.length,
			processingTimeMS: Math.round(data.performance?.server_total_ms ?? 0),
		};
		return json(body, 200, {
			...cors,
			'Cache-Control': options.cacheControl ?? 'public, max-age=60',
		});
	};
}

function resolveNamespace(template: string, lang: string | null, langs?: string[]): string {
	if (!template.includes(LANG_PLACEHOLDER)) return namespaceFor(template, '');
	if (!lang || !LANG_RE.test(lang)) throw new Error('A valid `lang` parameter is required.');
	if (langs && !langs.includes(lang.toLowerCase())) throw new Error(`Unknown language "${lang}".`);
	return namespaceFor(template, lang);
}

function corsHeaders(request: Request, allowed: SearchHandlerOptions['allowedOrigins']): Record<string, string> {
	const origin = request.headers.get('Origin');
	if (!allowed || !origin) return {};
	if (allowed !== '*' && !allowed.includes(origin)) return {};
	return {
		'Access-Control-Allow-Origin': allowed === '*' ? '*' : origin,
		'Access-Control-Allow-Methods': 'GET, OPTIONS',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
}

function logError(error: unknown): undefined {
	console.error('[starlight-docsearch-turbopuffer] Could not reach turbopuffer:', error);
	return undefined;
}

function emptyResult(): SearchResponseBody {
	return { hits: [], nbHits: 0, processingTimeMS: 0 };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
	});
}
