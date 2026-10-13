---
title: Tuning relevance
description: Adjust how semantic and keyword results are ranked and filtered.
---

The `search` option controls ranking. Changes take effect without re-indexing. If you deploy the search handler separately, pass the same `search` options to `createSearchHandler()`.

```js title="astro.config.mjs"
starlightDocSearchTurbopuffer({
	namespace: 'my-docs',
	search: {
		semanticWeight: 1,
		keywordWeight: 1.5,
		boosts: { title: 4 },
		maxDistance: 0.55,
	},
});
```

## Balance semantic and keyword results

`semanticWeight` and `keywordWeight` set how much each list contributes during reciprocal rank fusion. Raise `keywordWeight` if readers mostly search for exact API names; raise `semanticWeight` if they ask questions in their own words. `rankConstant` (default `60`) controls how quickly lower-ranked results lose influence: lower values favour the top of each list.

## Boost headings

Keyword matches are weighted by field: section heading (`boosts.title`, default `3`), page title (`boosts.pageTitle`, default `2`) and content (`boosts.content`, default `1`).

## Distance cut-off

Semantic search always finds _something_: vector search returns its full limit even for queries nothing on your site is about. To keep unrelated sections out of the results, semantic-only results are dropped when:

- their vector distance is above `maxDistance` (default `0.55`), or
- they are more than `relativeDistance` (default `0.12`) further than the best semantic match.

Results that also match keywords are always kept.

```js title="astro.config.mjs"
starlightDocSearchTurbopuffer({
	namespace: 'my-docs',
	search: {
		maxDistance: 0.5, // stricter: fewer loosely related results
		relativeDistance: false, // disable the relative cut-off
	},
});
```

Set either option to `false` to disable it. With both disabled, every semantic result is fused into the list, which tends to fill the results with unrelated sections.

The defaults are tuned for `baai/bge-m3` with cosine distance, where relevant sections usually score between `0.3` and `0.5`. Other models produce different distance ranges. To tune the cut-off for your site:

1. Search for a few things your docs cover, phrased in your own words, and check they still show up.
2. Search for things your docs don’t cover, and lower `maxDistance` until those return nothing.

To see raw distances, query your namespace with the [turbopuffer API](https://turbopuffer.com/docs/query): `$dist` is the vector distance of each row.

## Short queries

Queries shorter than `minSemanticQueryLength` characters (default `3`) only use keyword search. A query of one or two characters is almost always the start of a longer word, and keyword prefix matching handles it better than embeddings.

Single-word queries embed poorly, so for them the semantic weight is halved: keyword matches come first, and semantic results still surface synonyms (a search for “pricing” finds a section about cost).

## Results per page

`maxResultsPerPage` (default `5`) limits how many sections of one page appear in the results, and `limit` (default `20`) limits the total. In the modal, `maxResultsPerGroup` controls how many results are shown per page before it collapses.
