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

function sequenceAi(steps: Array<{ result?: unknown; error?: unknown }>) {
	const calls: { model: string; input: any }[] = [];
	let index = 0;
	const ai = {
		async run(model: string, input: any) {
			calls.push({ model, input });
			const step = steps[index++];
			if (step?.error) throw step.error;
			return step?.result;
		},
	};
	return { ai: ai as any, calls };
}

describe('summarizeArticle', () => {
	it('returns the summary, persists it, and feeds the text into the prompt', async () => {
		const { ai, calls } = fakeAi({ response: '- a point' });
		const { db, saved } = fakeDb();

		const summary = await summarizeArticle({ AI: ai, DB: db }, 'art-1', 'the article body', 'user-1');

		expect(summary).toBe('- a point');
		expect(saved).toEqual([{ id: 'art-1', summary: '- a point' }]);
		expect(calls[0].input.messages[1].content).toContain('the article body');
		expect(calls[0].input.messages[1].content).toContain('### Overview');
		expect(calls[0].input.messages[1].content).toContain('### Key Takeaways');
		expect(calls[0].input.messages[1].content).toContain('### Surprising & Actionable Insights');
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
			expect(await summarizeArticle({ AI: ai, DB: db }, 'id', 'text', 'user-1')).toBe(expected[i]);
		}
	});

	it('strips <think> reasoning tokens from the summary output', async () => {
		const { ai } = fakeAi({
			response: '<think>\nThinking through the article points...\n</think>\n### Overview\nA concise overview.',
		});
		const { db, saved } = fakeDb();

		const summary = await summarizeArticle({ AI: ai, DB: db }, 'art-1', 'content', 'user-1');
		expect(summary).toBe('### Overview\nA concise overview.');
		expect(saved[0].summary).toBe('### Overview\nA concise overview.');
	});

	it('truncates the input to 50000 chars before sending it to the model', async () => {
		const { ai, calls } = fakeAi({ response: 'ok' });
		const { db } = fakeDb();

		await summarizeArticle({ AI: ai, DB: db }, 'id', 'x'.repeat(60000), 'user-1');

		// The prompt wraps the (truncated) content: the 50000-char slice is
		// present, but the full 60000-char body is not.
		const userContent: string = calls[0].input.messages[1].content;
		expect(userContent).toContain('x'.repeat(50000));
		expect(userContent).not.toContain('x'.repeat(50001));
	});

	it('retries on transient errors (like 429 capacity) and succeeds on a subsequent attempt', async () => {
		const { ai, calls } = sequenceAi([
			{ error: new Error('3040: No more data centers to forward the request to') },
			{ result: { response: 'recovered summary' } },
		]);
		const { db, saved } = fakeDb();

		const summary = await summarizeArticle(
			{ AI: ai, DB: db },
			'art-retry',
			'content',
			'user-1',
			{ sleep: async () => {} }
		);

		expect(summary).toBe('recovered summary');
		expect(calls).toHaveLength(2);
		expect(saved).toEqual([{ id: 'art-retry', summary: 'recovered summary' }]);
	});

	it('retries when the model returns an invalid or empty response and succeeds on retry', async () => {
		const { ai, calls } = sequenceAi([
			{ result: { unexpected: 'shape' } },
			{ result: { response: 'valid on retry' } },
		]);
		const { db, saved } = fakeDb();

		const summary = await summarizeArticle(
			{ AI: ai, DB: db },
			'art-retry-empty',
			'content',
			'user-1',
			{ sleep: async () => {} }
		);

		expect(summary).toBe('valid on retry');
		expect(calls).toHaveLength(2);
		expect(saved).toEqual([{ id: 'art-retry-empty', summary: 'valid on retry' }]);
	});

	it('fails immediately without retrying on non-retryable client errors (e.g. 400 Bad Request)', async () => {
		const nonRetryable = Object.assign(new Error('5007: No such model'), { status: 400 });
		const { ai, calls } = sequenceAi([
			{ error: nonRetryable },
			{ result: { response: 'should not reach' } },
		]);
		const { db, saved } = fakeDb();

		await expect(
			summarizeArticle(
				{ AI: ai, DB: db },
				'art-fail',
				'content',
				'user-1',
				{ sleep: async () => {} }
			)
		).rejects.toThrow(/5007: No such model/);

		expect(calls).toHaveLength(1);
		expect(saved).toHaveLength(0);
	});

	it('exhausts all retries and throws the final error if transient failures persist', async () => {
		const { ai, calls } = sequenceAi([
			{ error: new Error('3007: Request timeout') },
			{ error: new Error('3007: Request timeout') },
			{ error: new Error('3007: Request timeout') },
		]);
		const { db, saved } = fakeDb();

		await expect(
			summarizeArticle(
				{ AI: ai, DB: db },
				'art-timeout',
				'content',
				'user-1',
				{ maxAttempts: 3, sleep: async () => {} }
			)
		).rejects.toThrow(/3007: Request timeout/);

		expect(calls).toHaveLength(3);
		expect(saved).toHaveLength(0);
	});
});
