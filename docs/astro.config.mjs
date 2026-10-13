// @ts-check
import node from '@astrojs/node';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightDocSearchTurbopuffer from 'starlight-docsearch-turbopuffer';

export default defineConfig({
	adapter: node({ mode: 'standalone' }),
	integrations: [
		starlight({
			title: 'Starlight DocSearch turbopuffer',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/bramdeba/starlight-docsearch-turbopuffer',
				},
			],
			editLink: {
				baseUrl: 'https://github.com/bramdeba/starlight-docsearch-turbopuffer/edit/main/docs/',
			},
			sidebar: [
				{
					label: 'Start here',
					items: ['getting-started', 'guides/how-it-works'],
				},
				{
					label: 'Guides',
					items: ['guides/deployment', 'guides/indexing', 'guides/tuning', 'guides/i18n'],
				},
				{
					label: 'Reference',
					items: ['reference/configuration', 'reference/search-handler', 'reference/cli'],
				},
			],
			plugins: [
				starlightDocSearchTurbopuffer({
					namespace: 'starlight-docsearch-turbopuffer-docs',
				}),
			],
		}),
	],
});
