#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { formatResult, readManifest, syncManifest } from './indexer';

const DEFAULT_MANIFEST = 'node_modules/.astro/starlight-docsearch-turbopuffer/manifest.json';

const HELP = `Usage: starlight-docsearch-turbopuffer sync [options]

Sync the search records extracted by the last \`astro build\` to turbopuffer.

Options:
  --manifest <path>  Manifest written by the build (default: ${DEFAULT_MANIFEST})
  --region <region>  Turbopuffer region (default: TURBOPUFFER_REGION or the plugin option)
  --base-url <url>   Turbopuffer API base URL
  --reset            Delete the namespaces and re-index everything (re-embeds all records)
  --dry-run          Show what would change without writing
  -h, --help         Show this help

Environment:
  TURBOPUFFER_API_KEY  A turbopuffer API key with write access (also read from .env)`;

async function main() {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			manifest: { type: 'string', default: DEFAULT_MANIFEST },
			region: { type: 'string' },
			'base-url': { type: 'string' },
			reset: { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
			help: { type: 'boolean', short: 'h', default: false },
		},
	});

	if (values.help || positionals[0] !== 'sync') {
		console.log(HELP);
		process.exitCode = values.help ? 0 : 1;
		return;
	}

	if (existsSync('.env')) process.loadEnvFile('.env');
	const apiKey = process.env.TURBOPUFFER_API_KEY;
	if (!apiKey) throw new Error('Set the TURBOPUFFER_API_KEY environment variable.');

	const manifestPath = resolve(values.manifest);
	if (!existsSync(manifestPath)) {
		throw new Error(`No manifest found at ${manifestPath}. Run \`astro build\` first.`);
	}
	const manifest = await readManifest(manifestPath);
	const results = await syncManifest(manifest, {
		apiKey,
		region: values.region ?? manifest.region ?? process.env.TURBOPUFFER_REGION,
		baseURL: values['base-url'],
		reset: values.reset,
		dryRun: values['dry-run'],
		log: (message) => console.log(message),
	});
	for (const result of results) console.log(`${values['dry-run'] ? '[dry run] ' : ''}${formatResult(result)}`);
}

main().catch((error: Error) => {
	console.error(`starlight-docsearch-turbopuffer: ${error.message}`);
	process.exitCode = 1;
});
