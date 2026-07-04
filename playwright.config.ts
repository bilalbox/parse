import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: 'html',
	use: {
		trace: 'on-first-retry',
		baseURL: 'http://localhost:8787',
		serviceWorkers: 'block',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'Mobile Chrome',
			use: { ...devices['Pixel 5'] },
		}
	],
	webServer: {
		command: 'pnpm run build && pnpm run dev',
		url: 'http://localhost:8787',
		reuseExistingServer: !process.env.CI,
	},
});
