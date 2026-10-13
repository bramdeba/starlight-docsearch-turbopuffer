import type { SearchResponseBody } from '../shared/types';

interface SearchRequest {
	query?: string;
	indexName: string;
}

export interface TurbopufferSearchClientOptions {
	endpoint: string;
	lang: string;
	debounce: number;
	/** Called when queries start or stop being in flight (including the debounce delay). */
	onLoadingChange?: ((loading: boolean) => void) | undefined;
}

const CACHE_SIZE = 50;

/**
 * A stand-in for the Algolia client DocSearch expects, sending queries to the search handler.
 * Pass it to DocSearch through `transformSearchClient`.
 */
export function createTurbopufferSearchClient({
	endpoint,
	lang,
	debounce,
	onLoadingChange,
}: TurbopufferSearchClientOptions) {
	const cache = new Map<string, Promise<SearchResponseBody>>();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let waiting: { resolve: (body: SearchResponseBody) => void; reject: (error: unknown) => void }[] = [];

	const url = (params: Record<string, string>) => {
		const target = new URL(endpoint, window.location.href);
		for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
		return target.toString();
	};

	const request = (query: string): Promise<SearchResponseBody> => {
		const cached = cache.get(query);
		if (cached) return cached;
		const promise = fetch(url({ q: query, lang })).then(async (response) => {
			if (!response.ok) throw new Error(`Search failed with status ${response.status}`);
			return (await response.json()) as SearchResponseBody;
		});
		cache.set(query, promise);
		if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
		promise.catch(() => cache.delete(query));
		return promise;
	};

	// Typing fires a query per keystroke. Only the last query in a burst is sent; earlier calls
	// resolve with its results, which DocSearch then discards as outdated.
	const debounced = (query: string): Promise<SearchResponseBody> => {
		if (cache.has(query) || debounce === 0) return request(query);
		return new Promise((resolve, reject) => {
			waiting.push({ resolve, reject });
			clearTimeout(timer);
			timer = setTimeout(() => {
				const callers = waiting;
				waiting = [];
				request(query).then(
					(body) => callers.forEach((caller) => caller.resolve(body)),
					(error) => callers.forEach((caller) => caller.reject(error))
				);
			}, debounce);
		});
	};

	// Superseded calls settle together with the latest one, so this drops to 0 once results are in.
	let active = 0;
	const track = <T>(promise: Promise<T>): Promise<T> => {
		if (active++ === 0) onLoadingChange?.(true);
		return promise.finally(() => {
			if (--active === 0) onLoadingChange?.(false);
		});
	};

	let warmed = false;

	return {
		/** Ask turbopuffer to load the namespace into cache so the first query is fast. */
		warm() {
			if (warmed) return;
			warmed = true;
			fetch(url({ warm: '', lang })).catch(() => {
				warmed = false;
			});
		},
		async search({ requests }: { requests: SearchRequest[] }) {
			const query = requests[0]?.query?.trim() ?? '';
			try {
				const body = query ? await track(debounced(query)) : { hits: [], nbHits: 0, processingTimeMS: 0 };
				return {
					results: requests.map((req) => ({
						hits: body.hits,
						nbHits: body.nbHits,
						index: req.indexName,
						query,
						params: '',
						page: 0,
						nbPages: 1,
						hitsPerPage: body.hits.length,
						exhaustiveNbHits: true,
						processingTimeMS: body.processingTimeMS,
					})),
				};
			} catch (cause) {
				// DocSearch shows its error screen only for errors named `RetryError`.
				const error = new Error('Unable to reach the search endpoint.', { cause });
				error.name = 'RetryError';
				throw error;
			}
		},
		addAlgoliaAgent() {},
		transporter: { algoliaAgent: { value: '', add() {} } },
	};
}
