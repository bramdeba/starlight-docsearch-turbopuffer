import type { ResolvedSearchRankingOptions } from '../shared/options';
import type {
	DocSearchHit,
	HierarchyLevel,
	HighlightValue,
	RecordType,
} from '../shared/types';

/** A highlighted fragment, as returned by turbopuffer’s `Highlight` computed attribute. */
export interface Fragment {
	text: string;
	fragment_range?: [number, number];
	match_ranges?: [number, number][];
}

/** A row returned by a turbopuffer query, with the attributes this package requests. */
export interface ResultRow {
	id: string | number;
	$dist?: number;
	url: string;
	page: string;
	anchor: string | null;
	type: RecordType;
	hierarchy: string[];
	content: string;
	content_hl?: Fragment[];
	title_hl?: Fragment[];
	page_title_hl?: Fragment[];
}

const INCLUDE_ATTRIBUTES = ['url', 'page', 'anchor', 'type', 'hierarchy', 'content'];

/** Build the body of a turbopuffer multi-query running keyword and (optionally) semantic search. */
export function buildQuery(query: string, options: ResolvedSearchRankingOptions) {
	const { boosts } = options;
	// Prefix matches all score 1, so they only complement full-word BM25 scores for type-ahead.
	// Turbopuffer doesn’t highlight prefix matches; `toHit()` falls back to its own highlighting.
	const fields = [
		['title', boosts.title],
		['page_title', boosts.pageTitle],
		['content', boosts.content],
	] as const;
	const keywordRank = [
		'Sum',
		fields.flatMap(([attribute, boost]) => [
			['Product', boost, [attribute, 'BM25', query]],
			['Product', boost, [attribute, 'BM25', query, { last_as_prefix: true }]],
		]),
	];
	const fragmentRank = ['$fragment', 'BM25', query];
	const highlight = (attribute: string, fragmentBy: string) => [
		'Highlight',
		attribute,
		{ fragment_by: fragmentBy, fragment_limit: 1, include_offsets: 'utf-16', rank_fragments_by: fragmentRank },
	];
	const common = {
		limit: {
			total: options.limit,
			per: { attributes: ['page'], limit: options.maxResultsPerPage },
		},
		include_attributes: INCLUDE_ATTRIBUTES,
		compute_attributes: {
			content_hl: highlight('content', 'sentence'),
			title_hl: highlight('title', 'none'),
			page_title_hl: highlight('page_title', 'none'),
		},
	};

	const queries: object[] = [{ ...common, rank_by: keywordRank }];
	if (query.trim().length >= options.minSemanticQueryLength) {
		queries.unshift({
			...common,
			rank_by: ['semantic_text', 'ANN', ['Embed', query]],
			filters: ['has_content', 'Eq', true],
		});
	}

	return { queries };
}

/**
 * Fuse semantic and keyword results with weighted reciprocal rank fusion. Semantic-only results
 * that are too far from the query are dropped first: vector search always returns its `limit`, so
 * without a cut-off every query would surface the whole namespace.
 */
export function fuse(
	results: { semantic?: ResultRow[] | undefined; keyword: ResultRow[] },
	query: string,
	options: ResolvedSearchRankingOptions
): ResultRow[] {
	const k = options.rankConstant;
	const keywordIds = new Set(results.keyword.map((row) => row.id));
	const scores = new Map<string | number, { row: ResultRow; score: number }>();
	const add = (rows: ResultRow[], weight: number) =>
		rows.forEach((row, index) => {
			const entry = scores.get(row.id) ?? { row, score: 0 };
			entry.score += weight / (k + index + 1);
			scores.set(row.id, entry);
		});

	const semantic = results.semantic ?? [];
	const best = semantic[0]?.$dist ?? Infinity;
	const cutoff = Math.min(
		options.maxDistance === false ? Infinity : options.maxDistance,
		options.relativeDistance === false ? Infinity : best + options.relativeDistance
	);
	const relevantSemantic = semantic.filter(
		(row) => keywordIds.has(row.id) || (row.$dist ?? Infinity) <= cutoff
	);

	// A single word embeds poorly: let keyword matches lead, while still surfacing synonyms.
	const singleWord = query.trim().split(/\s+/).length === 1;
	add(relevantSemantic, options.semanticWeight * (singleWord ? 0.5 : 1));
	add(results.keyword, options.keywordWeight);

	const perPage = new Map<string, number>();
	return [...scores.values()]
		.sort((a, b) => b.score - a.score)
		.map((entry) => entry.row)
		.filter((row) => {
			const count = (perPage.get(row.page) ?? 0) + 1;
			perPage.set(row.page, count);
			return count <= options.maxResultsPerPage;
		})
		.slice(0, options.limit);
}

const LEVELS: HierarchyLevel[] = ['lvl0', 'lvl1', 'lvl2', 'lvl3', 'lvl4', 'lvl5', 'lvl6'];

