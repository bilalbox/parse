import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Parse Worker Router Tests", () => {
	describe("api authentication protection", () => {
		it("responds with 401 for unauthorized api requests", async () => {
			const request = new Request("http://example.com/api/articles");
			const response = await SELF.fetch(request);
			expect(response.status).toBe(401);
		});
	});
});
