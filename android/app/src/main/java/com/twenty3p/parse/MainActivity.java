package com.twenty3p.parse;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private String pendingShareText;

    @Override
    protected void onNewIntent(Intent intent) {
        if (handleShareIntent(intent)) {
            return;
        }
        super.onNewIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        deliverPendingShare();
    }

    private boolean handleShareIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return false;
        }

        String text = extractSharedText(intent);
        if (text == null || text.isEmpty()) {
            return false;
        }

        pendingShareText = text;
        // Prevent the same share intent from being reprocessed on activity recreation.
        setIntent(new Intent(intent).setAction(Intent.ACTION_MAIN));
        deliverPendingShare();
        return true;
    }

    private String extractSharedText(Intent intent) {
        String type = intent.getType();
        if (type != null && !type.startsWith("text/")) {
            return null;
        }

        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null || text.isEmpty()) {
            CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
            if (subject != null) {
                text = subject.toString();
            }
        }

        Uri stream = android.os.Build.VERSION.SDK_INT >= 33
            ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
            : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if ((text == null || text.isEmpty()) && stream != null) {
            text = stream.toString();
        }

        return text;
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
