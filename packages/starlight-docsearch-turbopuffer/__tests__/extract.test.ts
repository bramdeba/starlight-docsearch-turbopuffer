import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { chunk, extractRecords } from '../src/indexer/extract';

const html = readFileSync(new URL('./fixtures/page.html', import.meta.url), 'utf8');
const options = {
	url: '/guides/getting-started/',
	contentSelector: '.sl-markdown-content',
	ignoreSelectors: [],
	maxChunkLength: 1500,
};

describe('extractRecords', () => {
	const page = extractRecords(html, options)!;
	const byUrl = (url: string) => page.records.find((record) => record.url === url)!;

	test('reads the page language', () => {
		expect(page.lang).toBe('en');
	});

	test('creates a record for the page introduction', () => {
		const intro = byUrl('/guides/getting-started/');
		expect(intro).toMatchObject({
			type: 'lvl1',
			anchor: null,
			title: 'Getting started',
			page_title: 'Getting started',
			hierarchy: ['Guides', 'Getting started'],
			content: 'Welcome to the docs & guides. This page explains <Card> usage.',
		});
	});

	test('creates a record per heading with its ancestors in the hierarchy', () => {
		expect(byUrl('/guides/getting-started/#install')).toMatchObject({
			type: 'lvl2',
			anchor: 'install',
			hierarchy: ['Guides', 'Getting started', 'Install'],
		});
		expect(byUrl('/guides/getting-started/#node-version')).toMatchObject({
			type: 'lvl4',
			hierarchy: ['Guides', 'Getting started', 'Install', 'Requirements', 'Node version'],
			content: 'Use an LTS release.',
		});
		// A later h2 resets deeper levels.
		expect(byUrl('/guides/getting-started/#configure').hierarchy).toEqual([
			'Guides',
			'Getting started',
			'Configure',
		]);
	});

	test('keeps code block lines and drops UI chrome', () => {
		const install = byUrl('/guides/getting-started/#install');
		expect(install.content).toBe(
			'Run the following command:\npnpm add starlight-docsearch-turbopuffer\npnpm build'
		);
		expect(page.records.map((record) => record.content).join(' ')).not.toMatch(
			/Section titled|Terminal window|Copy/
		);
	});

	test('treats headings without an id as content', () => {
		expect(byUrl('/guides/getting-started/#configure').content).toBe(
			'Option Default\nnamespace none\nHeading without id\nStill part of configure.'
		);
	});

	test('keeps sections without text so their headings stay searchable', () => {
		expect(byUrl('/guides/getting-started/#empty')).toMatchObject({
			content: '',
			title: 'Empty section',
			has_content: false,
		});
		expect(byUrl('/guides/getting-started/#install').has_content).toBe(true);
	});

	test('includes breadcrumbs in the text sent to the embedding model', () => {
		expect(byUrl('/guides/getting-started/#requirements').semantic_text).toBe(
			'Getting started › Install › Requirements\n\nNode.js 22\nAn Astro adapter'
		);
	});

	test('produces stable IDs within turbopuffer’s 64 byte limit', () => {
		const again = extractRecords(html, options)!;
		expect(again.records.map((r) => r.id)).toEqual(page.records.map((r) => r.id));
		expect(new Set(page.records.map((r) => r.id)).size).toBe(page.records.length);
		for (const record of page.records) expect(record.id.length).toBeLessThanOrEqual(64);
	});

	test('changes the content hash only when the record changes', () => {
		const changed = extractRecords(html.replace('Use an LTS release.', 'Use Node 24.'), options)!;
		const hashes = (records: typeof page.records) => records.map((r) => r.content_hash);
		const diff = hashes(changed.records).filter((h, i) => h !== hashes(page.records)[i]);
		expect(diff).toHaveLength(1);
	});

	test('honours ignore selectors', () => {
		const ignored = extractRecords(html, { ...options, ignoreSelectors: ['table'] })!;
		expect(ignored.records.find((r) => r.anchor === 'configure')!.content).not.toContain('namespace');
	});

	test('skips pages excluded from search', () => {
		expect(extractRecords(html.replace('data-pagefind-body', ''), options)).toBeNull();
	});

	test('falls back to the page title for lvl0', () => {
		const noGroup = extractRecords(html.replace(' data-lvl0="Guides"', ''), options)!;
		expect(noGroup.records[0]!.hierarchy[0]).toBe('Getting started');
	});

	test('splits long sections into chunks sharing the same URL', () => {
		const long = html.replace('Use an LTS release.', 'Sentence one is here. '.repeat(30));
		const chunked = extractRecords(long, { ...options, maxChunkLength: 200 })!;
		const parts = chunked.records.filter((r) => r.anchor === 'node-version');
		expect(parts.length).toBeGreaterThan(1);
		expect(new Set(parts.map((r) => r.url))).toEqual(new Set(['/guides/getting-started/#node-version']));
		for (const part of parts) expect(part.content.length).toBeLessThanOrEqual(200);
	});
});

describe('chunk', () => {
	test('returns short text unchanged', () => {
		expect(chunk('short', 100)).toEqual(['short']);
	});

	test('prefers paragraph breaks', () => {
		expect(chunk('aaaa\nbbbb\ncccc', 10)).toEqual(['aaaa\nbbbb', 'cccc']);
	});

	test('hard-splits text without breaks', () => {
		expect(chunk('x'.repeat(25), 10)).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)]);
	});
});
