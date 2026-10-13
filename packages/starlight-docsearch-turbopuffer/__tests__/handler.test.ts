import { describe, expect, test, vi } from 'vitest';
import { createSearchHandler } from '../src/server/handler';

function setup(response: () => Response, options: Partial<Parameters<typeof createSearchHandler>[0]> = {}) {
	const fetch = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => response());
	const handler = createSearchHandler({
		apiKey: 'tpuf_key',
		region: 'gcp-europe-west1',
		namespace: 'docs-{lang}',
		langs: ['en', 'fr'],
		fetch: fetch as typeof globalThis.fetch,
		...options,
	});
	return { handler, fetch };
}

const rows = (ids: string[], dist = 1) =>
	ids.map((id) => ({
		id,
		$dist: dist,
		url: `/${id}/`,
		page: `/${id}/`,
		anchor: null,
		type: 'lvl1',
		hierarchy: ['Guides', id],
		content: `About ${id}`,
	}));

describe('createSearchHandler', () => {
	test('queries the namespace for the language and returns hits', async () => {
		const { handler, fetch } = setup(() =>
			Response.json({
				results: [{ rows: rows(['a'], 0.3) }, { rows: rows(['a', 'b']) }],
				performance: { server_total_ms: 21.4 },
			})
		);
		const response = await handler(new Request('https://docs.test/api/search?q=install%20it&lang=fr'));
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.hits.map((hit: { objectID: string }) => hit.objectID)).toEqual(['a', 'b']);
		expect(body.processingTimeMS).toBe(21);

		const [url, init] = fetch.mock.calls[0]!;
		expect(url).toBe('https://gcp-europe-west1.turbopuffer.com/v2/namespaces/docs-fr/query');
		expect(init!.headers).toMatchObject({ Authorization: 'Bearer tpuf_key' });
		expect(JSON.parse(init!.body as string).queries).toHaveLength(2);
		expect(response.headers.get('Cache-Control')).toBe('public, max-age=60');
	});

	test('rejects unknown languages', async () => {
		const { handler, fetch } = setup(() => Response.json({}));
		const response = await handler(new Request('https://docs.test/api/search?q=x&lang=de'));
		expect(response.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	test('rejects malformed languages when no list is given', async () => {
		const { handler } = setup(() => Response.json({}), { langs: undefined });
		const response = await handler(new Request('https://docs.test/api/search?q=x&lang=../admin'));
		expect(response.status).toBe(400);
	});

	test('ignores the language without a placeholder', async () => {
		const { handler, fetch } = setup(() => Response.json({ results: [{ rows: [] }, { rows: [] }] }), {
			namespace: 'docs',
		});
		await handler(new Request('https://docs.test/api/search?q=hello&lang=xx'));
		expect(fetch.mock.calls[0]![0]).toBe('https://gcp-europe-west1.turbopuffer.com/v2/namespaces/docs/query');
	});

	test('returns no hits for empty queries without calling turbopuffer', async () => {
		const { handler, fetch } = setup(() => Response.json({}));
		const response = await handler(new Request('https://docs.test/api/search?q=%20&lang=en'));
		expect(await response.json()).toEqual({ hits: [], nbHits: 0, processingTimeMS: 0 });
		expect(fetch).not.toHaveBeenCalled();
	});

	test('returns no hits before the namespace exists', async () => {
		const { handler } = setup(() => new Response('not found', { status: 404 }));
		const response = await handler(new Request('https://docs.test/api/search?q=hello&lang=en'));
		expect(response.status).toBe(200);
		expect((await response.json()).hits).toEqual([]);
	});

	test('reports turbopuffer errors as 502 without leaking details', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { handler } = setup(() => new Response('secret details', { status: 500 }));
		const response = await handler(new Request('https://docs.test/api/search?q=hello&lang=en'));
		expect(response.status).toBe(502);
		expect(await response.text()).not.toContain('secret');
		error.mockRestore();
	});

	test('reports network errors as 502', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const handler = createSearchHandler({
			apiKey: 'k',
			region: 'r',
			namespace: 'docs',
			fetch: (async () => {
				throw new TypeError('fetch failed');
			}) as typeof fetch,
		});
		expect((await handler(new Request('https://docs.test/?q=hello'))).status).toBe(502);
		expect((await handler(new Request('https://docs.test/?warm'))).status).toBe(502);
		error.mockRestore();
	});

	test('warms the cache', async () => {
		const { handler, fetch } = setup(() => Response.json({ status: 'ACCEPTED' }));
		const response = await handler(new Request('https://docs.test/api/search?warm&lang=en'));
		expect(response.status).toBe(204);
		expect(fetch.mock.calls[0]![0]).toBe(
			'https://gcp-europe-west1.turbopuffer.com/v1/namespaces/docs-en/hint_cache_warm'
		);
	});

	test('truncates very long queries', async () => {
		const { handler, fetch } = setup(() => Response.json({ results: [{ rows: [] }, { rows: [] }] }));
		await handler(new Request(`https://docs.test/api/search?q=${'a'.repeat(1000)}&lang=en`));
		const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
		expect(body.queries[0].rank_by[2][1]).toHaveLength(256);
	});

	test('only allows GET', async () => {
		const { handler } = setup(() => Response.json({}));
		const response = await handler(new Request('https://docs.test/api/search', { method: 'POST' }));
		expect(response.status).toBe(405);
	});

	describe('CORS', () => {
		const request = (origin: string) =>
			new Request('https://search.test/?q=a&lang=en', { headers: { Origin: origin } });

		test('sends no CORS headers by default', async () => {
			const { handler } = setup(() => Response.json({ results: [{ rows: [] }] }));
			const response = await handler(request('https://docs.test'));
			expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
		});

		test('allows listed origins', async () => {
			const { handler } = setup(() => Response.json({ results: [{ rows: [] }] }), {
				allowedOrigins: ['https://docs.test'],
			});
			expect((await handler(request('https://docs.test'))).headers.get('Access-Control-Allow-Origin')).toBe(
				'https://docs.test'
			);
			expect((await handler(request('https://evil.test'))).headers.get('Access-Control-Allow-Origin')).toBeNull();
		});

		test('answers preflight requests', async () => {
			const { handler } = setup(() => Response.json({}), { allowedOrigins: '*' });
			const response = await handler(
				new Request('https://search.test/', { method: 'OPTIONS', headers: { Origin: 'https://a.test' } })
			);
			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
		});
	});
});
