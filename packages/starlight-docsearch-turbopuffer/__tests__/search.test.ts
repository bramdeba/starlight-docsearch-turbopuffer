import { describe, expect, test } from 'vitest';
import { buildQuery, escapeHtml, fuse, toHit, type ResultRow } from '../src/server/search';
import { resolveRanking } from '../src/shared/options';

const ranking = resolveRanking();

function row(id: string, overrides: Partial<ResultRow> = {}): ResultRow {
	return {
		id,
		url: `/${id}/`,
		page: `/${id}/`,
		anchor: null,
		type: 'lvl1',
		hierarchy: ['Guides', `Page ${id}`],
		content: `Content of ${id}.`,
		...overrides,
	};
}

describe('buildQuery', () => {
	test('runs semantic and keyword search for normal queries', () => {
		const { queries } = buildQuery('install the plugin', ranking) as { queries: any[] };
		expect(queries).toHaveLength(2);
		expect(queries[0].rank_by).toEqual(['semantic_text', 'ANN', ['Embed', 'install the plugin']]);
		expect(queries[0].filters).toEqual(['has_content', 'Eq', true]);
		expect(queries[1].rank_by[0]).toBe('Sum');
		expect(queries[1].limit).toEqual({ total: 20, per: { attributes: ['page'], limit: 5 } });
		// Full-word and prefix clauses for each field.
		expect(queries[1].rank_by[1]).toHaveLength(6);
		expect(queries[1].rank_by[1][1]).toEqual(['Product', 3, ['title', 'BM25', 'install the plugin', { last_as_prefix: true }]]);
	});

	test('applies field boosts', () => {
		const custom = resolveRanking({ boosts: { title: 5 } });
		const { queries } = buildQuery('x y', custom) as { queries: any[] };
		const boosts = queries.at(-1).rank_by[1].map((clause: [string, number]) => clause[1]);
		expect(boosts).toEqual([5, 5, 2, 2, 1, 1]);
	});

	test('skips semantic search for short queries', () => {
		const { queries } = buildQuery('in', ranking) as { queries: any[] };
		expect(queries).toHaveLength(1);
		expect(queries[0].rank_by[0]).toBe('Sum');
	});
});

describe('fuse', () => {
	test('ranks results found by both searches first', () => {
		const result = fuse(
			{
				semantic: [row('a', { $dist: 0.3 }), row('b', { $dist: 0.35 })],
				keyword: [row('b', { $dist: 4 }), row('c', { $dist: 2 })],
			},
			'a query',
			ranking
		);
		expect(result.map((r) => r.id)).toEqual(['b', 'a', 'c']);
	});

	test('drops semantic-only results beyond the absolute distance cut-off', () => {
		const result = fuse(
			{ semantic: [row('a', { $dist: 0.64 }), row('b', { $dist: 0.65 })], keyword: [] },
			'a query',
			ranking
		);
		expect(result).toEqual([]);
	});

	test('drops semantic-only results far from the best match', () => {
		const result = fuse(
			{
				semantic: [row('a', { $dist: 0.35 }), row('b', { $dist: 0.4 }), row('c', { $dist: 0.55 })],
				keyword: [],
			},
			'a query',
			ranking
		);
		expect(result.map((r) => r.id)).toEqual(['a', 'b']);
	});

	test('can disable the distance cut-offs', () => {
		const semantic = [row('a', { $dist: 0.35 }), row('b', { $dist: 0.5 }), row('c', { $dist: 0.9 })];
		const ids = (options: Parameters<typeof resolveRanking>[0]) =>
			fuse({ semantic, keyword: [] }, 'a query', resolveRanking(options)).map((r) => r.id);
		expect(ids({})).toEqual(['a']);
		expect(ids({ relativeDistance: false })).toEqual(['a', 'b']);
		expect(ids({ maxDistance: false })).toEqual(['a']);
		expect(ids({ maxDistance: false, relativeDistance: false })).toEqual(['a', 'b', 'c']);
		expect(ids({ maxDistance: 0.95, relativeDistance: 0.6 })).toEqual(['a', 'b', 'c']);
	});

	test('keeps distant semantic results that also match keywords', () => {
		const result = fuse(
			{ semantic: [row('a', { $dist: 0.3 }), row('b', { $dist: 0.7 })], keyword: [row('b')] },
			'a query',
			ranking
		);
		expect(result.map((r) => r.id)).toEqual(['b', 'a']);
	});

	test('honours weights', () => {
		const semanticHeavy = resolveRanking({ semanticWeight: 3 });
		const result = fuse(
			{ semantic: [row('a', { $dist: 0.3 })], keyword: [row('b')] },
			'a query',
			semanticHeavy
		);
		expect(result.map((r) => r.id)).toEqual(['a', 'b']);
	});

	test('lets keyword matches lead for single-word queries', () => {
		const results = { semantic: [row('a', { $dist: 0.3 })], keyword: [row('b')] };
		const equal = resolveRanking({ semanticWeight: 1.5 });
		expect(fuse(results, 'two words', equal).map((r) => r.id)).toEqual(['a', 'b']);
		expect(fuse(results, 'word', equal).map((r) => r.id)).toEqual(['b', 'a']);
	});

	test('caps results per page and in total', () => {
		const keyword = Array.from({ length: 10 }, (_, i) => row(`s${i}`, { page: '/same/' }));
		expect(fuse({ keyword }, 'q', resolveRanking({ maxResultsPerPage: 3 }))).toHaveLength(3);
		const many = Array.from({ length: 30 }, (_, i) => row(`p${i}`));
		expect(fuse({ keyword: many }, 'q', ranking)).toHaveLength(20);
	});
});

