/**
 * Types shared between the indexer (Node.js, build time), the search handler (any runtime with
 * `fetch`) and the browser adapter. This module must not import anything runtime-specific.
 */

/** DocSearch hierarchy levels. */
export type HierarchyLevel = 'lvl0' | 'lvl1' | 'lvl2' | 'lvl3' | 'lvl4' | 'lvl5' | 'lvl6';

/** The `type` of a record: `lvl1` for a page introduction, `lvl2`–`lvl6` for heading sections. */
export type RecordType = Exclude<HierarchyLevel, 'lvl0'>;

/** A searchable section of a page, as extracted from the built HTML. */
export interface SearchRecord {
	/** Stable identifier (≤ 64 bytes), derived from the page URL, anchor and chunk index. */
	id: string;
	/** Page URL including the anchor, e.g. `/guides/setup/#install`. */
	url: string;
	/** Page URL without the anchor, used to cap results per page. */
	page: string;
	/** Heading anchor, or `null` for the page introduction. */
	anchor: string | null;
	type: RecordType;
	/** `[lvl0, lvl1, …]` — sidebar group, page title, then section headings. */
	hierarchy: string[];
	/** Text of the heading that starts this section (the page title for the introduction). */
	title: string;
	/** Page title. */
	page_title: string;
	/** Plain-text section content. */
	content: string;
	/** Text sent to the embedding model: breadcrumbs + content. */
	semantic_text: string;
	/**
	 * Whether the section has text. Sections without text are left out of semantic search: their
	 * embeddings only capture the breadcrumbs, which sit close to almost any query.
	 */
	has_content: boolean;
	/** Hash of all indexed attributes, used to skip unchanged records when syncing. */
	content_hash: string;
}

/** A DocSearch v5 hit, as rendered by the modal. All string values are HTML-escaped. */
export interface DocSearchHit {
	objectID: string;
	url: string;
	url_without_anchor: string;
	anchor: string | null;
	type: RecordType | 'content';
	content: string | null;
	hierarchy: Record<HierarchyLevel, string | null>;
	_highlightResult: {
		content?: HighlightValue;
		hierarchy: Partial<Record<HierarchyLevel, HighlightValue>>;
	};
	_snippetResult: {
		content?: HighlightValue;
		hierarchy: Partial<Record<HierarchyLevel, HighlightValue>>;
	};
}

export interface HighlightValue {
	value: string;
	matchLevel: 'none' | 'partial' | 'full';
	matchedWords: string[];
}

/** JSON body returned by the search handler. */
export interface SearchResponseBody {
	hits: DocSearchHit[];
	nbHits: number;
	processingTimeMS: number;
}
