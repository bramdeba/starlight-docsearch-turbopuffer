declare module 'virtual:starlight-docsearch-turbopuffer/client-config' {
	const config: import('./src/client/types').ClientConfig;
	export default config;
}

declare module 'virtual:starlight-docsearch-turbopuffer/client-options' {
	const options: import('./src/index').DocSearchClientOptions;
	export default options;
}

declare module 'virtual:starlight-docsearch-turbopuffer/server-config' {
	const config: Omit<import('./src/server/handler').SearchHandlerOptions, 'apiKey'>;
	export default config;
}
