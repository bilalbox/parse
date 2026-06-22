class SettingsStore {
	token = $state('');
	serverUrl = $state('');
	theme = $state('dark');
	fontSize = $state(1.15);
	fontFamily = $state('sans'); // 'sans' | 'serif' | 'amiri' | 'cairo'
	isOnline = $state(true);
	deferredInstallPrompt = $state<any>(null);

	constructor() {
		if (typeof window !== 'undefined') {
			this.token = localStorage.getItem('parse_token') || '';
			this.serverUrl = localStorage.getItem('parse_server_url') || '';
			this.theme = localStorage.getItem('theme') || 'dark';
			const storedFontSize = localStorage.getItem('parse_font_size');
			if (storedFontSize) this.fontSize = parseFloat(storedFontSize);
			this.fontFamily = localStorage.getItem('parse_font_family') || 'sans';
			this.isOnline = navigator.onLine;

			// Add event listeners for online status
			window.addEventListener('online', () => { this.isOnline = true; });
			window.addEventListener('offline', () => { this.isOnline = false; });

			// Listen for PWA installation prompt
			window.addEventListener('beforeinstallprompt', (e) => {
				e.preventDefault();
				this.deferredInstallPrompt = e;
			});

			// Set initial theme attribute
			document.documentElement.setAttribute('data-theme', this.theme);
		}
	}

	saveToken(token: string) {
		this.token = token;
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_token', token);
			let fullUrl = '/api/auth/login';
			if (this.serverUrl) fullUrl = `${this.serverUrl}${fullUrl}`;
			fetch(fullUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token }),
				credentials: 'omit'
			}).catch(e => console.error('Failed to set auth cookie', e));
		}
	}

	saveServerUrl(url: string) {
		this.serverUrl = url.replace(/\/$/, ''); // Remove trailing slash if present
		if (typeof window !== 'undefined') {
			localStorage.setItem('parse_server_url', this.serverUrl);
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

	async installPWA() {
		if (this.deferredInstallPrompt) {
			this.deferredInstallPrompt.prompt();
			const { outcome } = await this.deferredInstallPrompt.userChoice;
			if (outcome === 'accepted') {
				this.deferredInstallPrompt = null;
			}
		}
	}

	// Helper to make authorized fetch calls
	async authFetch(url: string, options: RequestInit = {}): Promise<Response> {
		const headers = new Headers(options.headers || {});
		if (this.token) {
			headers.set('Authorization', `Bearer ${this.token}`);
		}

		let fullUrl = url;
		if (this.serverUrl && url.startsWith('/')) {
			fullUrl = `${this.serverUrl}${url}`;
		}

		return fetch(fullUrl, { ...options, headers, credentials: 'include' });
	}
}

export const settings = new SettingsStore();
export type { SettingsStore };
