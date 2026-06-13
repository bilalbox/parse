import { describe, it, expect } from 'vitest';
import { summarizeArticle } from '../src/summarize';

// Records the saveSummary write without touching D1. Satisfies the slice of the
// D1 interface createArticleStore().saveSummary uses: prepare().bind().run().
function fakeDb() {
	const saved: { id: string; summary: string }[] = [];
	const db = {
		prepare(_sql: string) {
			return {
				bind(summary: string, id: string) {
					return { async run() { saved.push({ id, summary }); } };
				},
			};
		},
	};
	return { db: db as any, saved };
}

// A fake Workers AI binding that returns a fixed result and records the input
// it was handed — lets us assert on the prompt the module builds.
function fakeAi(result: unknown) {
	const calls: { model: string; input: any }[] = [];
	const ai = {
		async run(model: string, input: any) {
			calls.push({ model, input });
			return result;
		},
	};
	return { ai: ai as any, calls };
}

describe('summarizeArticle', () => {
	it('returns the summary, persists it, and feeds the text into the prompt', async () => {
		const { ai, calls } = fakeAi({ response: '- a point' });
		const { db, saved } = fakeDb();

		const summary = await summarizeArticle({ AI: ai, DB: db }, 'art-1', 'the article body');

		expect(summary).toBe('- a point');
		expect(saved).toEqual([{ id: 'art-1', summary: '- a point' }]);
		expect(calls[0].input.messages[1].content).toContain('the article body');
	});

	it('reads the summary from any of the known response shapes', async () => {
		const shapes = [
			{ response: 'from response' },
			{ choices: [{ message: { content: 'from choices' } }] },
			{ result: 'from result' },
		];
		const expected = ['from response', 'from choices', 'from result'];

		for (let i = 0; i < shapes.length; i++) {
			const { ai } = fakeAi(shapes[i]);
			const { db } = fakeDb();
			expect(await summarizeArticle({ AI: ai, DB: db }, 'id', 'text')).toBe(expected[i]);
		}
	});

	it('truncates the input to 15000 chars before sending it to the model', async () => {
		const { ai, calls } = fakeAi({ response: 'ok' });
		const { db } = fakeDb();

		await summarizeArticle({ AI: ai, DB: db }, 'id', 'x'.repeat(20000));

		// The prompt wraps the (truncated) content: the 15000-char slice is
		// present, but the full 20000-char body is not.
		const userContent: string = calls[0].input.messages[1].content;
		expect(userContent).toContain('x'.repeat(15000));
		expect(userContent).not.toContain('x'.repeat(15001));
	});

	it('throws and does not persist when the model returns no usable text', async () => {
		const { ai } = fakeAi({ unexpected: 'shape' });
		const { db, saved } = fakeDb();

		await expect(summarizeArticle({ AI: ai, DB: db }, 'id', 'text')).rejects.toThrow(/valid summary/);
		expect(saved).toHaveLength(0);
	});
});
