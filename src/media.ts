// The media module owns the /media/<key> convention end to end: how an image's
// bytes get written to R2 and the <img> rewritten (rescueMedia), how those keys
// are read back out of stored content for purging (extractMediaKeys), and how a
// stored object is served (serveMedia). The key format lives in exactly one
// place, so write, purge, and serve can never drift apart.

export interface MediaBytes {
	buffer: ArrayBuffer;
	contentType: string;
}

// How a Source turns an image src into bytes (network fetch, cid: attachment, …).
// This is the seam: rescueMedia is identical across ingest paths; only this differs.
export type ResolveBytes = (src: string) => Promise<MediaBytes | null>;

// Upload one image's bytes to R2 under a fresh key and rewrite the <img> to
// point at /media/<key>. This write is the source of truth for the convention.
async function uploadToR2(img: any, imgBuffer: ArrayBuffer, contentType: string, bucket: R2Bucket): Promise<void> {
	const ext = (contentType.split('/')[1] || 'img').split(';')[0];
	const key = `${crypto.randomUUID()}.${ext}`;
	await bucket.put(key, imgBuffer, { httpMetadata: { contentType } });
	img.setAttribute('src', `/media/${key}`);
	img.removeAttribute('srcset');
	img.removeAttribute('sizes');
}

// Walk every <img> in the document, resolve its bytes via the supplied adapter,
// and upload+rewrite the ones that resolve. Failures are logged and skipped so a
// single bad image never sinks the whole article.
export async function rescueMedia(doc: any, resolveBytes: ResolveBytes, bucket: R2Bucket): Promise<void> {
	const images = Array.from(doc.querySelectorAll('img')) as any[];
	await Promise.all(images.map(async (img) => {
		const src = img.getAttribute('src');
		if (!src) return;
		try {
			const bytes = await resolveBytes(src);
			if (bytes) await uploadToR2(img, bytes.buffer, bytes.contentType, bucket);
		} catch (e) {
			console.error('Failed to process image:', src, e);
		}
	}));
}

// Pull the R2 object keys back out of a stored article's content so a delete can
// purge them. The reverse of the /media/<key> rewrite uploadToR2 performs.
// Returns deduped keys; safe on null/garbage content.
export function extractMediaKeys(content: string | null): string[] {
	if (!content) return [];
	const keys = new Set<string>();
	const re = /\/media\/([A-Za-z0-9._-]+)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(content)) !== null) {
		keys.add(match[1]);
	}
	return [...keys];
}

// Serve a stored media object with long-lived immutable caching, or null if the
// key isn't found (the caller decides how to render the 404).
export async function serveMedia(bucket: R2Bucket, key: string): Promise<Response | null> {
	const object = await bucket.get(key);
	if (!object) return null;

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set('etag', object.httpEtag);
	headers.set('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year

	return new Response(object.body, { headers });
}
