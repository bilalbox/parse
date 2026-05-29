-- Adds the one-click capability flag to existing databases without dropping data.
-- Apply with:
--   wrangler d1 execute parse-db --remote --file=./migrations/0001_add_unsubscribe_one_click.sql
ALTER TABLE articles ADD COLUMN unsubscribe_one_click INTEGER DEFAULT 0;
