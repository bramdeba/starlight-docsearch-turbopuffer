import { z } from 'astro/zod';
import type { SearchRankingOptions } from './shared/options';

const RankingSchema = z.strictObject({
	limit: z.number().int().min(1).max(100).optional(),
	maxResultsPerPage: z.number().int().min(1).optional(),
	semanticWeight: z.number().positive().optional(),
	keywordWeight: z.number().positive().optional(),
	rankConstant: z.number().positive().optional(),
	boosts: z
		.strictObject({
			title: z.number().positive().optional(),
			pageTitle: z.number().positive().optional(),
			content: z.number().positive().optional(),
		})
		.optional(),
	maxDistance: z.union([z.number().positive(), z.literal(false)]).optional(),
	relativeDistance: z.union([z.number().positive(), z.literal(false)]).optional(),
	minSemanticQueryLength: z.number().int().min(0).optional(),
	snippetLength: z.number().int().min(20).optional(),
});

export const TurbopufferDocSearchConfigSchema = z.strictObject({
	namespace: z.string().min(1),
	region: z.string().optional(),
	baseURL: z.url().optional(),
	endpoint: z.string().optional(),
	embedding: z
		.strictObject({
			model: z.string().default('baai/bge-m3'),
			dimensions: z.number().int().positive().optional(),
		})
		.default({ model: 'baai/bge-m3' }),
	distanceMetric: z.enum(['cosine_distance', 'euclidean_squared']).default('cosine_distance'),
	fullTextSearch: z
		.strictObject({
			language: z.union([z.string(), z.record(z.string(), z.string())]).optional(),
			stemming: z.boolean().default(true),
			removeStopwords: z.boolean().default(true),
			asciiFolding: z.boolean().default(true),
			tokenizer: z.string().default('word_v4'),
			k1: z.number().optional(),
			b: z.number().optional(),
		})
		.default({ stemming: true, removeStopwords: true, asciiFolding: true, tokenizer: 'word_v4' }),
	search: RankingSchema.optional(),
	indexing: z
		.strictObject({
			enabled: z.union([z.boolean(), z.literal('auto')]).default('auto'),
			contentSelector: z.string().default('.sl-markdown-content'),
			ignoreSelectors: z.array(z.string()).default([]),
			exclude: z.array(z.string()).default([]),
			maxChunkLength: z.number().int().min(200).default(1500),
			concurrency: z.number().int().min(1).max(16).default(4),
		})
		.default({
			enabled: 'auto',
			contentSelector: '.sl-markdown-content',
			ignoreSelectors: [],
			exclude: [],
			maxChunkLength: 1500,
			concurrency: 4,
		}),
	maxResultsPerGroup: z.number().int().min(1).optional(),
	disableUserPersonalization: z.boolean().optional(),
	recentSearchesLimit: z.number().int().min(0).optional(),
	debounce: z.number().int().min(0).default(120),
	clientOptionsModule: z.string().optional(),
});

export type TurbopufferDocSearchConfig = z.output<typeof TurbopufferDocSearchConfigSchema>;

