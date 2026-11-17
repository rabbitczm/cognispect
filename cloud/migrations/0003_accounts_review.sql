CREATE TABLE IF NOT EXISTS account_credentials (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, recovery_hash TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_notes (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 paper_key TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1, source_pdf_id TEXT, legacy_highlights TEXT NOT NULL DEFAULT '[]',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE(owner_id,paper_key)
);
CREATE TABLE IF NOT EXISTS note_members (
 note_id TEXT NOT NULL REFERENCES research_notes(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 permission TEXT NOT NULL, share_pdf INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(note_id,user_id)
);
CREATE TABLE IF NOT EXISTS note_versions (
 note_id TEXT NOT NULL REFERENCES research_notes(id) ON DELETE CASCADE, version INTEGER NOT NULL,
 content TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 PRIMARY KEY(note_id,version)
);
CREATE TABLE IF NOT EXISTS note_comments (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES research_notes(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, quote TEXT NOT NULL DEFAULT '',
 page INTEGER, parent_id TEXT, resolved INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS note_suggestions (
 id TEXT PRIMARY KEY, note_id TEXT NOT NULL REFERENCES research_notes(id) ON DELETE CASCADE,
 author_id TEXT NOT NULL REFERENCES users(id), base_version INTEGER NOT NULL,
 content TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_summaries (
 id TEXT PRIMARY KEY, paper_key TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '',
 title TEXT NOT NULL, scope TEXT NOT NULL, source_version TEXT NOT NULL,
 content TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(paper_key,owner_id)
);
CREATE INDEX IF NOT EXISTS note_member_user ON note_members(user_id);
