/**
 * Opens a URL outside the app WebView. Anchor `target="_blank"` clicks route
 * through the WebView's new-window path, which the app's WebViewClient never
 * implements — the OS browser intent fires with no URL attached. Capacitor's
 * Browser plugin opens a Custom Tab directly, sidestepping that path.
 */
export async function openExternal(url: string): Promise<void> {
	if (typeof window === 'undefined') return;
	if (!url.startsWith('http')) {
		// mailto:, etc. — a plain top-level navigation, not the new-window path Browser.open works around.
		window.location.href = url;
		return;
	}
	const { Capacitor } = await import('@capacitor/core');
	if (Capacitor.isNativePlatform()) {
		const { Browser } = await import('@capacitor/browser');
		await Browser.open({ url });
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}
