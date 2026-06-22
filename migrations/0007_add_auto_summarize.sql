-- 0007_add_auto_summarize.sql

ALTER TABLE users ADD COLUMN auto_summarize_emails INTEGER DEFAULT 1;
