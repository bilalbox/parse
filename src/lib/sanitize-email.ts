import DOMPurify from 'dompurify';

let hooksRegistered = false;

function shouldDropStyleDeclaration(prop: string, value: string): boolean {
	const normalizedProp = prop.trim().toLowerCase();
	const normalizedValue = value.trim().toLowerCase();

	if (['width', 'min-width', 'max-width', 'height', 'min-height'].includes(normalizedProp)) {
		return true;
	}

	if (normalizedProp === 'white-space' && /^(nowrap|pre|pre-line)$/.test(normalizedValue)) {
		return true;
	}

	if (normalizedProp === 'position' && /^(absolute|fixed)$/.test(normalizedValue)) {
		return true;
	}

	if (normalizedProp === 'float') {
		return true;
	}

	if (normalizedProp.startsWith('margin') && /^-/.test(normalizedValue)) {
		return true;
	}

	return false;
}

function filterInlineStyle(style: string): string {
	return style
		.split(';')
		.map((declaration) => declaration.trim())
		.filter(Boolean)
		.filter((declaration) => {
			const colon = declaration.indexOf(':');
			if (colon === -1) return true;
			const prop = declaration.slice(0, colon);
			const value = declaration.slice(colon + 1);
			return !shouldDropStyleDeclaration(prop, value);
		})
		.join('; ');
}

function registerSanitizeHooks(): void {
	if (hooksRegistered) return;
	hooksRegistered = true;

	DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
		if (data.attrName === 'width' || data.attrName === 'height') {
			data.keepAttr = false;
			return;
		}

		if (data.attrName !== 'style') return;

		const filtered = filterInlineStyle(data.attrValue);
		if (!filtered) {
			data.keepAttr = false;
			return;
		}

		data.attrValue = filtered;
	});
}

function stripOverflowAttributes(root: Element): void {
	for (const el of Array.from(root.querySelectorAll('*'))) {
		el.removeAttribute('width');
		el.removeAttribute('height');

		const style = el.getAttribute('style');
		if (!style) continue;

		const filtered = filterInlineStyle(style);
		if (filtered) el.setAttribute('style', filtered);
		else el.removeAttribute('style');
	}
}

export function sanitizeArticleHtml(html: string): string {
	if (!html) return '';

	registerSanitizeHooks();
	const clean = DOMPurify.sanitize(html);

	if (typeof window === 'undefined') return clean;

	const doc = new DOMParser().parseFromString(`<div id="sanitize-root">${clean}</div>`, 'text/html');
	const root = doc.getElementById('sanitize-root');
	if (!root) return clean;

	stripOverflowAttributes(root);
	return root.innerHTML;
}
