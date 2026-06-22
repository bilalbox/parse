CREATE TABLE IF NOT EXISTS invites (
    email TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME,
    used_by TEXT REFERENCES users(id)
);
