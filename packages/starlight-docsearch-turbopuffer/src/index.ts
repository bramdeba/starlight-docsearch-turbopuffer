import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import type { StarlightPlugin } from '@astrojs/starlight/types';
import type { DocSearchProps } from '@docsearch/js/docsearch';
import type { AstroConfig, AstroIntegrationLogger, ViteUserConfig } from 'astro';
import type { ClientConfig } from './client/types';
import {
	TurbopufferDocSearchConfigSchema,
	type TurbopufferDocSearchConfig,
	type TurbopufferDocSearchUserConfig,
} from './config';
import { buildManifest, formatResult, syncManifest, writeManifest } from './indexer';
import type { SearchHandlerOptions } from './server/handler';
import { LANG_PLACEHOLDER } from './shared/options';

export type { TurbopufferDocSearchUserConfig } from './config';
export type { SearchRankingOptions } from './shared/options';

/**
 * Options merged into the DocSearch configuration through `clientOptionsModule`. Connection
 * options are managed by the plugin and can’t be overridden.
 */
export type DocSearchClientOptions = Partial<
	Omit<
		DocSearchProps,
		'container' | 'appId' | 'apiKey' | 'indices' | 'transformSearchClient' | 'translations'
	>
>;

const PLUGIN_NAME = 'starlight-docsearch-turbopuffer';
const MANIFEST_PATH = `${PLUGIN_NAME}/manifest.json`;

const modules = {
	clientConfig: `virtual:${PLUGIN_NAME}/client-config`,
	clientOptions: `virtual:${PLUGIN_NAME}/client-options`,
	serverConfig: `virtual:${PLUGIN_NAME}/server-config`,
} as const;

/** Starlight plugin adding hybrid search powered by turbopuffer. */
export default function starlightDocSearchTurbopuffer(
	userConfig: TurbopufferDocSearchUserConfig
): StarlightPlugin {
	const config = TurbopufferDocSearchConfigSchema.parse(userConfig);

	return {
		name: PLUGIN_NAME,
		hooks: {
			'config:setup'({ addIntegration, config: starlightConfig, logger, updateConfig }) {
				if (starlightConfig.components?.Search) {
					logger.warn(
						'It looks like you already have a `Search` component override in your Starlight configuration.'
					);
					logger.warn(`To render \`${PLUGIN_NAME}\`, remove the override for the \`Search\` component.\n`);
				} else {
					updateConfig({
						pagefind: false,
						components: { ...starlightConfig.components, Search: `${PLUGIN_NAME}/DocSearch.astro` },
					});
				}

				const langs = siteLangs(starlightConfig);
				if (langs.length > 1 && !config.namespace.includes(LANG_PLACEHOLDER)) {
					throw new Error(
						`[${PLUGIN_NAME}] This site has multiple languages (${langs.join(', ')}). Add a \`${LANG_PLACEHOLDER}\` placeholder to the \`namespace\` option, e.g. \`${config.namespace}-${LANG_PLACEHOLDER}\`, to index each language separately.`
					);
				}

				let astroConfig: AstroConfig;

				addIntegration({
					name: PLUGIN_NAME,
					hooks: {
						'astro:config:setup'({ command, config: astro, injectRoute, logger, updateConfig }) {
							let endpoint = config.endpoint;
							if (!endpoint) {
								if (command === 'build' && !astro.adapter) {
									logger.warn(
										'Search needs a server-side endpoint, but this site has no adapter. Add an Astro adapter, or deploy the search handler separately and set the `endpoint` option.'
									);
								} else {
									injectRoute({
										pattern: '/api/search',
										entrypoint: `${PLUGIN_NAME}/route`,
										prerender: false,
									});
								}
								const base = astro.base.replace(/\/?$/, '/');
								endpoint = `${base}api/search${astro.trailingSlash === 'always' ? '/' : ''}`;
							}

							updateConfig({
								vite: { plugins: [vitePluginTurbopufferConfig(astro.root, config, endpoint, langs)] },
							});
						},
						'astro:config:done'({ config: astro }) {
							astroConfig = astro;
						},
						async 'astro:build:done'({ dir, logger }) {
							await indexBuild(config, astroConfig, fileURLToPath(dir), logger);
						},
					},
				});
			},
		},
	};
}

