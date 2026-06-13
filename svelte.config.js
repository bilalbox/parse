import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'public',
			assets: 'public',
			fallback: 'index.html', // Serves as the SPA fallback page
			precompress: false,
			strict: true
		}),
		alias: {
			$lib: './src/lib'
		}
	}
};

export default config;
