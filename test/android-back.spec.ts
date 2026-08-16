import { afterEach, describe, expect, it } from 'vitest';
import {
	EXIT_CONFIRM_MS,
	createAndroidBackHandler,
	decideAndroidBack,
	registerBackOverlay
} from '../src/lib/android-back';

describe('Android hardware back', () => {
	const unregisters: Array<() => void> = [];

	afterEach(() => {
		while (unregisters.length) unregisters.pop()?.();
	});

	it('leaves an Article for the library instead of walking history', () => {
		expect(decideAndroidBack('/article/abc', null, 0)).toBe('go-home');
	});

	it('asks for a second back on the library, then exits if the second is quick', () => {
		expect(decideAndroidBack('/', null, 1000)).toBe('confirm-exit');
		expect(decideAndroidBack('/', 1000, 1000 + EXIT_CONFIRM_MS - 1)).toBe('exit');
	});

	it('starts a new confirm window if the second library back is too slow', () => {
		expect(decideAndroidBack('/', 1000, 1000 + EXIT_CONFIRM_MS)).toBe('confirm-exit');
	});

	it('treats login as an exit surface so back does not bounce through the library', () => {
		expect(decideAndroidBack('/login', null, 0)).toBe('confirm-exit');
	});

	it('dismisses the top overlay before leaving an Article or exiting', () => {
		const calls: string[] = [];
		unregisters.push(registerBackOverlay(() => {
			calls.push('sheet');
			return true;
		}));

		const handle = createAndroidBackHandler({
			goHome: () => { calls.push('home'); },
			confirmExit: () => { calls.push('confirm'); },
			exitApp: () => { calls.push('exit'); }
		});

		handle('/article/abc');
		expect(calls).toEqual(['sheet']);
	});

	it('does not count leaving an Article as the first of two exit backs', () => {
		const calls: string[] = [];
		const handle = createAndroidBackHandler({
			goHome: () => { calls.push('home'); },
			confirmExit: () => { calls.push('confirm'); },
			exitApp: () => { calls.push('exit'); },
			now: () => 5000
		});

		handle('/article/abc');
		handle('/');
		expect(calls).toEqual(['home', 'confirm']);
	});
});
