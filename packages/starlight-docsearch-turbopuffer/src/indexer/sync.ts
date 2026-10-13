import Turbopuffer from '@turbopuffer/turbopuffer';
import type { SearchRecord } from '../shared/types';

/** Turbopuffer accepts at most 256 rows per write when rows are embedded server-side. */
const UPSERT_BATCH_SIZE = 256;
const DELETE_BATCH_SIZE = 5000;
const LIST_PAGE_SIZE = 10_000;

export interface IndexSettings {
	embedding: { model: string; dimensions?: number | undefined };
	distanceMetric: 'cosine_distance' | 'euclidean_squared';
	fullTextSearch: {
		language: string | undefined;
		stemming: boolean;
		removeStopwords: boolean;
		asciiFolding: boolean;
		tokenizer: string;
		k1?: number | undefined;
		b?: number | undefined;
	};
}

export interface SyncOptions {
	client: Turbopuffer;
	namespace: string;
	records: SearchRecord[];
	settings: IndexSettings;
	/** Delete the namespace and index everything from scratch. */
	reset?: boolean | undefined;
	/** Compute the changes without writing them. */
	dryRun?: boolean | undefined;
	concurrency?: number | undefined;
	log?: ((message: string) => void) | undefined;
}

export interface SyncResult {
	namespace: string;
	upserted: number;
	deleted: number;
	unchanged: number;
	embeddingTokens: number;
}

/** Turbopuffer schema for search records. */
export function schemaFor(settings: IndexSettings) {
	const { fullTextSearch: fts } = settings;
	const fullTextSearch = {
		tokenizer: fts.tokenizer,
		case_sensitive: false,
		// Turbopuffer rejects stemming and stopwords for languages it doesn’t support.
		...(fts.language
			? { language: fts.language, stemming: fts.stemming, remove_stopwords: fts.removeStopwords }
			: { stemming: false, remove_stopwords: false }),
		ascii_folding: fts.asciiFolding,
		...(fts.k1 !== undefined && { k1: fts.k1 }),
		...(fts.b !== undefined && { b: fts.b }),
	};
	const stored = { type: 'string', filterable: false } as const;
	return {
		url: stored,
		anchor: stored,
		type: stored,
		hierarchy: { type: '[]string', filterable: false },
		content_hash: stored,
		page: { type: 'string', filterable: true },
		has_content: { type: 'bool', filterable: true },
		title: { type: 'string', full_text_search: fullTextSearch },
		page_title: { type: 'string', full_text_search: fullTextSearch },
		content: { type: 'string', full_text_search: fullTextSearch },
		semantic_text: {
			type: 'string',
			filterable: false,
			embed: {
				model: settings.embedding.model,
				...(settings.embedding.dimensions && { dims: settings.embedding.dimensions }),
			},
		},
	};
}

/**
 * Bring a namespace in line with the given records: upsert new and changed records, delete
 * records that no longer exist, and leave unchanged records alone so they aren’t re-embedded.
 */
export async function syncNamespace(options: SyncOptions): Promise<SyncResult> {
	const { client, namespace, records, settings, log = () => {} } = options;
	const ns = client.namespace(namespace);

	if (options.reset && !options.dryRun) {
		await ns.deleteAll().catch(ignoreNotFound);
		log(`Deleted namespace ${namespace}.`);
	}

	const existing = options.reset ? new Map<string, string>() : await listHashes(ns);
	const wanted = new Map(records.map((record) => [record.id, record]));
	const upserts = records.filter((record) => existing.get(record.id) !== record.content_hash);
	const deletes = [...existing.keys()].filter((id) => !wanted.has(id));
	const result: SyncResult = {
		namespace,
		upserted: upserts.length,
		deleted: deletes.length,
		unchanged: records.length - upserts.length,
		embeddingTokens: 0,
	};

	if (options.dryRun || (!upserts.length && !deletes.length)) return result;

	const schema = schemaFor(settings);
	const batches = chunks(upserts, UPSERT_BATCH_SIZE);
	let done = 0;
	await runConcurrently(batches, options.concurrency ?? 4, async (batch) => {
		try {
			const response = await ns.write({
				upsert_rows: batch as unknown as Turbopuffer.Row[],
				schema: schema as never,
				distance_metric: settings.distanceMetric,
			});
			result.embeddingTokens += response.performance?.embedding_tokens ?? 0;
		} catch (error) {
			throw explainWriteError(error, namespace);
		}
		done += batch.length;
		log(`${namespace}: upserted ${done}/${upserts.length} records.`);
	});

	for (const batch of chunks(deletes, DELETE_BATCH_SIZE)) {
		await ns.write({ deletes: batch });
	}
	if (deletes.length) log(`${namespace}: deleted ${deletes.length} stale records.`);

	return result;
}

/** Fetch the `content_hash` of every record in a namespace, paginating by ID. */
async function listHashes(ns: ReturnType<Turbopuffer['namespace']>): Promise<Map<string, string>> {
	const hashes = new Map<string, string>();
	let after: string | undefined;
	while (true) {
		let rows: { id: string | number; content_hash?: unknown }[];
		try {
			const response = await ns.query({
				rank_by: ['id', 'asc'],
				limit: LIST_PAGE_SIZE,
				include_attributes: ['content_hash'],
				...(after !== undefined && { filters: ['id', 'Gt', after] }),
			});
			rows = response.rows ?? [];
		} catch (error) {
			if (isNotFound(error)) return hashes;
			throw error;
		}
		for (const row of rows) hashes.set(String(row.id), String(row.content_hash ?? ''));
		if (rows.length < LIST_PAGE_SIZE) return hashes;
		after = String(rows.at(-1)!.id);
	}
}

function explainWriteError(error: unknown, namespace: string): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (/embed|dimension|distance_metric|schema/i.test(message)) {
		return new Error(
			`Turbopuffer rejected the write to "${namespace}": ${message}\n` +
				'If you changed the embedding model, dimensions, distance metric or schema, re-index from scratch with `starlight-docsearch-turbopuffer sync --reset`.',
			{ cause: error }
		);
	}
	return error instanceof Error ? error : new Error(message);
}

function isNotFound(error: unknown): boolean {
	return (error as { status?: number })?.status === 404;
}

function ignoreNotFound(error: unknown): void {
	if (!isNotFound(error)) throw error;
}

function chunks<T>(items: T[], size: number): T[][] {
	const result: T[][] = [];
	for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
	return result;
}

async function runConcurrently<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
	const queue = [...items];
	await Promise.all(
		Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
			while (queue.length) await task(queue.shift()!);
		})
	);
}
