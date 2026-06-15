import "./internal.js";
//#region src/lib/settings.svelte.ts
var SettingsStore = class {
	token = "";
	serverUrl = "";
	theme = "dark";
	fontSize = 1.15;
	fontFamily = "sans";
	isOnline = true;
	deferredInstallPrompt = null;
	constructor() {
		if (typeof window !== "undefined") {
			this.token = localStorage.getItem("parse_token") || "";
			this.serverUrl = localStorage.getItem("parse_server_url") || "";
			this.theme = localStorage.getItem("theme") || "dark";
			const storedFontSize = localStorage.getItem("parse_font_size");
			if (storedFontSize) this.fontSize = parseFloat(storedFontSize);
			this.fontFamily = localStorage.getItem("parse_font_family") || "sans";
			this.isOnline = navigator.onLine;
			window.addEventListener("online", () => {
				this.isOnline = true;
			});
			window.addEventListener("offline", () => {
				this.isOnline = false;
			});
			window.addEventListener("beforeinstallprompt", (e) => {
				e.preventDefault();
				this.deferredInstallPrompt = e;
			});
			document.documentElement.setAttribute("data-theme", this.theme);
		}
	}
	saveToken(token) {
		this.token = token;
		if (typeof window !== "undefined") localStorage.setItem("parse_token", token);
	}
	saveServerUrl(url) {
		this.serverUrl = url.replace(/\/$/, "");
		if (typeof window !== "undefined") localStorage.setItem("parse_server_url", this.serverUrl);
	}
	toggleTheme() {
		const nextTheme = this.theme === "dark" ? "light" : "dark";
		this.theme = nextTheme;
		if (typeof window !== "undefined") {
			localStorage.setItem("theme", nextTheme);
			document.documentElement.setAttribute("data-theme", nextTheme);
		}
	}
	setFontSize(size) {
		this.fontSize = Math.max(.8, Math.min(2.5, size));
		if (typeof window !== "undefined") localStorage.setItem("parse_font_size", this.fontSize.toString());
	}
	setFontFamily(family) {
		this.fontFamily = family;
		if (typeof window !== "undefined") localStorage.setItem("parse_font_family", family);
	}
	async installPWA() {
		if (this.deferredInstallPrompt) {
			this.deferredInstallPrompt.prompt();
			const { outcome } = await this.deferredInstallPrompt.userChoice;
			if (outcome === "accepted") this.deferredInstallPrompt = null;
		}
	}
	async authFetch(url, options = {}) {
		const headers = new Headers(options.headers || {});
		if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
		let fullUrl = url;
		if (this.serverUrl && url.startsWith("/")) fullUrl = `${this.serverUrl}${url}`;
		const delimiter = fullUrl.includes("?") ? "&" : "?";
		const finalUrl = this.token ? `${fullUrl}${delimiter}token=${this.token}` : fullUrl;
		return fetch(finalUrl, {
			...options,
			headers
		});
	}
};
var settings = new SettingsStore();
//#endregion
export { settings as t };
