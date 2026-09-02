import type { ContentLang } from './article-content';

class SettingsStore {
	theme = $state('dark');
	fontSize = $state(1.15);
	fontFamily = $state('sans'); // 'sans' | 'serif' | 'amiri' | 'cairo'
	isOnline = $state(true);
	einkMode = $state(false);
	confirmDeletes = $state(true);
	narrationSpeed = $state(1.0);
	// A voice preference is per content language, not per engine: the same
	// listener wants a different voice for an English and an Arabic Article.
	narrationVoices = $state<Record<ContentLang, string>>({ en: '', ar: '' });
	user = $state<any>(null);
	appVersion = $state(import.meta.env.VITE_APP_VERSION || 'dev');

	constructor() {
		if (typeof window !== 'undefined') {
			import('@capacitor/core').then(({ Capacitor }) => {
				if (Capacitor.isNativePlatform()) {
					import('@capacitor/app').then(({ App }) => {
						App.getInfo().then((info) => { this.appVersion = info.version; });
						// Google OAuth runs in the system browser (separate cookie jar), so the
						// callback hands the session back via this deep link instead of a cookie.
						App.addListener('appUrlOpen', ({ url }) => {
							const session = new URL(url).searchParams.get('session');
							if (session) {
								void this.setNativeSession(session).then(() => {
									import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}));
									location.href = '/';
								});
							}
						});
					});
					// Existing installs may only have localStorage — mirror into native prefs
					// so ShareActivity can authenticate without booting the WebView.
					const existing = localStorage.getItem('native_session');
					if (existing) void this.mirrorSessionToPreferences(existing);
				}
			});
			this.theme = localStorage.getItem('theme') || 'dark';
			const storedFontSize = localStorage.getItem('parse_font_size');
			if (storedFontSize) this.fontSize = parseFloat(storedFontSize);
			this.fontFamily = localStorage.getItem('parse_font_family') || 'sans';
			this.isOnline = navigator.onLine;
			this.einkMode = localStorage.getItem('parse_eink_mode') === 'true';
			// Default-on, so read it as "not explicitly turned off": the `=== 'true'`
			// shape used above would silently unset it for every existing install.
			this.confirmDeletes = localStorage.getItem('parse_confirm_deletes') !== 'false';
			// Keys predate this store; they keep their names so no install loses a
			// saved voice or listening pace.
			const storedSpeed = localStorage.getItem('tts_speed');
			if (storedSpeed) this.narrationSpeed = parseFloat(storedSpeed);
			this.narrationVoices = {
				en: localStorage.getItem('tts_voice_en') || '',
				ar: localStorage.getItem('tts_voice_ar') || ''
			};

			// Add event listeners for online status
			window.addEventListener('online', () => { this.isOnline = true; });
			window.addEventListener('offline', () => { this.isOnline = false; });

			// Set initial theme attribute
			document.documentElement.setAttribute('data-theme', this.theme);
			document.documentElement.classList.toggle('eink-mode', this.einkMode);
		}
	}

	/** Persist session for WebView authFetch and native ShareActivity. */
	async setNativeSession(session: string): Promise<void> {
		if (typeof window !== 'undefined') {
			localStorage.setItem('native_session', session);
		}
		await this.mirrorSessionToPreferences(session);
	}

	async clearNativeSession(): Promise<void> {
		if (typeof window !== 'undefined') {
			localStorage.removeItem('native_session');
		}
		try {
			const { Capacitor } = await import('@capacitor/core');
			if (!Capacitor.isNativePlatform()) return;
			const { Preferences } = await import('@capacitor/preferences');
			await Preferences.remove({ key: 'native_session' });
		} catch (err) {
			console.error('Failed to clear native session prefs', err);
		}
	}

	private async mirrorSessionToPreferences(session: string): Promise<void> {
		try {
			const { Capacitor } = await import('@capacitor/core');
			if (!Capacitor.isNativePlatform()) return;
			const { Preferences } = await import('@capacitor/preferences');
			await Preferences.set({ key: 'native_session', value: session });
		} catch (err) {
			console.error('Failed to mirror session to preferences', err);
		}
	}

	toggleEinkMode(): void {
		this.einkMode = !this.einkMode;
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_eink_mode', String(this.einkMode));
			document.documentElement.classList.toggle('eink-mode', this.einkMode);
		}
	}



	/** The voice saved for a content language, or '' if the listener has not chosen one. */
	narrationVoice(lang: ContentLang): string {
		return this.narrationVoices[lang] || '';
	}

	setNarrationVoice(lang: ContentLang, voiceName: string): void {
		this.narrationVoices = { ...this.narrationVoices, [lang]: voiceName };
		if (typeof window !== 'undefined') {
			localStorage.setItem(`tts_voice_${lang}`, voiceName);
		}
	}

	setNarrationSpeed(speed: number): void {
		this.narrationSpeed = speed;
		if (typeof window !== 'undefined') {
			localStorage.setItem('tts_speed', speed.toString());
		}
	}

	toggleConfirmDeletes(): void {
		this.confirmDeletes = !this.confirmDeletes;
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_confirm_deletes', String(this.confirmDeletes));
		}
	}

	/**
	 * The single gate every delete crosses — the library card and the reader both
	 * ask here, so the setting cannot be honoured in one place and forgotten in
	 * the other. Returns whether the caller should go ahead.
	 */
	confirmDelete(): boolean {
		if (!this.confirmDeletes) return true;
		if (typeof window === 'undefined') return false;
		return window.confirm('Delete this article permanently? This also removes its saved images and cannot be undone.');
	}

	toggleTheme() {
		const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
		this.theme = nextTheme;
		if (typeof window !== 'undefined') {
			localStorage.setItem('theme', nextTheme);
			document.documentElement.setAttribute('data-theme', nextTheme);
		}
	}

	setFontSize(size: number) {
		this.fontSize = Math.max(0.8, Math.min(2.5, size));
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_font_size', this.fontSize.toString());
		}
	}

	setFontFamily(family: string) {
		this.fontFamily = family;
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_font_family', family);
		}
	}

	async loadUser() {
		if (!this.isOnline) return;
		try {
			const res = await this.authFetch('/api/me');
			if (res.ok) {
				this.user = await res.json();
			}
		} catch (err) {
			console.error('Failed to load user', err);
		}
	}

	async updateUserSettings(auto_summarize_emails: boolean) {
		if (!this.isOnline) return;
		try {
			const res = await this.authFetch('/api/settings', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ auto_summarize_emails })
			});
			if (res.ok) {
				if (this.user) {
					this.user.auto_summarize_emails = auto_summarize_emails ? 1 : 0;
				}
			} else {
				throw new Error('Failed to update settings');
			}
		} catch (err) {
			console.error('Failed to update settings', err);
			throw err;
		}
	}

	// Helper to make authorized fetch calls
	async authFetch(url: string, options: RequestInit = {}): Promise<Response> {
		const headers = new Headers(options.headers || {});
		const nativeSession = typeof window !== 'undefined' ? localStorage.getItem('native_session') : null;
		if (nativeSession) headers.set('Authorization', `Bearer ${nativeSession}`);
		return fetch(url, { ...options, headers, credentials: 'include' });
	}
}

export const settings = new SettingsStore();
export type { SettingsStore };
