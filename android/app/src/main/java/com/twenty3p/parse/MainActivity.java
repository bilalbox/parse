package com.twenty3p.parse;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	public static final String EXTRA_SHARE_TEXT = "share_text";

	private String pendingShareText;

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);
		captureShareExtra(intent);
	}

	@Override
	public void onResume() {
		super.onResume();
		captureShareExtra(getIntent());
		deliverPendingShare();
	}

	private void captureShareExtra(Intent intent) {
		if (intent == null || !intent.hasExtra(EXTRA_SHARE_TEXT)) {
			return;
		}
		String text = intent.getStringExtra(EXTRA_SHARE_TEXT);
		intent.removeExtra(EXTRA_SHARE_TEXT);
		if (text != null && !text.isEmpty()) {
			pendingShareText = text;
		}
	}

	private void deliverPendingShare() {
		if (pendingShareText == null || getBridge() == null) {
			return;
		}

		String text = pendingShareText;
		pendingShareText = null;

		String baseUrl = getBridge().getServerUrl();
		if (baseUrl == null || baseUrl.isEmpty()) {
			baseUrl = getBridge().getLocalUrl();
		}
		// Relative paths resolve to file:// in WebView; use the Capacitor server origin.
		String url = Uri.parse(baseUrl)
			.buildUpon()
			.appendPath("share")
			.appendQueryParameter("text", text)
			.build()
			.toString();

		getBridge().getWebView().post(() -> getBridge().getWebView().loadUrl(url));
	}
}
