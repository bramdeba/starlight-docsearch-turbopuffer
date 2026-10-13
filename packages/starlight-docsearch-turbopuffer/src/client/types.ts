/** Serializable configuration passed to the browser via a virtual module. */
export interface ClientConfig {
	/** URL of the search handler. */
	endpoint: string;
	/** Namespace template, used to key recent searches per namespace. */
	namespace: string;
	/** Delay in milliseconds after the last keystroke before a query is sent. */
	debounce: number;
	/** Options passed straight to DocSearch. */
	docsearch: {
		maxResultsPerGroup?: number | undefined;
		disableUserPersonalization?: boolean | undefined;
		recentSearchesLimit?: number | undefined;
	};
}
