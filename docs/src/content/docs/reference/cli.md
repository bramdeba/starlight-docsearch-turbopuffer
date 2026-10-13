---
title: CLI
description: Sync a build to turbopuffer from the command line.
---

```sh
npx starlight-docsearch-turbopuffer sync [options]
```

Syncs the records extracted by the last `astro build` to turbopuffer. The build writes them to `node_modules/.astro/starlight-docsearch-turbopuffer/manifest.json`, together with the namespace, region and index settings, so the CLI needs no configuration.

Requires `TURBOPUFFER_API_KEY` with write access, from the environment or `.env`.

## Options

| Option | Description |
| --- | --- |
| `--manifest <path>` | Manifest to sync. Default: `node_modules/.astro/starlight-docsearch-turbopuffer/manifest.json`. |
| `--region <region>` | Override the turbopuffer region. |
| `--base-url <url>` | Override the turbopuffer API URL. |
| `--reset` | Delete the namespaces and index everything again. Required after changing the embedding model. Re-embeds every record. |
| `--dry-run` | Show how many records would be written and deleted, without writing. |

## Example

```sh
$ npx starlight-docsearch-turbopuffer sync --dry-run
[dry run] my-docs: 12 upserted, 3 deleted, 199 unchanged
```
