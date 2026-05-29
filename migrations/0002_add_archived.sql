-- Adds the archived flag to existing databases without dropping data.
-- Apply with:
--   wrangler d1 execute parse-db --remote --file=./migrations/0002_add_archived.sql
ALTER TABLE articles ADD COLUMN archived INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_articles_archived_created ON articles (archived, created_at DESC);
