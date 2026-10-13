import { describe, expect, test, vi } from 'vitest';
import { schemaFor, syncNamespace, type IndexSettings } from '../src/indexer/sync';
import type { SearchRecord } from '../src/shared/types';

const settings: IndexSettings = {
	embedding: { model: 'baai/bge-m3' },
	distanceMetric: 'cosine_distance',
	fullTextSearch: {
		language: 'english',
		stemming: true,
		removeStopwords: true,
		asciiFolding: true,
		tokenizer: 'word_v4',
	},
};

const record = (id: string, hash = `hash-${id}`): SearchRecord => ({
	id,
	url: `/${id}/`,
	page: `/${id}/`,
	anchor: null,
	type: 'lvl1',
	hierarchy: ['Guides', id],
	title: id,
	page_title: id,
	content: '',
	semantic_text: id,
	has_content: false,
	content_hash: hash,
});

/** A fake turbopuffer client holding one namespace in memory. */
function fakeClient(existing: SearchRecord[] | null) {
	let rows = existing ? new Map(existing.map((r) => [r.id, r])) : null;
	const writes: any[] = [];
	const ns = {
		query: vi.fn(async ({ filters }: { filters?: [string, string, string] }) => {
			if (!rows) throw Object.assign(new Error('not found'), { status: 404 });
			const after = filters?.[2];
			return {
				rows: [...rows.values()]
					.filter((r) => after === undefined || r.id > after)
					.sort((a, b) => a.id.localeCompare(b.id))
					.map((r) => ({ id: r.id, content_hash: r.content_hash })),
			};
		}),
		write: vi.fn(async (params: any) => {
			writes.push(params);
			rows ??= new Map();
			for (const row of params.upsert_rows ?? []) rows.set(row.id, row);
			for (const id of params.deletes ?? []) rows.delete(id);
			return { performance: { embedding_tokens: (params.upsert_rows?.length ?? 0) * 10 } };
		}),
		deleteAll: vi.fn(async () => {
			rows = null;
		}),
	};
	return { client: { namespace: () => ns } as any, ns, writes };
}

describe('syncNamespace', () => {
	test('indexes everything into a new namespace', async () => {
		const { client, writes } = fakeClient(null);
		const result = await syncNamespace({ client, namespace: 'docs', records: [record('a'), record('b')], settings });
		expect(result).toEqual({ namespace: 'docs', upserted: 2, deleted: 0, unchanged: 0, embeddingTokens: 20 });
		expect(writes[0].schema.semantic_text.embed).toEqual({ model: 'baai/bge-m3' });
		expect(writes[0].distance_metric).toBe('cosine_distance');
	});

	test('only writes changed records and deletes removed ones', async () => {
		const { client, writes } = fakeClient([record('a'), record('b'), record('old')]);
		const result = await syncNamespace({
			client,
			namespace: 'docs',
			records: [record('a'), record('b', 'changed'), record('new')],
			settings,
		});
		expect(result).toMatchObject({ upserted: 2, deleted: 1, unchanged: 1 });
		expect(writes[0].upsert_rows.map((r: SearchRecord) => r.id)).toEqual(['b', 'new']);
		expect(writes[1].deletes).toEqual(['old']);
	});

	test('does nothing when nothing changed', async () => {
		const { client, writes } = fakeClient([record('a')]);
		const result = await syncNamespace({ client, namespace: 'docs', records: [record('a')], settings });
		expect(result).toMatchObject({ upserted: 0, deleted: 0, unchanged: 1 });
		expect(writes).toEqual([]);
	});

	test('batches upserts to 256 rows', async () => {
		const { client, writes } = fakeClient(null);
		const records = Array.from({ length: 600 }, (_, i) => record(`r${String(i).padStart(3, '0')}`));
		await syncNamespace({ client, namespace: 'docs', records, settings, concurrency: 2 });
		expect(writes.map((w) => w.upsert_rows.length).sort()).toEqual([256, 256, 88]);
	});

	test('re-indexes everything on reset', async () => {
		const { client, ns } = fakeClient([record('a')]);
		const result = await syncNamespace({ client, namespace: 'docs', records: [record('a')], settings, reset: true });
		expect(ns.deleteAll).toHaveBeenCalled();
		expect(result.upserted).toBe(1);
	});

	test('dry runs do not write', async () => {
		const { client, ns } = fakeClient([record('a')]);
		const result = await syncNamespace({ client, namespace: 'docs', records: [record('b')], settings, dryRun: true });
		expect(result).toMatchObject({ upserted: 1, deleted: 1 });
		expect(ns.write).not.toHaveBeenCalled();
	});

	test('explains schema errors', async () => {
		const { client, ns } = fakeClient(null);
		ns.write.mockRejectedValueOnce(new Error('cannot modify embed config'));
		await expect(
			syncNamespace({ client, namespace: 'docs', records: [record('a')], settings })
		).rejects.toThrow(/--reset/);
	});
});

describe('schemaFor', () => {
	test('configures full-text search and embeddings', () => {
		const schema = schemaFor({ ...settings, embedding: { model: 'voyage/voyage-4-lite', dimensions: 512 } });
		expect(schema.content.full_text_search).toEqual({
			tokenizer: 'word_v4',
			case_sensitive: false,
			language: 'english',
			stemming: true,
			remove_stopwords: true,
			ascii_folding: true,
		});
		expect(schema.semantic_text.embed).toEqual({ model: 'voyage/voyage-4-lite', dims: 512 });
	});

	test('disables stemming for unsupported languages', () => {
		const schema = schemaFor({ ...settings, fullTextSearch: { ...settings.fullTextSearch, language: undefined } });
		expect(schema.title.full_text_search).toMatchObject({ stemming: false, remove_stopwords: false });
		expect(schema.title.full_text_search).not.toHaveProperty('language');
	});
});
