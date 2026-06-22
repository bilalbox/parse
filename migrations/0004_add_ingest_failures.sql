-- Migration number: 0004 	 2026-06-22T01:24:49.000Z
CREATE TABLE IF NOT EXISTS ingest_failures (
    id TEXT PRIMARY KEY,
    url_or_subject TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
