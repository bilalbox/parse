import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Library, type LibraryClient, type ArticleListItem, presentUnsubscribeOutcome } from '../src/lib/Library.svelte';
import { settings } from '../src/lib/settings.svelte';
import { toast } from '../src/lib/toast.svelte';

function fakeArticle(id: string, title: string, archived = 0): ArticleListItem {
	return {
		id,
		title,
		author: 'Author',
		url: `https://example.com/${id}`,
		unsubscribe_link: null,
		archived,
		published: '2026-09-01',
		word_count: 500,
		created_at: '2026-09-01T00:00:00Z',
	};
}

describe('Library', () => {
	let client: LibraryClient;
	let items: ArticleListItem[];

	beforeEach(() => {
		settings.isOnline = true;
		items = [
			fakeArticle('1', 'First Article'),
			fakeArticle('2', 'Second Article'),
			fakeArticle('3', 'Third Article'),
		];

		client = {
			fetchList: vi.fn(async (_filter) => [...items]),
			search: vi.fn(async (q) => items.filter(a => a.title.toLowerCase().includes(q.toLowerCase()))),
			archive: vi.fn(async (_id, _archived) => {}),
			delete: vi.fn(async (_id) => {}),
			queue: vi.fn(async (_url) => {}),
			unsubscribe: vi.fn(async (_id) => ({ action: 'one-click', ok: true })),
		};
	});

	describe('loading and listing', () => {
		it('populates articles list and derives filteredList', async () => {
			const lib = new Library(client);
			await lib.load();

			expect(client.fetchList).toHaveBeenCalledWith('active');
			expect(lib.articles).toHaveLength(3);
			expect(lib.filteredList).toHaveLength(3);
			expect(lib.loading).toBe(false);
			expect(lib.error).toBeNull();
		});

		it('records error when client fails to fetch', async () => {
			const failClient = {
				...client,
				fetchList: vi.fn(async () => { throw new Error('Network error'); })
			};
			const lib = new Library(failClient);
			await lib.load();

			expect(lib.error).toBeInstanceOf(Error);
			expect(lib.error?.message).toBe('Network error');
			expect(lib.loading).toBe(false);
		});
	});

	describe('intake (add)', () => {
		it('queues url and triggers reload', async () => {
			vi.useFakeTimers();
			const lib = new Library(client);
			await lib.load();

			await lib.add('https://example.com/new-post');
			expect(client.queue).toHaveBeenCalledWith('https://example.com/new-post');

			vi.runAllTimers();
			expect(client.fetchList).toHaveBeenCalledTimes(2);
			vi.useRealTimers();
		});

		it('rejects when offline', async () => {
			settings.isOnline = false;
			const lib = new Library(client);
			await expect(lib.add('https://example.com')).rejects.toThrow('Cannot parse new URLs while offline.');
		});
	});

	describe('archiving', () => {
		it('updates archive status and reloads list', async () => {
			const lib = new Library(client);
			await lib.load();

			await lib.archive('1', true);
			expect(client.archive).toHaveBeenCalledWith('1', true);
			expect(client.fetchList).toHaveBeenCalledTimes(2);
		});

		it('rejects when offline', async () => {
			settings.isOnline = false;
			const lib = new Library(client);
			await expect(lib.archive('1', true)).rejects.toThrow('Cannot archive while offline.');
		});
	});

	describe('deletion and rollback', () => {
		it('optimistically removes item and performs backend delete', async () => {
			const lib = new Library(client);
			await lib.load();

			await lib.delete('2');
			expect(client.delete).toHaveBeenCalledWith('2');
			expect(lib.articles.find(a => a.id === '2')).toBeUndefined();
		});

		it('rolls back optimistic deletion if backend delete fails', async () => {
			const failDeleteClient = {
				...client,
				delete: vi.fn(async () => { throw new Error('Delete failed'); })
			};
			const lib = new Library(failDeleteClient);
			await lib.load();

			await expect(lib.delete('2')).rejects.toThrow('Delete failed');
			// Item 2 restored at index 1
			expect(lib.articles).toHaveLength(3);
			expect(lib.articles[1].id).toBe('2');
		});
	});

	describe('unsubscribing', () => {
		it('returns typed outcome from client', async () => {
			const lib = new Library(client);
			const outcome = await lib.unsubscribe('1');
			expect(outcome).toEqual({ action: 'one-click', ok: true });
		});

		it('rejects when offline', async () => {
			settings.isOnline = false;
			const lib = new Library(client);
			await expect(lib.unsubscribe('1')).rejects.toThrow('Cannot unsubscribe while offline.');
		});

		it('presents outcome via toast notifications', () => {
			const showSpy = vi.spyOn(toast, 'show').mockImplementation(() => {});
			const showLinkSpy = vi.spyOn(toast, 'showLink').mockImplementation(() => {});

			presentUnsubscribeOutcome({ action: 'one-click', ok: true });
			expect(showSpy).toHaveBeenCalledWith('Unsubscribe request sent ✓');

			presentUnsubscribeOutcome({ action: 'mailto', link: 'mailto:unsub@example.com' });
			expect(showLinkSpy).toHaveBeenCalledWith('Send unsubscribe email via', 'Mail Client', 'mailto:unsub@example.com');

			presentUnsubscribeOutcome({ action: 'open', link: 'https://example.com/unsub' });
			expect(showLinkSpy).toHaveBeenCalledWith('Open unsubscribe page:', 'Unsubscribe Link', 'https://example.com/unsub');
		});
	});
});
