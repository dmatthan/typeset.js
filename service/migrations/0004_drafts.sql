-- New drafts under one link: a shared book's version, raised each time the writer sends a
-- new draft to the same link; readers ask for it to know there is a newer one.
ALTER TABLE books ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
