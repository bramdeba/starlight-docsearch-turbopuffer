---
title: How it works
description: How indexing, hybrid search and result fusion work.
---

The plugin has three parts: an indexer that runs after `astro build`, a search handler that queries turbopuffer, and the DocSearch modal in the browser.

## Indexing

After each build, the indexer reads every HTML page Starlight generated. Pages excluded from search (with `pagefind: false` in their frontmatter, and 404 pages) are skipped.

Each page is split into **sections** at its headings. The text before the first heading becomes the page introduction. Each section becomes a record with:

- the page title and the chain of parent headings, used for breadcrumbs and keyword boosts;
- the top-level sidebar group, used to group results in the modal;
- the plain text of the section, including code blocks;
- a hash of its content.

Long sections are split into chunks so each stays focused. The indexer then compares the hashes with what is already in turbopuffer: only new and changed records are written, and records for removed sections are deleted. Unchanged records are never re-embedded, so rebuilding a large site costs almost nothing.

## Native embeddings

turbopuffer computes embeddings server-side. The plugin declares a `semantic_text` attribute with an `embed` model in the namespace schema. turbopuffer embeds it when records are written and embeds the query text when you search. The default model is `baai/bge-m3`: multilingual, 1024 dimensions, and inexpensive.

The text sent to the model includes the page title and section headings, so a section like “Install” under “Getting started” is understood in context.

## Hybrid search

Every query sends one multi-query request to turbopuffer with two sub-queries:

1. **Semantic search**: approximate nearest neighbour search on the embedded text.
2. **Keyword search**: BM25 over the section heading, page title and content, with headings boosted. The last word of the query matches as a prefix, so results appear while typing.

Both sub-queries return highlighted fragments of the matching text.

## Result fusion

The search handler fuses the two result lists with **reciprocal rank fusion** (RRF): each result scores `weight / (k + rank)` per list it appears in. Results found by both searches rise to the top.

Vector search always returns its full limit, even for queries nothing on your site is about. Before fusing, the handler therefore drops semantic-only results whose vector distance is above a threshold, or too far from the best semantic match. Results that also match keywords are always kept. See [Distance cut-off](/guides/tuning/#distance-cut-off).

## Search endpoint

turbopuffer API keys can read every namespace in an organization and the API does not allow browser requests, so queries go through a search endpoint. It fixes the namespace and query shape, validates input and keeps the key on the server. With an Astro adapter, the plugin adds it to your site at `/api/search`. You can also [deploy it separately](/guides/deployment/).

When the search modal is about to open, the browser asks the endpoint to warm turbopuffer’s cache, so the first query is fast even if the namespace was idle.
