import { defineConfig } from 'tsdown';

export default defineConfig({
	copy: ['src/DocSearch.astro', 'src/variables.css'],
	dts: true,
	entry: [
		'src/index.ts',
		'src/schema.ts',
		'src/cli.ts',
		'src/server/handler.ts',
		'src/server/route.ts',
		// Imported by the client script in DocSearch.astro.
		'src/client/search-client.ts',
		'src/shared/options.ts',
	],
	deps: { neverBundle: [/^astro:/, /^virtual:/] },
	fixedExtension: false,
	publint: { strict: true },
	unbundle: true,
});
