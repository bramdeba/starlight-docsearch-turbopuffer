import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import Turbopuffer from '@turbopuffer/turbopuffer';
import { ftsLanguageFor, namespaceFor, supportsStopwords } from '../shared/options';
import type { SearchRecord } from '../shared/types';
import { extractRecords } from './extract';
import { syncNamespace, type IndexSettings, type SyncResult } from './sync';

export { extractRecords } from './extract';
export { syncNamespace, schemaFor } from './sync';

/** Everything needed to sync a build to turbopuffer, written after each `astro build`. */
export interface Manifest {
	version: 1;
	createdAt: string;
	region?: string | undefined;
	baseURL?: string | undefined;
	concurrency: number;
	namespaces: Record<string, { lang: string; settings: IndexSettings; records: SearchRecord[] }>;
}

export interface BuildManifestOptions {
	/** Directory containing the built HTML files. */
	dir: string;
	/** Astro `base`, e.g. `/docs`. */
	base: string;
	trailingSlash: 'always' | 'never' | 'ignore';
	namespace: string;
	region?: string | undefined;
	baseURL?: string | undefined;
	embedding: IndexSettings['embedding'];
	distanceMetric: IndexSettings['distanceMetric'];
	fullTextSearch: Omit<IndexSettings['fullTextSearch'], 'language'> & {
		language?: string | Record<string, string> | undefined;
	};
	contentSelector: string;
	ignoreSelectors: string[];
	exclude: string[];
	maxChunkLength: number;
	concurrency: number;
}

/** Extract search records from every HTML page in a build directory, grouped by namespace. */
export async function buildManifest(options: BuildManifestOptions): Promise<Manifest> {
	const exclude = options.exclude.map(globToRegExp);
	const base = `/${options.base.replace(/^\/+|\/+$/g, '')}`.replace(/^\/$/, '');
	const manifest: Manifest = {
		version: 1,
		createdAt: new Date().toISOString(),
		region: options.region,
		baseURL: options.baseURL,
		concurrency: options.concurrency,
		namespaces: {},
	};

	for (const file of await findHtmlFiles(options.dir)) {
		const path = pathFor(relative(options.dir, file), options.trailingSlash);
		if (exclude.some((re) => re.test(path) || re.test(path.replace(/\/$/, '')))) continue;

		const page = extractRecords(await readFile(file, 'utf8'), {
			url: base + path,
			contentSelector: options.contentSelector,
			ignoreSelectors: options.ignoreSelectors,
			maxChunkLength: options.maxChunkLength,
		});
		if (!page) continue;

		const namespace = namespaceFor(options.namespace, page.lang);
		manifest.namespaces[namespace] ??= {
			lang: page.lang,
			settings: settingsFor(page.lang, options),
			records: [],
		};
		manifest.namespaces[namespace].records.push(...page.records);
	}

	for (const entry of Object.values(manifest.namespaces)) {
		entry.records.sort((a, b) => a.id.localeCompare(b.id));
	}
	return manifest;
}

function settingsFor(lang: string, options: BuildManifestOptions): IndexSettings {
	const { language, ...fts } = options.fullTextSearch;
	const configured =
		typeof language === 'string' ? language : (language?.[lang] ?? language?.[lang.toLowerCase()]);
	const resolved = configured ?? ftsLanguageFor(lang);
	return {
		embedding: options.embedding,
		distanceMetric: options.distanceMetric,
		fullTextSearch: {
			...fts,
			language: resolved,
			removeStopwords: fts.removeStopwords && supportsStopwords(resolved),
		},
	};
}

export interface SyncManifestOptions {
	apiKey: string;
	region?: string | undefined;
	baseURL?: string | undefined;
	reset?: boolean | undefined;
	dryRun?: boolean | undefined;
	log?: ((message: string) => void) | undefined;
}

/** Sync every namespace in a manifest to turbopuffer. */
export async function syncManifest(manifest: Manifest, options: SyncManifestOptions): Promise<SyncResult[]> {
	const region = options.region ?? manifest.region;
	const baseURL = options.baseURL ?? manifest.baseURL;
	if (!region && !baseURL) {
		throw new Error('Set the `region` option or the TURBOPUFFER_REGION environment variable.');
	}
	const client = new Turbopuffer({
		apiKey: options.apiKey,
		...(baseURL ? { baseURL } : { region }),
	});
	const results: SyncResult[] = [];
	for (const [namespace, entry] of Object.entries(manifest.namespaces)) {
		results.push(
			await syncNamespace({
				client,
				namespace,
				records: entry.records,
				settings: entry.settings,
				reset: options.reset,
				dryRun: options.dryRun,
				concurrency: manifest.concurrency,
				log: options.log,
			})
		);
	}
	return results;
}

export async function writeManifest(path: string, manifest: Manifest): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, JSON.stringify(manifest));
}

export async function readManifest(path: string): Promise<Manifest> {
	const manifest = JSON.parse(await readFile(path, 'utf8')) as Manifest;
	if (manifest.version !== 1) throw new Error(`Unsupported manifest version in ${path}.`);
	return manifest;
}

export function formatResult(result: SyncResult): string {
	const tokens = result.embeddingTokens ? `, ${result.embeddingTokens} embedding tokens` : '';
	return `${result.namespace}: ${result.upserted} upserted, ${result.deleted} deleted, ${result.unchanged} unchanged${tokens}`;
}

async function findHtmlFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

/** URL path for a built file, e.g. `guides/setup/index.html` → `/guides/setup/`. */
export function pathFor(file: string, trailingSlash: BuildManifestOptions['trailingSlash']): string {
	const parts = file.split(sep).join('/');
	let path = `/${parts}`.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '');
	if (trailingSlash === 'never' && path !== '/') path = path.replace(/\/$/, '');
	return path;
}

/** Convert a URL path pattern to a regular expression: `*` matches within a segment, `**` across. */
export function globToRegExp(pattern: string): RegExp {
	const source = pattern
		.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '\u0000')
		.replace(/\*/g, '[^/]*')
		.replace(/\u0000/g, '.*');
	return new RegExp(`^${source}$`);
}
