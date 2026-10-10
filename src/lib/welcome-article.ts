/**
 * Welcome tutorial article bundled with Parse.
 * Provides an immediate, zero-friction introduction to Parse's reading view,
 * sentence-by-sentence narration, and AI summaries.
 */
export const WELCOME_ARTICLE = {
	id: 'welcome',
	title: 'Welcome to Parse: Distraction-Free Reading & Listening',
	author: 'The Parse Team',
	url: 'https://parse.23p.dev/welcome',
	source_type: 'web',
	unsubscribe_link: null,
	unsubscribe_one_click: 0,
	archived: 0,
	published: '2026-10-10',
	word_count: 360,
	summary: `### Quick Summary\n- **Clean Reading**: Web pages and newsletters stripped of ads, tracking, and noisy layouts.\n- **On-Device Narration**: Tap Play above to listen with live sentence highlighting and click-to-jump.\n- **Gestures & Offline**: Swipe left to archive, swipe right to delete. All articles and images cache offline automatically.`,
	content: JSON.stringify({
		title: 'Welcome to Parse: Distraction-Free Reading & Listening',
		byline: 'The Parse Team',
		content: `
			<p>Welcome to <strong>Parse</strong> — your personal edge-reading sanctuary designed to turn cluttered web pages and inbound newsletters into clean, distraction-free reading.</p>
			
			<h2>How Parse Works</h2>
			<p>Every article you save flows through an extraction engine that strips away cookie banners, sticky headers, ads, and tracking scripts, leaving behind only the pure prose and imagery.</p>

			<h2>1. On-Device Narration</h2>
			<p>Tap the <strong>Play</strong> button in the header above to start narration. Synthesis runs on-device sentence-by-sentence, highlighting the active phrase in real time. If you want to skip ahead, simply tap any sentence in the article to jump playback directly there.</p>

			<h2>2. Instant AI Summaries</h2>
			<p>Short on time? Tap the <strong>Sparkle</strong> icon above to generate a concise summary highlighting core takeaways, surprises, and actionable tools.</p>

			<h2>3. Ingesting Newsletters</h2>
			<p>You have a private email alias in <strong>Settings</strong> (tap the gear icon on the home screen). Subscribe to any Substack or newsletter with that address, and new issues will automatically land in your library ready to read.</p>

			<h2>4. Gestures & Offline</h2>
			<p>On your library screen, swipe left to archive an article and swipe right to delete. Every article and image is saved locally, so your library remains completely accessible offline and on e-ink devices like the Supernote Manta.</p>

			<p>Enjoy reading!</p>
		`,
		textContent: 'Welcome to Parse — your personal edge-reading sanctuary designed to turn cluttered web pages and inbound newsletters into clean, distraction-free reading. Every article you save flows through an extraction engine that strips away cookie banners, sticky headers, ads, and tracking scripts, leaving behind only the pure prose and imagery. Tap the Play button in the header above to start narration. Synthesis runs on-device sentence-by-sentence, highlighting the active phrase in real time. If you want to skip ahead, simply tap any sentence in the article to jump playback directly there. Short on time? Tap the Sparkle icon above to generate a concise summary highlighting core takeaways, surprises, and actionable tools. You have a private email alias in Settings. Subscribe to any Substack or newsletter with that address, and new issues will automatically land in your library ready to read. On your library screen, swipe left to archive an article and swipe right to delete. Every article and image is saved locally, so your library remains completely accessible offline and on e-ink devices. Enjoy reading!'
	})
};