/** Convert a fused row into the hit shape the DocSearch modal renders. */
export function toHit(
	row: ResultRow,
	query: string,
	options: Pick<ResolvedSearchRankingOptions, 'snippetLength'>
): DocSearchHit {
	const hierarchy = Object.fromEntries(
		LEVELS.map((level, i) => [level, row.hierarchy[i] ? escapeHtml(row.hierarchy[i]!) : null])
	) as DocSearchHit['hierarchy'];
	const terms = queryTerms(query);

	const content = highlightFragment(withMatches(row.content_hl?.[0], row.content, terms), options.snippetLength);
	const contentValue = content ?? plain(escapeHtml(truncate(row.content, options.snippetLength)));
	const title = highlightWhole(withMatches(row.title_hl?.[0], row.hierarchy.at(-1) ?? '', terms));
	const pageTitle = highlightWhole(withMatches(row.page_title_hl?.[0], row.hierarchy[1] ?? '', terms));

	const hierarchyHighlights: Partial<Record<HierarchyLevel, HighlightValue>> = {};
	for (const level of LEVELS) {
		if (hierarchy[level]) hierarchyHighlights[level] = plain(hierarchy[level]!);
	}
	if (pageTitle) hierarchyHighlights.lvl1 = pageTitle;
	if (title && row.type !== 'lvl1') hierarchyHighlights[row.type] = title;

	// Show the matching sentence when the keywords matched the content and not the heading;
	// otherwise show the heading, with the page and parent headings as breadcrumbs.
	const type = content && !title ? 'content' : row.type;

	return {
		objectID: String(row.id),
		url: row.url,
		url_without_anchor: row.page,
		anchor: row.anchor,
		type,
		content: contentValue.value || null,
		hierarchy,
		_highlightResult: { content: contentValue, hierarchy: hierarchyHighlights },
		_snippetResult: { content: contentValue, hierarchy: hierarchyHighlights },
	};
}

/** The last word of the query, which may be incomplete while typing. */
function queryTerms(query: string): string[] {
	const last = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).at(-1);
	return last && last.length >= 2 ? [last] : [];
}

/**
 * Use turbopuffer’s highlighted fragment when it has matches. Otherwise, find words starting with
 * the last query word: turbopuffer doesn’t highlight prefix matches, which are common while typing.
 */
function withMatches(fragment: Fragment | undefined, text: string, terms: string[]): Fragment | undefined {
	if (fragment?.match_ranges?.length) return fragment;
	if (!terms.length || !text) return undefined;
	const pattern = new RegExp(
		`(?<![\\p{L}\\p{N}])(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]*`,
		'giu'
	);
	const match_ranges = [...text.matchAll(pattern)].map((m) => [m.index, m.index + m[0].length] as [number, number]);
	return match_ranges.length ? { text, fragment_range: [0, text.length], match_ranges } : undefined;
}

/** Highlight a fragment, cropped to about `length` characters around the first match. */
function highlightFragment(fragment: Fragment | undefined, length: number): HighlightValue | undefined {
	if (!fragment?.match_ranges?.length) return undefined;
	const offset = fragment.fragment_range?.[0] ?? 0;
	const ranges = fragment.match_ranges.map(([s, e]) => [s - offset, e - offset] as const);
	const { text } = fragment;

	let start = 0;
	let end = text.length;
	if (text.length > length) {
		const first = ranges[0]![0];
		start = Math.max(0, Math.min(first - Math.floor(length / 3), text.length - length));
		end = Math.min(text.length, start + length);
		// Snap to word boundaries.
		if (start > 0) start = text.indexOf(' ', start) + 1 || start;
		if (end < text.length) end = text.lastIndexOf(' ', end) > start ? text.lastIndexOf(' ', end) : end;
	}

	let html = start > 0 ? '…' : '';
	let cursor = start;
	for (const [s, e] of ranges) {
		if (e <= cursor || s >= end) continue;
		html += escapeHtml(text.slice(cursor, Math.max(s, cursor)));
		html += `<mark>${escapeHtml(text.slice(Math.max(s, cursor), Math.min(e, end)))}</mark>`;
		cursor = Math.min(e, end);
	}
	html += escapeHtml(text.slice(cursor, end)) + (end < text.length ? '…' : '');
	return { value: html, matchLevel: 'partial', matchedWords: [] };
}

function highlightWhole(fragment: Fragment | undefined): HighlightValue | undefined {
	if (!fragment?.match_ranges?.length) return undefined;
	return highlightFragment(fragment, Infinity);
}

function plain(value: string): HighlightValue {
	return { value, matchLevel: 'none', matchedWords: [] };
}

function truncate(text: string, length: number): string {
	const line = text.replace(/\s+/g, ' ').trim();
	if (line.length <= length) return line;
	const cut = line.lastIndexOf(' ', length);
	return `${line.slice(0, cut > length / 2 ? cut : length)}…`;
}

export function escapeHtml(text: string): string {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}
