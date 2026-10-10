import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig, type Plugin } from 'vitest/config';

const APP_CSS_ID = 'virtual:app-css';

const appCssAsText: Plugin = {
	name: 'app-css-as-text',
	resolveId(id) {
		return id === APP_CSS_ID ? `\0${APP_CSS_ID}` : null;
	},
	load(id) {
		if (id !== `\0${APP_CSS_ID}`) return null;
		const path = fileURLToPath(new URL('./src/app.css', import.meta.url));
		return `export default ${JSON.stringify(readFileSync(path, 'utf8'))};`;
	}
};

export default defineConfig({
	plugins: [appCssAsText, svelte(), cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
	test: {
		include: ['test/**/*.spec.ts'],
	}
});