/** Extract search records from the build, write the manifest, and sync it when enabled. */
async function indexBuild(
	config: TurbopufferDocSearchConfig,
	astro: AstroConfig,
	dir: string,
	logger: AstroIntegrationLogger
) {
	const root = fileURLToPath(astro.root);
	const apiKey = readEnv(root, 'TURBOPUFFER_API_KEY');
	const region = config.region ?? readEnv(root, 'TURBOPUFFER_REGION');
	const start = performance.now();

	const manifest = await buildManifest({
		dir,
		base: astro.base,
		trailingSlash: astro.trailingSlash,
		namespace: config.namespace,
		region,
		baseURL: config.baseURL,
		embedding: config.embedding,
		distanceMetric: config.distanceMetric,
		fullTextSearch: config.fullTextSearch,
		...config.indexing,
	});
	const manifestPath = join(fileURLToPath(astro.cacheDir), MANIFEST_PATH);
	await writeManifest(manifestPath, manifest);

	const counts = Object.entries(manifest.namespaces).map(
		([namespace, { records }]) => `${records.length} in ${namespace}`
	);
	logger.info(`Extracted search records: ${counts.join(', ') || 'none'}.`);

	const { enabled } = config.indexing;
	if (enabled === false || (enabled === 'auto' && !apiKey)) {
		logger.info('Skipping turbopuffer sync. Run `starlight-docsearch-turbopuffer sync` to index.');
		return;
	}
	if (!apiKey) throw new Error(`[${PLUGIN_NAME}] Set TURBOPUFFER_API_KEY to index the site.`);

	const results = await syncManifest(manifest, {
		apiKey,
		region,
		baseURL: config.baseURL,
		log: (message) => logger.debug(message),
	});
	for (const result of results) logger.info(formatResult(result));
	logger.info(`Synced to turbopuffer in ${((performance.now() - start) / 1000).toFixed(2)}s.`);
}

/** Read an environment variable, falling back to the project’s `.env` files like Astro does. */
function readEnv(root: string, name: string): string | undefined {
	if (process.env[name]) return process.env[name];
	for (const file of ['.env.production.local', '.env.local', '.env.production', '.env']) {
		const path = join(root, file);
		if (!existsSync(path)) continue;
		const value = parseEnv(readFileSync(path, 'utf8'))[name];
		if (value) return value;
	}
	return undefined;
}

/** Language tags of all locales configured in Starlight. */
function siteLangs(config: Parameters<NonNullable<StarlightPlugin['hooks']['config:setup']>>[0]['config']) {
	// Starlight defaults to English when no locales are configured.
	if (!config.locales) return ['en'];
	return Object.entries(config.locales).map(([key, locale]) => locale?.lang ?? key);
}

/** Vite plugin exposing the plugin configuration to the client and the search route. */
function vitePluginTurbopufferConfig(
	root: URL,
	config: TurbopufferDocSearchConfig,
	endpoint: string,
	langs: string[]
): VitePlugin {
	const clientConfig: ClientConfig = {
		endpoint,
		namespace: config.namespace,
		debounce: config.debounce,
		docsearch: {
			maxResultsPerGroup: config.maxResultsPerGroup,
			disableUserPersonalization: config.disableUserPersonalization,
			recentSearchesLimit: config.recentSearchesLimit,
		},
	};
	const serverConfig: Omit<SearchHandlerOptions, 'apiKey'> = {
		namespace: config.namespace,
		region: config.region,
		baseURL: config.baseURL,
		search: config.search,
		langs,
	};
	const resolveSpecifier = (id: string) =>
		JSON.stringify(id.startsWith('.') ? resolve(fileURLToPath(root), id) : id);

	const contents: Record<string, string> = {
		[modules.clientConfig]: `export default ${JSON.stringify(clientConfig)};`,
		[modules.clientOptions]: config.clientOptionsModule
			? `export { default } from ${resolveSpecifier(config.clientOptionsModule)};`
			: 'export default {};',
		[modules.serverConfig]: `export default ${JSON.stringify(serverConfig)};`,
	};
	const resolved = new Map(Object.keys(contents).map((id) => [`\0${id}`, id]));
	const filter = new RegExp(`^\\0?virtual:${PLUGIN_NAME}/`);

	return {
		name: `vite-plugin-${PLUGIN_NAME}-config`,
		resolveId: {
			filter: { id: filter },
			handler(id) {
				return id in contents ? `\0${id}` : undefined;
			},
		},
		load: {
			filter: { id: filter },
			handler(id) {
				const original = resolved.get(id);
				return original ? contents[original] : undefined;
			},
		},
	};
}

type VitePlugin = NonNullable<ViteUserConfig['plugins']>[number];
