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
const MAX_INPUT_CHARS = 50000;

const SYSTEM_PROMPT =
	'You are an expert reading assistant and executive analyst producing high-signal, detailed markdown summaries that capture both core ideas and non-obvious nuances.';

function buildPrompt(textContent: string): string {
	return `Summarize the article/email below in clean markdown according to the following structure:

### Overview
A concise 1 to 2 sentence orientation establishing the article's core premise, primary thesis, or essential context.

### Key Takeaways
3 to 5 detailed bullet points capturing the core arguments, evidence, findings, or mechanisms. Explain the "why" and "how" with sufficient depth and detail rather than brief surface-level mentions. Use bold lead-ins for each bullet (e.g., "- **Key Concept**: Detailed explanation...").

### Surprising & Actionable Insights
2 to 3 bullet points highlighting counter-intuitive insights, unexpected data points, subtle nuances, or concrete actionable takeaways and practical applications. Use bold lead-ins for each bullet.

Formatting rules:
- Provide ONLY the markdown sections above.
- Do NOT include conversational pleasantries, introductory chatter, or sign-offs (e.g. "Here is a summary...", "Hope this helps!").

Content:
${textContent.slice(0, MAX_INPUT_CHARS)}`;
}

export function readSummary(result: any): string | null {
	const raw = result?.response || result?.choices?.[0]?.message?.content || result?.result || null;
	if (typeof raw !== 'string') return null;
	const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
	return cleaned || null;
}

export function isRetryableError(error: any): boolean {
	if (!error) return true;
	const msg = String(error?.message || error);
	// Known non-retryable errors (client error, model not found, unauthorized, terms unaccepted, request too large)
	if (error?.status === 400 || error?.status === 401 || error?.status === 403 || error?.status === 413) {
		return false;
	}
	if (/\b(400|401|403|413|5007|5004|3039|3003|5018|3041|5016|3023|5035)\b/.test(msg)) {
		return false;
	}
	// Transient errors: 429 (out of capacity 3040, rate limit), 408 (timeout 3007), 500, 502, 503, 504, network drops, empty responses
	return true;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type SummarizeOptions = {
	maxAttempts?: number;
	baseDelayMs?: number;
	backoffFactor?: number;
	sleep?: (ms: number) => Promise<void>;
};

// Generate a Summary for an Article, store it, and return it. Retries up to
// maxAttempts times on transient Workers AI errors with exponential backoff.
// Callers decide how to surface ultimate failures (the endpoint 500s, the email handler logs).
export async function summarizeArticle(
	env: SummarizeEnv,
	id: string,
	textContent: string,
	userId: string,
	options?: SummarizeOptions
): Promise<string> {
	const maxAttempts = options?.maxAttempts ?? 3;
	const baseDelayMs = options?.baseDelayMs ?? 1000;
	const backoffFactor = options?.backoffFactor ?? 2;
	const sleep = options?.sleep ?? defaultSleep;

	let lastError: any = null;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			const result = (await env.AI.run(SUMMARY_MODEL, {
				messages: [
					{ role: 'system', content: SYSTEM_PROMPT },
					{ role: 'user', content: buildPrompt(textContent) },
				],
				max_tokens: 1500,
				temperature: 0.3,
			})) as any;

			const summary = readSummary(result);
			if (!summary) {
				throw new Error('AI response did not contain a valid summary');
			}

			await createArticleStore(env.DB, userId).saveSummary(id, summary);
			return summary;
		} catch (err: any) {
			lastError = err;
			const isRetryable = isRetryableError(err);
			const hasMoreAttempts = attempt < maxAttempts;

			if (!isRetryable || !hasMoreAttempts) {
				console.error(`Summarization attempt ${attempt}/${maxAttempts} failed permanently:`, err?.message || err);
				break;
			}

			const jitter = 0.8 + Math.random() * 0.4;
			const delayMs = Math.round(baseDelayMs * Math.pow(backoffFactor, attempt - 1) * jitter);
			console.warn(`Summarization attempt ${attempt}/${maxAttempts} failed: ${err?.message || err}. Retrying in ${delayMs}ms...`);
			await sleep(delayMs);
		}
	}

	throw lastError || new Error('Failed to generate summary after retries');
}
