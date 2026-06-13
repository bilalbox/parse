// The offline-cache convention — single source of truth for how the active
// Library is cached for offline reading (see docs/adr/0002).
// Shared via ESM imports by both the client pages and the service worker.
export const RUNTIME_CACHE = 'parse-runtime-v1';

// The /media/<key> reference shape, used to discover an Article's images in
// stored content.
const mediaPattern = /\/media\/[A-Za-z0-9._-]+/g;

/**
 * Pull every /media/<key> URL out of stored Article content.
 */
export function mediaUrls(content: string): string[] {
	if (!content) return [];
	return content.match(mediaPattern) || [];
}

/**
 * Is this same-origin GET path one we mirror for offline (Article content or media)?
 */
export function isRuntimeCacheable(path: string): boolean {
	return path.startsWith('/api/articles') || path.startsWith('/media/');
}
