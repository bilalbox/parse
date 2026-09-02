import { createArticleStore } from './store';

// The summarization module. The model id, the prompt, the input truncation, and
// the Workers-AI response-shape handling live here and nowhere else — the knob
// the project keeps turning (which model summarizes) is changed in one place.
// Both ingest paths (the summarize endpoint and the email handler) cross this
// seam: hand it (id, text) and it generates a Summary, persists it, and returns
// it. The AI binding and the store sit behind the interface.

type SummarizeEnv = { AI: Ai; DB: D1Database };

// The model that turns Article text into a Summary. One line to change.
const SUMMARY_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

// Workers AI input cap — large Articles are truncated, not rejected.
const MAX_INPUT_CHARS = 15000;

const SYSTEM_PROMPT = 'You are an expert reading assistant producing concise, high-signal markdown summaries.';

function buildPrompt(textContent: string): string {
	return `Summarize the article/email below as a single, concise markdown bulleted list of exactly 3 to 5 key takeaways. Do not include any introductory or concluding text, headers, or sections. Just the bullets.

Content:
${textContent.slice(0, MAX_INPUT_CHARS)}`;
}

function readSummary(result: any): string | null {
	return result?.response || result?.choices?.[0]?.message?.content || result?.result || null;
}

// Generate a Summary for an Article, store it, and return it. Throws if the
// model returns no usable text — callers decide how to surface that (the
// endpoint 500s, the email handler logs).
export async function summarizeArticle(env: SummarizeEnv, id: string, textContent: string, userId: string): Promise<string> {
	const result = (await env.AI.run(SUMMARY_MODEL, {
		messages: [
			{ role: 'system', content: SYSTEM_PROMPT },
			{ role: 'user', content: buildPrompt(textContent) },
		],
		max_tokens: 400,
		temperature: 0.3,
	})) as any;

	const summary = readSummary(result);
	if (!summary) throw new Error('AI response did not contain a valid summary');

	await createArticleStore(env.DB, userId).saveSummary(id, summary);
	return summary;
}
