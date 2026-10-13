import { z } from 'astro/zod';

/**
 * Schema for the DocSearch modal’s strings.
 *
 * Add this to your `src/content.config.ts`:
 *
 * ```js
 * import { defineCollection } from 'astro:content';
 * import { docsLoader, i18nLoader } from '@astrojs/starlight/loaders';
 * import { docsSchema, i18nSchema } from '@astrojs/starlight/schema';
 * import { docSearchI18nSchema } from 'starlight-docsearch-turbopuffer/schema';
 *
 * export const collections = {
 * 	docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
 * 	i18n: defineCollection({
 * 		loader: i18nLoader(),
 * 		schema: i18nSchema({ extend: docSearchI18nSchema() }),
 * 	}),
 * };
 * ```
 *
 * DocSearch uses a nested object structure. This schema flattens DocSearch’s `modal`
 * translations: set each string using its object path inside `modal`, prefixed with `docsearch`:
 *
 * ```json
 * {
 *   "docsearch.footer.selectKeyAriaLabel": "Return key"
 * }
 * ```
 *
 * The keys follow DocSearch v5, which renamed some v3 keys used by `@astrojs/starlight-docsearch`
 * (e.g. `searchBox.resetButtonTitle` is now `searchBox.clearButtonTitle`).
 *
 * @see https://docsearch.algolia.com/docs/api#translations
 */
export const docSearchI18nSchema = () =>
	z
		.object({
			// SEARCH BOX
			/** Default: `Clear` */
			'docsearch.searchBox.clearButtonTitle': z.string(),
			/** Default: `Clear the query` */
			'docsearch.searchBox.clearButtonAriaLabel': z.string(),
			/** Default: `Close` */
			'docsearch.searchBox.closeButtonText': z.string(),
			/** Default: `Close` */
			'docsearch.searchBox.closeButtonAriaLabel': z.string(),
			/** Default: `Search` */
			'docsearch.searchBox.searchInputLabel': z.string(),

			// START SCREEN
			/** Default: `Recently viewed docs` */
			'docsearch.startScreen.recentSearchesTitle': z.string(),
			/** Default: `No recent searches` */
			'docsearch.startScreen.noRecentSearchesText': z.string(),
			/** Default: `Save this search` */
			'docsearch.startScreen.saveRecentSearchButtonTitle': z.string(),
			/** Default: `Remove this search from history` */
			'docsearch.startScreen.removeRecentSearchButtonTitle': z.string(),
			/** Default: `Favorite` */
			'docsearch.startScreen.favoriteSearchesTitle': z.string(),
			/** Default: `Remove this search from favorites` */
			'docsearch.startScreen.removeFavoriteSearchButtonTitle': z.string(),

			// ERROR SCREEN
			/** Default: `Unable to fetch results` */
			'docsearch.errorScreen.titleText': z.string(),
			/** Default: `You might want to check your network connection.` */
			'docsearch.errorScreen.helpText': z.string(),

			// FOOTER
			/** Default: `Select` */
			'docsearch.footer.selectText': z.string(),
			/** Default: `Enter key` */
			'docsearch.footer.selectKeyAriaLabel': z.string(),
			/** Default: `Navigate` */
			'docsearch.footer.navigateText': z.string(),
			/** Default: `Arrow up` */
			'docsearch.footer.navigateUpKeyAriaLabel': z.string(),
			/** Default: `Arrow down` */
			'docsearch.footer.navigateDownKeyAriaLabel': z.string(),
			/** Default: `Close` */
			'docsearch.footer.closeText': z.string(),
			/** Default: `Escape key` */
			'docsearch.footer.closeKeyAriaLabel': z.string(),

			// NO RESULTS SCREEN
			/** Default: `No results found for` */
			'docsearch.noResultsScreen.noResultsText': z.string(),
			/** Default: `Try searching for` */
			'docsearch.noResultsScreen.suggestedQueryText': z.string(),
			/** Default: `Believe this query should return results?` */
			'docsearch.noResultsScreen.reportMissingResultsText': z.string(),
			/** Default: `Let us know.` */
			'docsearch.noResultsScreen.reportMissingResultsLinkText': z.string(),
		})
		.partial();
