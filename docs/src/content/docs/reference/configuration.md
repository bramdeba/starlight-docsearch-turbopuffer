---
title: Configuration
description: All options of the starlight-docsearch-turbopuffer plugin.
tableOfContents:
  maxHeadingLevel: 4
---

```js title="astro.config.mjs"
starlightDocSearchTurbopuffer({
	namespace: 'my-docs-{lang}',
	region: 'gcp-europe-west1',
	embedding: { model: 'baai/bge-m3' },
	search: { keywordWeight: 1.5 },
	indexing: { exclude: ['/blog/**'] },
});
```

## Connection

### `namespace`

**Type:** `string` — **required**

The turbopuffer namespace to index into and search. On multilingual sites, include a `{lang}` placeholder, e.g. `my-docs-{lang}`. Namespace names may contain letters, numbers, `-`, `_` and `.`.

### `region`

**Type:** `string` — **default:** the `TURBOPUFFER_REGION` environment variable

The [turbopuffer region](https://turbopuffer.com/docs/regions) of your namespaces, e.g. `gcp-europe-west1` or `aws-us-east-1`.

### `baseURL`

**Type:** `string`

A custom turbopuffer API URL. Takes precedence over `region`.

### `endpoint`

**Type:** `string` — **default:** `/api/search` under your `base`

The URL the browser sends search queries to. Set it when you [deploy the search handler separately](/guides/deployment/#as-a-standalone-function). When unset, the plugin adds the route to your site.

## Index

Changing these options requires [re-indexing](/guides/indexing/#changing-the-embedding-model).

### `embedding.model`

**Type:** `string` — **default:** `'baai/bge-m3'`

The [turbopuffer embedding model](https://turbopuffer.com/docs/embedding) used for semantic search, e.g. `voyage/voyage-4-lite` or `openai/text-embedding-3-small`.

### `embedding.dimensions`

**Type:** `number` — **default:** the model’s default

The number of vector dimensions, for models that support several.

### `distanceMetric`

**Type:** `'cosine_distance' | 'euclidean_squared'` — **default:** `'cosine_distance'`

### `fullTextSearch`

Settings for the keyword (BM25) index.

#### `fullTextSearch.language`

**Type:** `string | Record<string, string>` — **default:** derived from each locale

The turbopuffer full-text search language, or a map from language tag to language.

#### `fullTextSearch.stemming`

**Type:** `boolean` — **default:** `true`

Match words by their stem, so `installing` matches `install`.

#### `fullTextSearch.removeStopwords`

**Type:** `boolean` — **default:** `true`

Ignore common words such as `the` and `how`.

#### `fullTextSearch.asciiFolding`

**Type:** `boolean` — **default:** `true`

Ignore diacritics, so `cafe` matches `café`.

#### `fullTextSearch.tokenizer`

**Type:** `string` — **default:** `'word_v4'`

The turbopuffer tokenizer. It is pinned so turbopuffer upgrades don’t change ranking unexpectedly.

#### `fullTextSearch.k1` and `fullTextSearch.b`

**Type:** `number`

BM25 parameters. Defaults to turbopuffer’s (`1.2` and `0.75`).

## Indexing

### `indexing.enabled`

**Type:** `boolean | 'auto'` — **default:** `'auto'`

Whether to sync to turbopuffer after `astro build`. `'auto'` syncs when `TURBOPUFFER_API_KEY` is set.

### `indexing.contentSelector`

**Type:** `string` — **default:** `'.sl-markdown-content'`

The element containing each page’s content.

### `indexing.ignoreSelectors`

**Type:** `string[]` — **default:** `[]`

CSS selectors for elements to leave out of the index.

### `indexing.exclude`

**Type:** `string[]` — **default:** `[]`

Pages to leave out of the index, as URL path patterns relative to your `base`. `*` matches within a path segment and `**` across segments.

### `indexing.maxChunkLength`

**Type:** `number` — **default:** `1500`

Maximum length of a record’s text in characters. Longer sections are split at paragraph and sentence boundaries.

### `indexing.concurrency`

**Type:** `number` — **default:** `4`

Number of concurrent write requests to turbopuffer.

## Search

See [Tuning relevance](/guides/tuning/).

| Option | Default | Description |
| --- | --- | --- |
| `search.limit` | `20` | Maximum number of results. |
| `search.maxResultsPerPage` | `5` | Maximum results from one page. |
| `search.semanticWeight` | `1` | Weight of semantic results in rank fusion. |
| `search.keywordWeight` | `1` | Weight of keyword results in rank fusion. |
| `search.rankConstant` | `60` | Reciprocal rank fusion constant `k`. |
| `search.boosts.title` | `3` | Keyword boost for section headings. |
| `search.boosts.pageTitle` | `2` | Keyword boost for page titles. |
| `search.boosts.content` | `1` | Keyword boost for section content. |
| `search.maxDistance` | `0.55` | [Distance cut-off](/guides/tuning/#distance-cut-off) for semantic-only results, or `false`. |
| `search.relativeDistance` | `0.12` | Maximum distance from the best semantic result, or `false`. |
| `search.minSemanticQueryLength` | `3` | Shorter queries use keyword search only. |
| `search.snippetLength` | `140` | Approximate snippet length in characters. |

## Modal

### `maxResultsPerGroup`

**Type:** `number` — **default:** `5`

The maximum number of results shown per page in the modal.

### `disableUserPersonalization`

**Type:** `boolean` — **default:** `false`

Don’t save recent searches and favorites in local storage.

### `recentSearchesLimit`

**Type:** `number` — **default:** `7`

### `debounce`

**Type:** `number` — **default:** `120`

Milliseconds to wait after the last keystroke before sending a query.

### `clientOptionsModule`

**Type:** `string`

Path to a module whose default export is merged into the [DocSearch options](https://docsearch.algolia.com/docs/api). Use it for options that are functions, such as `transformItems`, `hitComponent` or `getMissingResultsUrl`. Paths starting with `.` are relative to your project root.

```js title="astro.config.mjs"
starlightDocSearchTurbopuffer({
	namespace: 'my-docs',
	clientOptionsModule: './src/docsearch.ts',
});
```

```ts title="src/docsearch.ts"
import type { DocSearchClientOptions } from 'starlight-docsearch-turbopuffer';

export default {
	getMissingResultsUrl: ({ query }) =>
		`https://github.com/org/repo/issues/new?title=Missing+search+results+for+${encodeURIComponent(query)}`,
} satisfies DocSearchClientOptions;
```
