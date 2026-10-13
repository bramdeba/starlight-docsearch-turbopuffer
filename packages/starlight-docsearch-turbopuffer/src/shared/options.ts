/**
 * Runtime-agnostic search options and helpers, shared by the plugin, the indexer and the search
 * handler. Kept free of `zod`/`astro` imports so the handler stays small on edge runtimes.
 */

export interface SearchRankingOptions {
	/**
	 * Maximum number of results returned for a query.
	 * @default 20
	 */
	limit?: number | undefined;
	/**
	 * Maximum number of results from the same page.
	 * @default 5
	 */
	maxResultsPerPage?: number | undefined;
	/**
	 * Weight of the semantic (vector) results in reciprocal rank fusion.
	 * @default 1
	 */
	semanticWeight?: number | undefined;
	/**
	 * Weight of the keyword (BM25) results in reciprocal rank fusion.
	 * @default 1
	 */
	keywordWeight?: number | undefined;
	/**
	 * Reciprocal rank fusion constant `k`. Lower values favour top-ranked results more strongly.
	 * @default 60
	 */
	rankConstant?: number | undefined;
	/** BM25 multipliers per field. */
	boosts?:
		| {
				/**
				 * Section heading.
				 * @default 3
				 */
				title?: number | undefined;
				/**
				 * Page title.
				 * @default 2
				 */
				pageTitle?: number | undefined;
				/**
				 * Section content.
				 * @default 1
				 */
				content?: number | undefined;
		  }
		| undefined;
	/**
	 * Distance cut-off: semantic results with a vector distance above this value are dropped
	 * unless they also match keywords. The right value depends on the embedding model and distance
	 * metric: the default is tuned for `baai/bge-m3` with cosine distance. Set to `false` to keep
	 * semantic results regardless of distance.
	 * @default 0.55
	 */
	maxDistance?: number | false | undefined;
	/**
	 * Relative distance cut-off: semantic results further than this from the best semantic result
	 * are dropped unless they also match keywords. Keeps the long tail of loosely related sections
	 * out of the results. Set to `false` to disable.
	 * @default 0.12
	 */
	relativeDistance?: number | false | undefined;
	/**
	 * Queries shorter than this (in characters) only use keyword search. Very short queries embed
	 * poorly and are usually the first keystrokes of a longer query.
	 * @default 3
	 */
	minSemanticQueryLength?: number | undefined;
	/**
	 * Approximate length of the content snippet shown for a result, in characters.
	 * @default 140
	 */
	snippetLength?: number | undefined;
}

export type ResolvedSearchRankingOptions = {
	[K in keyof Omit<SearchRankingOptions, 'boosts'>]-?: NonNullable<SearchRankingOptions[K]>;
} & { boosts: { title: number; pageTitle: number; content: number } };

export const DEFAULT_RANKING: ResolvedSearchRankingOptions = {
	limit: 20,
	maxResultsPerPage: 5,
	semanticWeight: 1,
	keywordWeight: 1,
	rankConstant: 60,
	boosts: { title: 3, pageTitle: 2, content: 1 },
	maxDistance: 0.55,
	relativeDistance: 0.12,
	minSemanticQueryLength: 3,
	snippetLength: 140,
};

export function resolveRanking(options: SearchRankingOptions = {}): ResolvedSearchRankingOptions {
	const defined = <T extends object>(o: T | undefined) =>
		Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
	return {
		...DEFAULT_RANKING,
		...defined(options),
		boosts: { ...DEFAULT_RANKING.boosts, ...defined(options.boosts) },
	} as ResolvedSearchRankingOptions;
}

export const LANG_PLACEHOLDER = '{lang}';

/** Characters turbopuffer allows in namespace names. */
const NAMESPACE_RE = /^[A-Za-z0-9\-_.]{1,128}$/;

/** Resolve the namespace for a language from a template such as `my-docs-{lang}`. */
export function namespaceFor(template: string, lang: string): string {
	const namespace = template.replaceAll(LANG_PLACEHOLDER, lang.toLowerCase());
	if (!NAMESPACE_RE.test(namespace)) {
		throw new Error(
			`Invalid turbopuffer namespace "${namespace}". Namespaces may only contain letters, numbers, "-", "_" and ".", and be at most 128 characters long.`
		);
	}
	return namespace;
}

/** Languages supported by turbopuffer full-text search, keyed by BCP-47 primary language subtag. */
const FTS_LANGUAGES: Record<string, string> = {
	ar: 'arabic',
	da: 'danish',
	de: 'german',
	el: 'greek',
	en: 'english',
	es: 'spanish',
	fi: 'finnish',
	fr: 'french',
	hu: 'hungarian',
	it: 'italian',
	nb: 'norwegian',
	nl: 'dutch',
	nn: 'norwegian',
	no: 'norwegian',
	pt: 'portuguese',
	ro: 'romanian',
	ru: 'russian',
	sv: 'swedish',
	ta: 'tamil',
	tr: 'turkish',
};

/** Languages for which turbopuffer does not support stopword removal. */
const NO_STOPWORDS = new Set(['arabic', 'greek', 'romanian', 'tamil', 'turkish']);

/**
 * Map a BCP-47 language tag to a turbopuffer full-text search language. Returns `undefined` for
 * languages turbopuffer does not support, in which case stemming and stopwords are disabled.
 */
export function ftsLanguageFor(lang: string): string | undefined {
	return FTS_LANGUAGES[lang.toLowerCase().split('-')[0]!];
}

export function supportsStopwords(language: string | undefined): boolean {
	return language !== undefined && !NO_STOPWORDS.has(language);
}

export function baseURLFor(options: { region?: string | undefined; baseURL?: string | undefined }) {
	if (options.baseURL) return options.baseURL.replace(/\/+$/, '');
	if (options.region) return `https://${options.region}.turbopuffer.com`;
	throw new Error('Either `region` or `baseURL` must be set to reach turbopuffer.');
}
