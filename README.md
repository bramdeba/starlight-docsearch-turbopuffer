# starlight-docsearch-turbopuffer

Hybrid semantic + keyword search for [Starlight](https://starlight.astro.build) documentation sites, powered by [turbopuffer](https://turbopuffer.com).

Readers find what they mean, not only what they typed: _“how do I keep my api key secret”_ finds the section titled _“Use a read-only key for search”_. Every query combines vector search, using turbopuffer’s native embeddings, with BM25 keyword search. Results appear in the familiar [DocSearch](https://docsearch.algolia.com) modal, themed to match Starlight.

<p align="center">
  <img src="https://raw.githubusercontent.com/bramdeba/starlight-docsearch-turbopuffer/main/.github/assets/search-dark.png" alt="The search modal in dark mode, showing results for “how do I keep my api key secret”" width="49%">
  <img src="https://raw.githubusercontent.com/bramdeba/starlight-docsearch-turbopuffer/main/.github/assets/search-light.png" alt="The same search in light mode" width="49%">
</p>

## Features

- **Hybrid search.** Semantic and keyword search run in a single turbopuffer request. Their results are merged with reciprocal rank fusion, so sections found by both rise to the top.
- **No embedding pipeline.** turbopuffer embeds your content and every query server-side. The default model is `baai/bge-m3`, which is multilingual and inexpensive.
- **Indexes on build.** After `astro build`, every page is split into sections at its headings and synced to turbopuffer. Unchanged sections are never re-embedded, so rebuilds cost next to nothing.
- **Keeps your key secret.** Queries go through a small search endpoint. With an Astro adapter, the plugin adds it to your site for you. Static sites can run it as a function on Cloudflare Workers, Vercel, Netlify, Deno or Bun.
- **Relevant results only.** A configurable distance cut-off drops weak semantic matches, so off-topic queries return nothing instead of a page of loosely related sections.
- **Fast.** Type-ahead prefix matching, debounced queries, cache warming when the search button is hovered, and `Cache-Control` headers for CDNs.
- **Multilingual.** Each locale gets its own namespace, with language-aware stemming and stopwords for keyword search.
- **Configurable.** Namespace, region, embedding model, full-text settings, ranking weights, boosts and cut-offs are all options.

## How it compares

| | Pagefind (Starlight default) | [`@astrojs/starlight-docsearch`](https://starlight.astro.build/guides/site-search/#algolia-docsearch) | **starlight-docsearch-turbopuffer** |
| --- | --- | --- | --- |
| Search type | Keyword | Keyword | **Semantic + keyword** |
| Index | Static files, built locally | Algolia crawler | Your turbopuffer namespace, synced on build |
| Runs on | Browser | Algolia | Your search endpoint + turbopuffer |
| Matching | Stemming | Typo tolerance | Meaning (embeddings), stemming, prefixes |

## Requirements

- Astro 6 or 7, Starlight 0.38 or later, Node.js 22.12 or later.
- A [turbopuffer](https://turbopuffer.com) account with an API key.
- Somewhere to run the search endpoint: an [Astro adapter](https://docs.astro.build/en/guides/on-demand-rendering/), or a serverless function. The turbopuffer API doesn’t accept browser requests, and its API keys can read every namespace in your organization, so queries can’t go straight from the browser to turbopuffer.

## Quick start

1. Install the plugin:

   ```sh
   npm install starlight-docsearch-turbopuffer
   ```

2. Add it to Starlight in `astro.config.mjs`:

   ```js
   import starlight from '@astrojs/starlight';
   import { defineConfig } from 'astro/config';
   import starlightDocSearchTurbopuffer from 'starlight-docsearch-turbopuffer';

   export default defineConfig({
   	integrations: [
   		starlight({
   			title: 'My docs',
   			plugins: [
   				starlightDocSearchTurbopuffer({
   					namespace: 'my-docs',
   					region: 'gcp-europe-west1',
   				}),
   			],
   		}),
   	],
   });
   ```

3. Add your turbopuffer API keys to `.env`:

   ```sh
   # Write access, used at build time to index your site.
   TURBOPUFFER_API_KEY=tpuf_...
   # Read-only, used by the search endpoint. Falls back to TURBOPUFFER_API_KEY.
   TURBOPUFFER_READ_API_KEY=tpuf_...
   ```

4. Build. The plugin indexes your site after the build:

   ```txt
   $ npm run build
   [starlight-docsearch-turbopuffer] Extracted search records: 214 in my-docs.
   [starlight-docsearch-turbopuffer] my-docs: 214 upserted, 0 deleted, 0 unchanged, 31260 embedding tokens
   ```

5. Press <kbd>Ctrl</kbd>+<kbd>K</kbd> (<kbd>⌘</kbd>+<kbd>K</kbd> on macOS) on your site to search.

## The search endpoint

### With an Astro adapter

If your site uses an adapter (Vercel, Netlify, Cloudflare, Node.js…), the plugin adds an on-demand route at `/api/search`. Your docs pages stay prerendered. Set `TURBOPUFFER_READ_API_KEY`, and `TURBOPUFFER_REGION` unless you set the `region` option, wherever your site runs.

### On a static site

Deploy the handler as a function and point the plugin to it with `endpoint`. `createSearchHandler()` takes a standard `Request` and returns a `Response`, so it runs anywhere. For example, on Cloudflare Workers:

```ts
import { createSearchHandler } from 'starlight-docsearch-turbopuffer/handler';

let handler: ReturnType<typeof createSearchHandler> | undefined;

export default {
	fetch(request: Request, env: { TURBOPUFFER_API_KEY: string }) {
		handler ??= createSearchHandler({
			apiKey: env.TURBOPUFFER_API_KEY,
			region: 'gcp-europe-west1',
			namespace: 'my-docs',
			allowedOrigins: ['https://docs.example.com'],
		});
		return handler(request);
	},
};
```

```js
// astro.config.mjs
starlightDocSearchTurbopuffer({
	namespace: 'my-docs',
	region: 'gcp-europe-west1',
	endpoint: 'https://search.example.com/',
});
```

See the [deployment guide](https://github.com/bramdeba/starlight-docsearch-turbopuffer/blob/main/docs/src/content/docs/guides/deployment.mdx) for Vercel, Netlify, Deno and Bun.

## Indexing

By default, the plugin syncs to turbopuffer at the end of `astro build` whenever `TURBOPUFFER_API_KEY` is set. Only new and changed sections are written, and sections that no longer exist are deleted.

To keep preview deployments out of your production index, disable indexing outside production:

```js
starlightDocSearchTurbopuffer({
	namespace: 'my-docs',
	indexing: { enabled: process.env.VERCEL_ENV === 'production' },
});
```

Or index in a separate CI step: every build writes the extracted records to a manifest, which the CLI syncs:

```sh
npx starlight-docsearch-turbopuffer sync            # sync the last build
npx starlight-docsearch-turbopuffer sync --dry-run  # show what would change
npx starlight-docsearch-turbopuffer sync --reset    # re-index from scratch, e.g. after changing the embedding model
```

Pages with `pagefind: false` in their frontmatter are not indexed. Leave out more with `indexing.exclude` (URL patterns such as `/blog/**`) and `indexing.ignoreSelectors` (CSS selectors).

## Tuning relevance

The `search` options take effect without re-indexing. If you deploy the handler separately, pass the same options to `createSearchHandler()`.

```js
starlightDocSearchTurbopuffer({
	namespace: 'my-docs',
	search: {
		semanticWeight: 1, // weight of semantic results in rank fusion
		keywordWeight: 1.5, // weight of keyword results
		boosts: { title: 3, pageTitle: 2, content: 1 }, // keyword boosts per field
		maxDistance: 0.55, // distance cut-off for semantic-only results
		relativeDistance: 0.12, // max distance from the best semantic result
	},
});
```

### Distance cut-off

Vector search always returns results, even for queries nothing on your site is about. Semantic results that don’t also match keywords are therefore dropped in two cases:

- **`maxDistance`** (default `0.55`): their vector distance is above this value.
- **`relativeDistance`** (default `0.12`): they are this much further from the query than the best semantic match.

Set either to `false` to disable it. The defaults are tuned for `baai/bge-m3` with cosine distance. With another model, search for something your docs don’t cover and lower `maxDistance` until it returns nothing.

## Multilingual sites

Add a `{lang}` placeholder to the namespace. Each locale is then indexed separately, and readers only see results in the language they are reading:

```js
starlightDocSearchTurbopuffer({ namespace: 'my-docs-{lang}' }); // my-docs-en, my-docs-fr, …
```

Keyword search picks a stemmer and stopword list from each locale’s language. Override it with `fullTextSearch.language`.

To translate the modal, extend Starlight’s i18n schema with `docSearchI18nSchema()` from `starlight-docsearch-turbopuffer/schema` and add `docsearch.*` keys to your translation files. The keys follow DocSearch v5. If you are coming from `@astrojs/starlight-docsearch`, the `searchBox.resetButton*` and `searchBox.cancelButton*` keys are now `searchBox.clearButton*` and `searchBox.closeButton*`.

## Configuration

| Option | Default | Description |
| --- | --- | --- |
| `namespace` | **required** | turbopuffer namespace. Use `{lang}` on multilingual sites. |
| `region` | `TURBOPUFFER_REGION` | turbopuffer region, e.g. `gcp-europe-west1`. |
| `baseURL` | | Custom turbopuffer API URL. |
| `endpoint` | `/api/search` | Search endpoint URL, for a separately deployed handler. |
| `embedding.model` | `'baai/bge-m3'` | [turbopuffer embedding model](https://turbopuffer.com/docs/embedding). |
| `embedding.dimensions` | model default | Vector dimensions. |
| `distanceMetric` | `'cosine_distance'` | Or `'euclidean_squared'`. |
| `fullTextSearch` | stemming, stopwords, ASCII folding | Language, stemming, stopwords, tokenizer and BM25 parameters. |
| `search` | see above | Ranking weights, boosts, distance cut-offs, limits. |
| `indexing.enabled` | `'auto'` | `true`, `false`, or `'auto'` (when `TURBOPUFFER_API_KEY` is set). |
| `indexing.contentSelector` | `'.sl-markdown-content'` | Content to index on each page. |
| `indexing.exclude` | `[]` | URL patterns to skip. |
| `indexing.ignoreSelectors` | `[]` | Elements to skip. |
| `indexing.maxChunkLength` | `1500` | Longer sections are split. |
| `maxResultsPerGroup` | `5` | Results shown per page in the modal. |
| `debounce` | `120` | Milliseconds to wait after typing before querying. |
| `clientOptionsModule` | | Module with extra [DocSearch options](https://docsearch.algolia.com/docs/api), such as `getMissingResultsUrl`. |

See the [full configuration reference](https://github.com/bramdeba/starlight-docsearch-turbopuffer/blob/main/docs/src/content/docs/reference/configuration.md).

## How it works

1. **Indexing.** After the build, each page is split into sections at its headings. Each section is stored with its page title, parent headings, top-level sidebar group, plain text (including code blocks) and a content hash. turbopuffer embeds the section text, prefixed with its breadcrumbs, when it is written.
2. **Querying.** The search endpoint sends one request to turbopuffer with two sub-queries:
   - approximate nearest-neighbour search on the embedded text;
   - BM25 search over headings, page titles and content, with the last word matched as a prefix for type-ahead.

   Both return highlighted fragments.
3. **Fusion.** The endpoint drops weak semantic-only matches, merges both lists with weighted reciprocal rank fusion, limits results per page, and returns hits in the shape DocSearch renders.

More detail in [How it works](https://github.com/bramdeba/starlight-docsearch-turbopuffer/blob/main/docs/src/content/docs/guides/how-it-works.md).

## Cost

Indexing this repository’s docs (73 sections) used about 7,000 embedding tokens. With `baai/bge-m3` at $0.01 per million tokens, that is a fraction of a cent, and later builds only embed changed sections. Each search costs one turbopuffer query plus a handful of embedding tokens for the query text. See [turbopuffer pricing](https://turbopuffer.com/pricing).

## Development

```sh
pnpm install
pnpm test            # unit tests
pnpm typecheck
pnpm build           # build the package
cp .env.example .env # add a turbopuffer API key
pnpm docs:build      # build the docs site and index it
```

The repository contains the plugin in `packages/starlight-docsearch-turbopuffer` and its documentation site in `docs`. Releases use [changesets](https://github.com/changesets/changesets).

## Credits

Built on the shoulders of [`@astrojs/starlight-docsearch`](https://github.com/withastro/starlight/tree/main/packages/docsearch) and [`starlight-docsearch-typesense`](https://github.com/typesense/starlight-docsearch-typesense), and uses the [DocSearch](https://github.com/algolia/docsearch) modal by Algolia.

## License

[MIT](https://github.com/bramdeba/starlight-docsearch-turbopuffer/blob/main/LICENSE)
