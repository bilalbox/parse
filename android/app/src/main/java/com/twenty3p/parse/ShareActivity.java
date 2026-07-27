package com.twenty3p.parse;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Fire-and-forget share target: queue the URL with a stored session and finish,
 * without booting the Capacitor WebView on the happy path.
 */
public class ShareActivity extends Activity {
	private static final String PREFS_GROUP = "CapacitorStorage";
	private static final String SESSION_KEY = "native_session";
	private static final Pattern URL_PATTERN = Pattern.compile("https?://\\S+");
	private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);

		Intent intent = getIntent();
		if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
			finish();
			return;
		}

		String sharedText = extractSharedText(intent);
		String sharedUrl = extractUrl(sharedText);
		if (sharedUrl == null) {
			Toast.makeText(getApplicationContext(), "No link to save", Toast.LENGTH_SHORT).show();
			finish();
			return;
		}

		String session = readSession();
		if (session == null || session.isEmpty()) {
			openAppForAuth(sharedText != null ? sharedText : sharedUrl);
			return;
		}

		EXECUTOR.execute(() -> queueAndFinish(sharedUrl, sharedText != null ? sharedText : sharedUrl, session));
	}

	private void queueAndFinish(String url, String fallbackShareText, String session) {
		try {
			QueueResult result = postQueue(url, session);
			runOnUiThread(() -> {
				if (result.status == 401) {
					clearSession();
					openAppForAuth(fallbackShareText);
					return;
				}
				if (result.ok) {
					Toast.makeText(getApplicationContext(), "Saved to Parse", Toast.LENGTH_SHORT).show();
					finish();
					return;
				}
				String msg = result.error != null && !result.error.isEmpty()
					? result.error
					: "Couldn't save link";
				Toast.makeText(getApplicationContext(), msg, Toast.LENGTH_SHORT).show();
				finish();
			});
		} catch (Exception e) {
			runOnUiThread(() -> {
				Toast.makeText(getApplicationContext(), "Couldn't save link", Toast.LENGTH_SHORT).show();
				finish();
			});
		}
	}

	private QueueResult postQueue(String articleUrl, String session) throws Exception {
		URL endpoint = new URL(getString(R.string.api_base_url) + "/api/queue");
		HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
		try {
			conn.setConnectTimeout(15000);
			conn.setReadTimeout(15000);
			conn.setRequestMethod("POST");
			conn.setDoOutput(true);
			conn.setRequestProperty("Content-Type", "application/json");
			conn.setRequestProperty("Authorization", "Bearer " + session);
			conn.setRequestProperty("User-Agent", "ParseAndroidApp");

			byte[] body = ("{\"url\":" + jsonString(articleUrl) + "}").getBytes(StandardCharsets.UTF_8);
			conn.setFixedLengthStreamingMode(body.length);
			try (OutputStream os = conn.getOutputStream()) {
				os.write(body);
			}

			int status = conn.getResponseCode();
			InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
			String responseBody = readBody(stream);
			if (status >= 200 && status < 300) {
				return QueueResult.ok();
			}
			return QueueResult.fail(status, extractError(responseBody));
		} finally {
			conn.disconnect();
		}
	}

	private static String readBody(InputStream stream) throws Exception {
		if (stream == null) return "";
		StringBuilder sb = new StringBuilder();
		try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
			String line;
			while ((line = reader.readLine()) != null) {
				sb.append(line);
			}
		}
		return sb.toString();
	}

	private static String extractError(String body) {
		if (body == null || body.isEmpty()) return null;
		Matcher m = Pattern.compile("\"error\"\\s*:\\s*\"([^\"]+)\"").matcher(body);
		if (m.find()) return m.group(1);
		return null;
	}

	private static String jsonString(String value) {
		String escaped = value
			.replace("\\", "\\\\")
			.replace("\"", "\\\"")
			.replace("\n", "\\n")
			.replace("\r", "\\r")
			.replace("\t", "\\t");
		return "\"" + escaped + "\"";
	}

	private String readSession() {
		SharedPreferences prefs = getSharedPreferences(PREFS_GROUP, MODE_PRIVATE);
		return prefs.getString(SESSION_KEY, null);
	}

	private void clearSession() {
		getSharedPreferences(PREFS_GROUP, MODE_PRIVATE).edit().remove(SESSION_KEY).apply();
	}

	private void openAppForAuth(String shareText) {
		Toast.makeText(getApplicationContext(), "Sign in to Parse to save links", Toast.LENGTH_SHORT).show();
		Intent i = new Intent(this, MainActivity.class);
		i.putExtra(MainActivity.EXTRA_SHARE_TEXT, shareText);
		i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
		startActivity(i);
		finish();
	}

	private static String extractSharedText(Intent intent) {
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

	private static String extractUrl(String text) {
		if (text == null || text.isEmpty()) return null;
		Matcher m = URL_PATTERN.matcher(text.trim());
		if (m.find()) {
			return m.group().replaceAll("[\\.,;:!\\)?\\]]+$", "");
		}
		String trimmed = text.trim();
		if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
			return trimmed;
		}
		return null;
	}

	private static final class QueueResult {
		final boolean ok;
		final int status;
		final String error;

		private QueueResult(boolean ok, int status, String error) {
			this.ok = ok;
			this.status = status;
			this.error = error;
		}

		static QueueResult ok() {
			return new QueueResult(true, 200, null);
		}

		static QueueResult fail(int status, String error) {
			return new QueueResult(false, status, error);
		}
	}
}