// The user config type is hand-written rather than inferred with `z.input<schema>` so that JSDoc
// comments are preserved in the emitted declaration files. A type test keeps both in sync.
// @see {@link file://./../__tests__/config.test-d.ts}
export interface TurbopufferDocSearchUserConfig {
	/**
	 * The turbopuffer namespace to index into and search. For multilingual sites, include a
	 * `{lang}` placeholder: it is replaced with each locale’s language tag, e.g. `my-docs-{lang}`
	 * becomes `my-docs-en`, `my-docs-fr`, ….
	 */
	namespace: string;
	/**
	 * The turbopuffer region, e.g. `gcp-europe-west1`. Defaults to the `TURBOPUFFER_REGION`
	 * environment variable.
	 * @see https://turbopuffer.com/docs/regions
	 */
	region?: string | undefined;
	/** A custom turbopuffer API base URL. Takes precedence over `region`. */
	baseURL?: string | undefined;
	/**
	 * URL of the search endpoint the browser sends queries to. Set this when you deploy the search
	 * handler separately (e.g. as a Cloudflare Worker).
	 *
	 * When unset, the plugin injects an on-demand `/api/search` route into your site. This requires
	 * an Astro adapter in production builds.
	 */
	endpoint?: string | undefined;
	/** Turbopuffer native embedding settings. Changing these requires re-indexing (`--reset`). */
	embedding?:
		| {
				/**
				 * The embedding model.
				 * @default 'baai/bge-m3'
				 * @see https://turbopuffer.com/docs/embedding
				 */
				model?: string | undefined;
				/** Vector dimensions. Defaults to the model’s default size. */
				dimensions?: number | undefined;
		  }
		| undefined;
	/**
	 * The vector distance metric.
	 * @default 'cosine_distance'
	 */
	distanceMetric?: 'cosine_distance' | 'euclidean_squared' | undefined;
	/** Full-text (BM25) index settings. */
	fullTextSearch?:
		| {
				/**
				 * The turbopuffer full-text search language, or a map of language tag to language.
				 * Defaults to the language of each locale when turbopuffer supports it.
				 * @see https://turbopuffer.com/docs/fts
				 */
				language?: string | Record<string, string> | undefined;
				/**
				 * Reduce words to their stem, so `installing` matches `install`.
				 * @default true
				 */
				stemming?: boolean | undefined;
				/**
				 * Ignore common words like `the` and `a`.
				 * @default true
				 */
				removeStopwords?: boolean | undefined;
				/**
				 * Ignore diacritics, so `cafe` matches `café`.
				 * @default true
				 */
				asciiFolding?: boolean | undefined;
				/**
				 * The tokenizer. Pinned so turbopuffer upgrades don’t change ranking unexpectedly.
				 * @default 'word_v4'
				 */
				tokenizer?: string | undefined;
				/** BM25 `k1` parameter. */
				k1?: number | undefined;
				/** BM25 `b` parameter. */
				b?: number | undefined;
		  }
		| undefined;
	/** Ranking and hybrid search settings, applied by the search handler. */
	search?: SearchRankingOptions | undefined;
	/** Build-time indexing settings. */
	indexing?:
		| {
				/**
				 * Whether to index the site after `astro build`. `'auto'` indexes when the
				 * `TURBOPUFFER_API_KEY` environment variable is set.
				 * @default 'auto'
				 */
				enabled?: boolean | 'auto' | undefined;
				/**
				 * CSS selector for the content to index on each page.
				 * @default '.sl-markdown-content'
				 */
				contentSelector?: string | undefined;
				/** Extra CSS selectors for elements to leave out of the index. */
				ignoreSelectors?: string[] | undefined;
				/**
				 * Pages to leave out of the index, as URL path patterns. `*` matches within a path
				 * segment and `**` across segments, e.g. `/blog/**`.
				 */
				exclude?: string[] | undefined;
				/**
				 * Maximum length of a record’s content, in characters. Longer sections are split.
				 * @default 1500
				 */
				maxChunkLength?: number | undefined;
				/**
				 * Number of concurrent write requests to turbopuffer.
				 * @default 4
				 */
				concurrency?: number | undefined;
		  }
		| undefined;
	/**
	 * The maximum number of results to display per page in the modal.
	 * @default 5
	 */
	maxResultsPerGroup?: number | undefined;
	/**
	 * Disable saving recent searches and favorites to local storage.
	 * @default false
	 */
	disableUserPersonalization?: boolean | undefined;
	/**
	 * Number of recent searches to keep.
	 * @default 7
	 */
	recentSearchesLimit?: number | undefined;
	/**
	 * Delay in milliseconds after the last keystroke before a query is sent.
	 * @default 120
	 */
	debounce?: number | undefined;
	/**
	 * Path to a module whose default export is merged into the options passed to DocSearch. Use
	 * it for options that can’t be serialized, such as `transformItems()` or `hitComponent()`.
	 *
	 * The value can be a path relative to your project root, e.g. `'./src/docsearch.ts'`, or a
	 * package specifier.
	 *
	 * @example
	 * // src/docsearch.ts
	 * import type { DocSearchClientOptions } from 'starlight-docsearch-turbopuffer';
	 *
	 * export default {
	 *   getMissingResultsUrl: ({ query }) => `https://github.com/org/repo/issues/new?title=${query}`,
	 * } satisfies DocSearchClientOptions;
	 */
	clientOptionsModule?: string | undefined;
}
