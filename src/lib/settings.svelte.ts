class SettingsStore {
	theme = $state('dark');
	fontSize = $state(1.15);
	fontFamily = $state('sans'); // 'sans' | 'serif' | 'amiri' | 'cairo'
	isOnline = $state(true);
	einkMode = $state(false);
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
								localStorage.setItem('native_session', session);
								import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}));
								location.href = '/';
							}
						});
					});
				}
			});
			this.theme = localStorage.getItem('theme') || 'dark';
			const storedFontSize = localStorage.getItem('parse_font_size');
			if (storedFontSize) this.fontSize = parseFloat(storedFontSize);
			this.fontFamily = localStorage.getItem('parse_font_family') || 'sans';
			this.isOnline = navigator.onLine;
			this.einkMode = localStorage.getItem('parse_eink_mode') === 'true';

			// Add event listeners for online status
			window.addEventListener('online', () => { this.isOnline = true; });
			window.addEventListener('offline', () => { this.isOnline = false; });

			// Set initial theme attribute
			document.documentElement.setAttribute('data-theme', this.theme);
			document.documentElement.classList.toggle('eink-mode', this.einkMode);
		}
	}

	toggleEinkMode(): void {
		this.einkMode = !this.einkMode;
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_eink_mode', String(this.einkMode));
			document.documentElement.classList.toggle('eink-mode', this.einkMode);
		}
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
