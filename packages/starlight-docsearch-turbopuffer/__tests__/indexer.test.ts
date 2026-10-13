import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { buildManifest, globToRegExp, pathFor } from '../src/indexer';

const dir = fileURLToPath(new URL('./fixtures/dist/', import.meta.url));
const options = {
	dir,
	base: '/',
	trailingSlash: 'ignore' as const,
	namespace: 'docs-{lang}',
	region: 'gcp-europe-west1',
	embedding: { model: 'baai/bge-m3' },
	distanceMetric: 'cosine_distance' as const,
	fullTextSearch: { stemming: true, removeStopwords: true, asciiFolding: true, tokenizer: 'word_v4' },
	contentSelector: '.sl-markdown-content',
	ignoreSelectors: [],
	exclude: [],
	maxChunkLength: 1500,
	concurrency: 4,
};

describe('buildManifest', () => {
	test('groups records into a namespace per language', async () => {
		const manifest = await buildManifest(options);
		expect(Object.keys(manifest.namespaces).sort()).toEqual(['docs-en', 'docs-fr']);
		expect(manifest.namespaces['docs-fr']!.settings.fullTextSearch.language).toBe('french');
		expect(manifest.namespaces['docs-en']!.records[0]!.page).toBe('/guides/getting-started/');
		expect(manifest.namespaces['docs-fr']!.records.find((r) => r.type === 'lvl1')!.url).toBe(
			'/fr/guides/getting-started/'
		);
	});

	test('skips pages without searchable content', async () => {
		const manifest = await buildManifest(options);
		const urls = Object.values(manifest.namespaces).flatMap((n) => n.records.map((r) => r.page));
		expect(urls).not.toContain('/404/');
	});

	test('prefixes URLs with the base path', async () => {
		const manifest = await buildManifest({ ...options, base: '/docs/' });
		expect(manifest.namespaces['docs-en']!.records[0]!.page).toBe('/docs/guides/getting-started/');
	});

	test('excludes pages by pattern', async () => {
		const manifest = await buildManifest({ ...options, exclude: ['/fr/**'] });
		expect(Object.keys(manifest.namespaces)).toEqual(['docs-en']);
	});

	test('applies configured full-text languages', async () => {
		const manifest = await buildManifest({
			...options,
			fullTextSearch: { ...options.fullTextSearch, language: { fr: 'english' } },
		});
		expect(manifest.namespaces['docs-fr']!.settings.fullTextSearch.language).toBe('english');
		expect(manifest.namespaces['docs-en']!.settings.fullTextSearch.language).toBe('english');
	});
});

describe('pathFor', () => {
	test('maps built files to URL paths', () => {
		expect(pathFor('index.html', 'ignore')).toBe('/');
		expect(pathFor('guides/setup/index.html', 'ignore')).toBe('/guides/setup/');
		expect(pathFor('guides/setup.html', 'ignore')).toBe('/guides/setup');
		expect(pathFor('guides/setup/index.html', 'never')).toBe('/guides/setup');
		expect(pathFor('index.html', 'never')).toBe('/');
	});
});

describe('globToRegExp', () => {
	test('matches within and across segments', () => {
		expect(globToRegExp('/blog/*').test('/blog/post')).toBe(true);
		expect(globToRegExp('/blog/*').test('/blog/a/b')).toBe(false);
		expect(globToRegExp('/blog/**').test('/blog/a/b/')).toBe(true);
		expect(globToRegExp('/v1.0/**').test('/v1x0/a')).toBe(false);
	});
});
