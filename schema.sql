-- schema.sql

-- 1. Create the main articles table
DROP TABLE IF EXISTS articles;
CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    author TEXT,
    url TEXT NOT NULL,
    content JSON, -- Storing the Readability payload (or sanitized HTML) here natively
    source_type TEXT DEFAULT 'web',
    unsubscribe_link TEXT,
    unsubscribe_one_click INTEGER DEFAULT 0, -- 1 when the link supports RFC 8058 one-click POST
    archived INTEGER DEFAULT 0, -- 1 once the user archives the article out of the active library
    summary TEXT, -- Stores the AI generated summary
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Index the active/archived split so the default library query stays fast.
CREATE INDEX IF NOT EXISTS idx_articles_source ON articles (source_type);

CREATE TABLE IF NOT EXISTS ingest_failures (
    id TEXT PRIMARY KEY,
    url_or_subject TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_articles_archived_created ON articles (archived, created_at DESC);

-- 2. Create the FTS5 Virtual Table for Full-Text Search
-- We index the title, author, and content.
DROP TABLE IF EXISTS articles_fts;
CREATE VIRTUAL TABLE articles_fts USING fts5(
    title,
    author,
    content,
    content='articles', -- Linked to the main table
    content_rowid='rowid'
);

-- 3. Triggers to keep the FTS5 table in sync automatically
CREATE TRIGGER articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, author, content) 
  VALUES (new.rowid, new.title, new.author, new.content);
END;

CREATE TRIGGER articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, author, content) 
  VALUES('delete', old.rowid, old.title, old.author, old.content);
END;

CREATE TRIGGER articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, author, content) 
  VALUES('delete', old.rowid, old.title, old.author, old.content);
  INSERT INTO articles_fts(rowid, title, author, content) 
  VALUES (new.rowid, new.title, new.author, new.content);
END;
