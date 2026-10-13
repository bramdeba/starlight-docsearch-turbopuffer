import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTurbopufferSearchClient } from '../src/client/search-client';

const body = (query: string) => ({ hits: [{ objectID: query }], nbHits: 1, processingTimeMS: 5 });

describe('createTurbopufferSearchClient', () => {
	let fetch: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', { location: { href: 'https://docs.test/guides/' } });
		fetch = vi.fn(async (url: string) => Response.json(body(new URL(url).searchParams.get('q')!)));
		vi.stubGlobal('fetch', fetch);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const search = (client: ReturnType<typeof createTurbopufferSearchClient>, query: string) =>
		client.search({ requests: [{ query, indexName: 'docs-en' }] });

	test('returns results in the shape DocSearch expects', async () => {
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 0 });
		const { results } = await search(client, 'install');
		expect(results[0]).toMatchObject({ hits: [{ objectID: 'install' }], nbHits: 1, index: 'docs-en' });
		expect(fetch).toHaveBeenCalledWith('https://docs.test/api/search?q=install&lang=en');
	});

	test('only sends the last query of a burst', async () => {
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 100 });
		const first = search(client, 'ins');
		const second = search(client, 'inst');
		const third = search(client, 'install');
		await vi.advanceTimersByTimeAsync(100);
		const results = await Promise.all([first, second, third]);
		expect(fetch).toHaveBeenCalledTimes(1);
		for (const { results: r } of results) expect(r[0]!.hits[0]!.objectID).toBe('install');
	});

	test('reports loading from the first keystroke until results arrive', async () => {
		const onLoadingChange = vi.fn();
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 100, onLoadingChange });
		const first = search(client, 'ins');
		const second = search(client, 'install');
		expect(onLoadingChange.mock.calls).toEqual([[true]]);
		await vi.advanceTimersByTimeAsync(100);
		await Promise.all([first, second]);
		expect(onLoadingChange.mock.calls).toEqual([[true], [false]]);
	});

	test('stops loading when a query fails', async () => {
		fetch.mockResolvedValueOnce(new Response('', { status: 502 }));
		const onLoadingChange = vi.fn();
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 0, onLoadingChange });
		await expect(search(client, 'install')).rejects.toThrow();
		expect(onLoadingChange).toHaveBeenLastCalledWith(false);
	});

	test('caches queries', async () => {
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 0 });
		await search(client, 'install');
		await search(client, 'install');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	test('does not query for empty input', async () => {
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 0 });
		const { results } = await search(client, '  ');
		expect(results[0]!.hits).toEqual([]);
		expect(fetch).not.toHaveBeenCalled();
	});

	test('raises a RetryError so DocSearch shows its error screen', async () => {
		fetch.mockResolvedValueOnce(new Response('', { status: 502 }));
		const client = createTurbopufferSearchClient({ endpoint: '/api/search', lang: 'en', debounce: 0 });
		await expect(search(client, 'install')).rejects.toMatchObject({ name: 'RetryError' });
		// Failed queries are not cached.
		await expect(search(client, 'install')).resolves.toBeTruthy();
	});

	test('warms the cache once', async () => {
		const client = createTurbopufferSearchClient({ endpoint: 'https://search.test/', lang: 'fr', debounce: 0 });
		client.warm();
		client.warm();
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith('https://search.test/?warm=&lang=fr');
	});
});
