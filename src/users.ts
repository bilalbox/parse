import { encodeBase32LowerCaseNoPadding } from "@oslojs/encoding";

export interface User {
	id: string;
	google_id: string;
	email: string;
	email_alias: string;
	auto_summarize_emails?: number;
}

export interface Session {
	id: string;
	user_id: string;
	expires_at: number;
}

export function generateIdFromEntropySize(size: number): string {
	const bytes = crypto.getRandomValues(new Uint8Array(size));
	return encodeBase32LowerCaseNoPadding(bytes);
}

export async function getUserByGoogleId(db: D1Database, googleId: string): Promise<User | null> {
	return db.prepare('SELECT * FROM users WHERE google_id = ?').bind(googleId).first<User>();
}

export async function getUserByEmailAlias(db: D1Database, alias: string): Promise<User | null> {
	return db.prepare('SELECT * FROM users WHERE email_alias = ?').bind(alias).first<User>();
}

export async function createUser(db: D1Database, googleId: string, email: string): Promise<User> {
	const id = generateIdFromEntropySize(16);
	const email_alias = 'newsletters+' + generateIdFromEntropySize(10) + '@23p.dev';
	
	await db.prepare(
		`INSERT INTO users (id, google_id, email, email_alias, auto_summarize_emails, created_at) VALUES (?, ?, ?, ?, 1, datetime('now'))`
	).bind(id, googleId, email, email_alias).run();

	return { id, google_id: googleId, email, email_alias, auto_summarize_emails: 1 };
}

export async function createSession(db: D1Database, userId: string): Promise<Session> {
	const id = generateIdFromEntropySize(20);
	// 30 days expiry
	const expires_at = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
	
	await db.prepare(
		`INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`
	).bind(id, userId, expires_at).run();

	return { id, user_id: userId, expires_at };
}

export async function validateSessionToken(db: D1Database, sessionId: string): Promise<{ user: User; session: Session } | null> {
	const result = await db.prepare(`
		SELECT sessions.id as session_id, sessions.user_id, sessions.expires_at,
		       users.id as user_id, users.google_id, users.email, users.email_alias, users.auto_summarize_emails
		FROM sessions
		INNER JOIN users ON users.id = sessions.user_id
		WHERE sessions.id = ?
	`).bind(sessionId).first<any>();

	if (!result) return null;

	const session: Session = {
		id: result.session_id,
		user_id: result.user_id,
		expires_at: result.expires_at
	};
	const user: User = {
		id: result.user_id,
		google_id: result.google_id,
		email: result.email,
		email_alias: result.email_alias,
		auto_summarize_emails: result.auto_summarize_emails ?? 1
	};

	if (Date.now() / 1000 >= session.expires_at) {
		await db.prepare('DELETE FROM sessions WHERE id = ?').bind(session.id).run();
		return null;
	}

	// extend session if less than 15 days left
	if (Date.now() / 1000 >= session.expires_at - 60 * 60 * 24 * 15) {
		session.expires_at = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
		await db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(session.expires_at, session.id).run();
	}

	return { user, session };
}

export async function invalidateSession(db: D1Database, sessionId: string): Promise<void> {
	await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
}
