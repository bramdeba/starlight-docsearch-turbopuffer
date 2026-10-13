---
title: Search handler
description: API reference for createSearchHandler().
---

```ts
import { createSearchHandler } from 'starlight-docsearch-turbopuffer/handler';
```

`createSearchHandler(options)` returns a function that takes a [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) and returns a `Promise<Response>`. The module has no Node.js dependencies and runs on edge runtimes.

## Options

| Option | Type | Description |
| --- | --- | --- |
| `apiKey` | `string` | **Required.** A turbopuffer API key. Use a read-only key. |
| `namespace` | `string` | **Required.** The namespace or `{lang}` template the site was indexed into. |
| `region` | `string` | The turbopuffer region. |
| `baseURL` | `string` | A custom turbopuffer API URL. Takes precedence over `region`. |
| `search` | `object` | [Ranking options](/reference/configuration/#search). Use the same values as your Astro config. |
| `langs` | `string[]` | Language tags accepted for `{lang}`. Defaults to any well-formed tag. |
| `allowedOrigins` | `'*' \| string[]` | Origins allowed to call the handler from a browser. Needed when it runs on a different origin than your docs. |
| `cacheControl` | `string` | `Cache-Control` header for results. Default: `public, max-age=60`. |
| `fetch` | `typeof fetch` | A custom `fetch` implementation. |

## Requests

### Search

```http
GET /api/search?q=install%20the%20plugin&lang=en
```

Returns hits in the format the DocSearch modal renders:

```json
{
	"hits": [
		{
			"objectID": "6f1c…",
			"url": "/getting-started/#installation",
			"type": "content",
			"hierarchy": { "lvl0": "Start here", "lvl1": "Getting started", "lvl2": "Installation" },
			"_snippetResult": { "content": { "value": "<mark>Install</mark> the plugin:" } }
		}
	],
	"nbHits": 1,
	"processingTimeMS": 18
}
```

All text in hits is HTML-escaped, with matches wrapped in `<mark>`. Before the namespace exists, the handler returns no hits instead of an error.

### Warm the cache

```http
GET /api/search?warm&lang=en
```

Asks turbopuffer to load the namespace into its cache. Returns `204`. The modal calls this when a reader hovers or focuses the search button.
