CREATE TABLE IF NOT EXISTS storage_blobs (
 id TEXT PRIMARY KEY, size INTEGER NOT NULL, content_type TEXT NOT NULL,
 complete INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS storage_chunks (
 blob_id TEXT NOT NULL REFERENCES storage_blobs(id) ON DELETE CASCADE,
 chunk_index INTEGER NOT NULL, data BLOB NOT NULL,
 PRIMARY KEY(blob_id,chunk_index)
);
CREATE TABLE IF NOT EXISTS storage_objects (
 object_key TEXT PRIMARY KEY, blob_id TEXT NOT NULL REFERENCES storage_blobs(id)
);
CREATE TABLE IF NOT EXISTS storage_uploads (
 object_key TEXT PRIMARY KEY, blob_id TEXT NOT NULL UNIQUE REFERENCES storage_blobs(id)
);
CREATE INDEX IF NOT EXISTS storage_object_blob ON storage_objects(blob_id);
CREATE TABLE IF NOT EXISTS pdf_uploads (
 id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, bytes INTEGER NOT NULL,
 created TEXT NOT NULL
);
