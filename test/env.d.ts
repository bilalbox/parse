declare module "cloudflare:test" {
	interface ProvidedEnv extends Env {}
}

// Served by the `app-css-as-text` plugin in vitest.config.mts: app.css as a
// string, so the Rescue class-name guard can read the one consumer that cannot
// import the contract.
declare module 'virtual:app-css' {
	const css: string;
	export default css;
}
