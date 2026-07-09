// Article-card metadata formatting, shared by the library list and the reader.

// "N min read" estimate. 150 wpm is a deliberately slow prose pace so the
// number reads as a floor, not a boast; min 1 so short pieces aren't "0 min".
export const readMinutes = (words: number) => Math.max(1, Math.round(words / 150));

// toLocaleDateString, but null (not "Invalid Date") when the string won't
// parse — `published` comes from external sources (Defuddle / email headers)
// and isn't guaranteed to be a date JS can read.
export function formatDate(s: string | null | undefined): string | null {
	if (!s) return null;
	const d = new Date(s);
	return isNaN(d.getTime()) ? null : d.toLocaleDateString();
}