describe('toHit', () => {
	test('maps rows to DocSearch hits with escaped values', () => {
		const hit = toHit(
			row('a', {
				type: 'lvl2',
				anchor: 'usage',
				url: '/a/#usage',
				page: '/a/',
				hierarchy: ['Guides', 'Components', 'Using <Card>'],
				content: 'Render a card with <Card title="x">.',
			}),
			'usage',
			ranking
		);
		expect(hit).toMatchObject({
			objectID: 'a',
			url: '/a/#usage',
			url_without_anchor: '/a/',
			anchor: 'usage',
			type: 'lvl2',
			hierarchy: { lvl0: 'Guides', lvl1: 'Components', lvl2: 'Using &lt;Card&gt;', lvl3: null },
			content: 'Render a card with &lt;Card title=&quot;x&quot;&gt;.',
		});
	});

	test('shows the matching sentence for content matches', () => {
		const content = 'First sentence. The plugin indexes your site after every build.';
		const hit = toHit(
			row('a', {
				type: 'lvl2',
				hierarchy: ['Guides', 'Setup', 'Indexing'],
				content,
				content_hl: [{ text: 'The plugin indexes your site after every build.', fragment_range: [16, 64], match_ranges: [[27, 34]] }],
			}),
			'indexes',
			ranking
		);
		expect(hit.type).toBe('content');
		expect(hit._snippetResult.content!.value).toBe('The plugin <mark>indexes</mark> your site after every build.');
	});

	test('shows the heading when it matches', () => {
		const hit = toHit(
			row('a', {
				type: 'lvl2',
				hierarchy: ['Guides', 'Setup', 'Install'],
				title_hl: [{ text: 'Install', fragment_range: [0, 7], match_ranges: [[0, 7]] }],
				content_hl: [{ text: 'Install it.', fragment_range: [0, 11], match_ranges: [[0, 7]] }],
			}),
			'install',
			ranking
		);
		expect(hit.type).toBe('lvl2');
		expect(hit._snippetResult.hierarchy.lvl2!.value).toBe('<mark>Install</mark>');
	});

	test('crops long fragments around the first match', () => {
		const text = `${'lorem ipsum '.repeat(20)}turbopuffer ${'dolor sit '.repeat(20)}`;
		const start = text.indexOf('turbopuffer');
		const hit = toHit(
			row('a', {
				content: text,
				content_hl: [{ text, fragment_range: [0, text.length], match_ranges: [[start, start + 11]] }],
			}),
			'turbopuffer',
			resolveRanking({ snippetLength: 60 })
		);
		const value = hit._snippetResult.content!.value;
		expect(value).toMatch(/^….*<mark>turbopuffer<\/mark>.*…$/);
		expect(value.replace(/<\/?mark>/g, '').length).toBeLessThanOrEqual(64);
	});

	test('highlights words starting with the last query word', () => {
		const hit = toHit(
			row('a', { type: 'lvl2', hierarchy: ['Guides', 'Setup', 'Installation'], content: 'Run the installer.' }),
			'run instal',
			ranking
		);
		expect(hit.type).toBe('lvl2');
		expect(hit._snippetResult.hierarchy.lvl2!.value).toBe('<mark>Installation</mark>');
		expect(hit._snippetResult.content!.value).toBe('Run the <mark>installer</mark>.');
	});

	test('does not highlight inside words', () => {
		const hit = toHit(row('a', { type: 'lvl2', hierarchy: ['G', 'P', 'Reinstall'], content: 'reinstall' }), 'instal', ranking);
		expect(hit._snippetResult.hierarchy.lvl2!.value).toBe('Reinstall');
	});

	test('falls back to the start of the content without a match', () => {
		const hit = toHit(row('a', { type: 'lvl2', content: 'word '.repeat(100) }), 'other', resolveRanking({ snippetLength: 30 }));
		expect(hit.type).toBe('lvl2');
		expect(hit.content).toMatch(/^word( word)*…$/);
		expect(hit.content!.length).toBeLessThanOrEqual(31);
	});
});

test('escapeHtml', () => {
	expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});
