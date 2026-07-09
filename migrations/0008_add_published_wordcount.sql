-- 0008_add_published_wordcount.sql
-- Article-level metadata from Defuddle (web source): the article's own
-- publication date and word count. Distinct from created_at (ingest time).

ALTER TABLE articles ADD COLUMN published TEXT;
ALTER TABLE articles ADD COLUMN word_count INTEGER;
