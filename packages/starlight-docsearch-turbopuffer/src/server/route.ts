import type { APIRoute } from 'astro';
import { getSecret } from 'astro:env/server';
import config from 'virtual:starlight-docsearch-turbopuffer/server-config';
import { createSearchHandler } from './handler';

export const prerender = false;

let handler: ReturnType<typeof createSearchHandler> | undefined;

/** Search endpoint injected by the plugin when the site has no external `endpoint`. */
export const GET: APIRoute = ({ request }) => {
	if (!handler) {
		const apiKey = getSecret('TURBOPUFFER_READ_API_KEY') ?? getSecret('TURBOPUFFER_API_KEY');
		if (!apiKey) {
			console.error(
				'[starlight-docsearch-turbopuffer] Set TURBOPUFFER_READ_API_KEY (or TURBOPUFFER_API_KEY) to enable search.'
			);
			return Response.json({ error: 'Search is not configured' }, { status: 500 });
		}
		handler = createSearchHandler({
			...config,
			region: config.region ?? getSecret('TURBOPUFFER_REGION'),
			apiKey,
		});
	}
	return handler(request);
};
