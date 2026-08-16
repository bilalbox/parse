export const EXIT_CONFIRM_MS = 2000;

export type AndroidBackAction = 'go-home' | 'confirm-exit' | 'exit';

const overlayClosers: Array<() => boolean> = [];

/** True on the library (and login): back should confirm, then exit — never walk history. */
function isExitSurface(pathname: string): boolean {
	return pathname === '/' || pathname === '' || pathname === '/login';
}

/**
 * Hardware-back policy for the Android app.
 * Article (and other inner routes) → library. Library → confirm, then exit if pressed again quickly.
 * Never `history.back()`: that reopens Articles already archived or deleted.
 */
export function decideAndroidBack(
	pathname: string,
	lastConfirmAt: number | null,
	now: number
): AndroidBackAction {
	if (!isExitSurface(pathname)) return 'go-home';
	if (lastConfirmAt !== null && now - lastConfirmAt < EXIT_CONFIRM_MS) return 'exit';
	return 'confirm-exit';
}

/** Register a closer for an open overlay (sheet, modal, viewer). Returns unregister. */
export function registerBackOverlay(closer: () => boolean): () => void {
	overlayClosers.push(closer);
	return () => {
		const i = overlayClosers.lastIndexOf(closer);
		if (i !== -1) overlayClosers.splice(i, 1);
	};
}

export function dismissBackOverlay(): boolean {
	for (let i = overlayClosers.length - 1; i >= 0; i--) {
		if (overlayClosers[i]()) return true;
	}
	return false;
}

export function createAndroidBackHandler(deps: {
	goHome: () => void | Promise<void>;
	confirmExit: () => void;
	exitApp: () => void | Promise<void>;
	now?: () => number;
}): (pathname: string) => void {
	let lastConfirmAt: number | null = null;
	const now = () => (deps.now ?? Date.now)();

	return (pathname: string) => {
		if (dismissBackOverlay()) return;

		const action = decideAndroidBack(pathname, lastConfirmAt, now());
		if (action === 'go-home') {
			lastConfirmAt = null;
			void deps.goHome();
			return;
		}
		if (action === 'confirm-exit') {
			lastConfirmAt = now();
			deps.confirmExit();
			return;
		}
		void deps.exitApp();
	};
}
