import { createHash } from 'node:crypto';
import { type HTMLElement, type Node, NodeType, parse } from 'node-html-parser';
import type { RecordType, SearchRecord } from '../shared/types';

export interface ExtractOptions {
	/** Page URL path, e.g. `/guides/setup/`. */
	url: string;
	contentSelector: string;
	ignoreSelectors: string[];
	maxChunkLength: number;
}

export interface ExtractedPage {
	lang: string;
	records: SearchRecord[];
}

/** Elements never worth indexing. */
const DEFAULT_IGNORE = [
	'script',
	'style',
	'template',
	'noscript',
	'svg',
	'button',
	'.sl-anchor-link',
	'[data-pagefind-ignore]',
	'[aria-hidden="true"]',
	'.expressive-code .copy',
	'.expressive-code .sr-only',
];

const BLOCK_ELEMENTS = new Set([
	'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'details', 'div', 'dl', 'dt',
	'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
	'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
]);

const HEADING_RE = /^h([2-6])$/;

interface Section {
	anchor: string | null;
	title: string;
	/** Headings of this section and its ancestors, with their HTML heading level. */
	stack: { level: number; title: string }[];
	text: string[];
}

/**
 * Extract search records from a page rendered by Starlight. Returns `null` for pages that opt out
 * of search (Starlight only marks searchable pages with `data-pagefind-body`).
 */
export function extractRecords(html: string, options: ExtractOptions): ExtractedPage | null {
	const root = parse(html, { comment: false, blockTextElements: { script: true, style: true } });
	const main = root.querySelector('[data-pagefind-body]');
	if (!main) return null;

	const lang = root.querySelector('html')?.getAttribute('lang') ?? 'en';
	const pageTitle = clean(root.querySelector('h1#_top')?.textContent ?? '');
	// The Search component records the page’s top-level sidebar group.
	const lvl0 = root.querySelector('sl-doc-search')?.getAttribute('data-lvl0') || pageTitle;

	const content = main.querySelector(options.contentSelector);
	if (!pageTitle && !content) return null;

	const sections: Section[] = [{ anchor: null, title: pageTitle, stack: [], text: [] }];

	if (content) {
		for (const selector of [...DEFAULT_IGNORE, ...options.ignoreSelectors]) {
			for (const el of content.querySelectorAll(selector)) el.remove();
		}
		walk(content, sections);
	}

	const records: SearchRecord[] = [];
	for (const section of sections) {
		const text = section.text.join('').replace(/[ \t]*\n[\s]*/g, '\n').trim();
		const headings = section.stack.map((h) => h.title).slice(0, 5);
		const hierarchy = [lvl0, pageTitle, ...headings];
		const type = `lvl${headings.length + 1}` as RecordType;
		const url = section.anchor ? `${options.url}#${section.anchor}` : options.url;
		const chunks = text ? chunk(text, options.maxChunkLength) : [''];
		// Sections without text are kept only if their heading can be found on its own.
		if (!text && section.anchor && !section.title) continue;

		chunks.forEach((chunkText, index) => {
			const breadcrumbs = hierarchy.slice(1).filter(Boolean).join(' › ');
			const record: Omit<SearchRecord, 'content_hash'> = {
				id: hash(`${url}\u0000${index}`).slice(0, 32),
				url,
				page: options.url,
				anchor: section.anchor,
				type,
				hierarchy,
				title: section.title,
				page_title: pageTitle,
				content: chunkText,
				semantic_text: chunkText ? `${breadcrumbs}\n\n${chunkText}` : breadcrumbs,
				has_content: chunkText.length > 0,
			};
			records.push({ ...record, content_hash: hash(JSON.stringify(record)) });
		});
	}

	return { lang, records };
}

function walk(node: Node, sections: Section[]): void {
	for (const child of node.childNodes) {
		if (child.nodeType === NodeType.TEXT_NODE) {
			sections.at(-1)!.text.push(child.textContent.replace(/\s+/g, ' '));
			continue;
		}
		if (child.nodeType !== NodeType.ELEMENT_NODE) continue;

		const el = child as HTMLElement;
		const tag = el.tagName.toLowerCase();
		const heading = HEADING_RE.exec(tag);

		if (heading && el.id) {
			const level = Number(heading[1]);
			const title = clean(el.textContent);
			// Keep the headings of all ancestor sections, e.g. [h2, h3] for an h4.
			const stack = [...sections.at(-1)!.stack.filter((h) => h.level < level), { level, title }];
			sections.push({ anchor: el.id, title, stack, text: [] });
			continue;
		}

		if (tag === 'pre') {
			sections.at(-1)!.text.push(`\n${preText(el)}\n`);
			continue;
		}

		const block = BLOCK_ELEMENTS.has(tag);
		if (block) sections.at(-1)!.text.push('\n');
		walk(el, sections);
		if (block) sections.at(-1)!.text.push('\n');
		else if (tag === 'td' || tag === 'th') sections.at(-1)!.text.push(' ');
	}
}

/** Text of a code block, one line per Expressive Code line. */
function preText(pre: HTMLElement): string {
	const lines = pre.querySelectorAll('.ec-line');
	const text = lines.length ? lines.map((line) => line.textContent).join('\n') : pre.textContent;
	return text
		.split('\n')
		.map((line) => line.trimEnd())
		.filter((line) => line.trim())
		.join('\n');
}

/** Split text into chunks of at most `max` characters, preferring paragraph and sentence breaks. */
export function chunk(text: string, max: number): string[] {
	if (text.length <= max) return [text];
	const chunks: string[] = [];
	let current = '';
	const push = () => {
		if (current.trim()) chunks.push(current.trim());
		current = '';
	};
	for (const paragraph of text.split('\n')) {
		if (paragraph.length > max) {
			push();
			const pieces = paragraph.match(/[^.!?]+[.!?]*\s*/g) ?? [paragraph];
			for (const piece of pieces) {
				if (current.length + piece.length > max) push();
				if (piece.length > max) {
					for (let i = 0; i < piece.length; i += max) chunks.push(piece.slice(i, i + max).trim());
				} else {
					current += piece;
				}
			}
			push();
			continue;
		}
		if (current.length + paragraph.length + 1 > max) push();
		current += (current ? '\n' : '') + paragraph;
	}
	push();
	return chunks;
}

function clean(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
