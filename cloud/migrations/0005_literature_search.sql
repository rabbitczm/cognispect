CREATE TABLE IF NOT EXISTS literature_search_records (
 id INTEGER PRIMARY KEY,
 paper_key TEXT NOT NULL UNIQUE,
 pmid TEXT,
 doi TEXT,
 year INTEGER,
 firstdate TEXT,
 title TEXT NOT NULL,
 authors TEXT NOT NULL DEFAULT '',
 journal TEXT NOT NULL DEFAULT '',
 abstract TEXT NOT NULL DEFAULT '',
 mesh TEXT NOT NULL DEFAULT '',
 payload TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS literature_search_pmid ON literature_search_records(pmid);
CREATE INDEX IF NOT EXISTS literature_search_doi ON literature_search_records(doi);
CREATE INDEX IF NOT EXISTS literature_search_year ON literature_search_records(year);
CREATE VIRTUAL TABLE IF NOT EXISTS literature_search_fts USING fts5(title,authors,journal,abstract,mesh,content='literature_search_records',content_rowid='id',tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS literature_search_insert AFTER INSERT ON literature_search_records BEGIN
 INSERT INTO literature_search_fts(rowid,title,authors,journal,abstract,mesh) VALUES(NEW.id,NEW.title,NEW.authors,NEW.journal,NEW.abstract,NEW.mesh);
END;
CREATE TRIGGER IF NOT EXISTS literature_search_delete AFTER DELETE ON literature_search_records BEGIN
 INSERT INTO literature_search_fts(literature_search_fts,rowid,title,authors,journal,abstract,mesh) VALUES('delete',OLD.id,OLD.title,OLD.authors,OLD.journal,OLD.abstract,OLD.mesh);
END;
CREATE TRIGGER IF NOT EXISTS literature_search_update AFTER UPDATE ON literature_search_records BEGIN
 INSERT INTO literature_search_fts(literature_search_fts,rowid,title,authors,journal,abstract,mesh) VALUES('delete',OLD.id,OLD.title,OLD.authors,OLD.journal,OLD.abstract,OLD.mesh);
 INSERT INTO literature_search_fts(rowid,title,authors,journal,abstract,mesh) VALUES(NEW.id,NEW.title,NEW.authors,NEW.journal,NEW.abstract,NEW.mesh);
END;
CREATE TRIGGER IF NOT EXISTS literature_search_article_insert AFTER INSERT ON articles WHEN NEW.removed=0 BEGIN
 INSERT INTO literature_search_records(paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload)
 VALUES(NEW.key,json_extract(NEW.payload,'$.pmid'),json_extract(NEW.payload,'$.doi'),CAST(json_extract(NEW.payload,'$.year') AS INTEGER),json_extract(NEW.payload,'$.firstdate'),COALESCE(json_extract(NEW.payload,'$.title'),''),COALESCE(json_extract(NEW.payload,'$.authors_full'),json_extract(NEW.payload,'$.authors'),''),COALESCE(json_extract(NEW.payload,'$.journal'),''),COALESCE(json_extract(NEW.payload,'$.abstract'),''),COALESCE(json_extract(NEW.payload,'$.mesh'),'') ,NEW.payload);
END;
CREATE TRIGGER IF NOT EXISTS literature_search_article_update AFTER UPDATE ON articles BEGIN
 DELETE FROM literature_search_records WHERE paper_key=OLD.key;
 INSERT INTO literature_search_records(paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload)
 SELECT NEW.key,json_extract(NEW.payload,'$.pmid'),json_extract(NEW.payload,'$.doi'),CAST(json_extract(NEW.payload,'$.year') AS INTEGER),json_extract(NEW.payload,'$.firstdate'),COALESCE(json_extract(NEW.payload,'$.title'),''),COALESCE(json_extract(NEW.payload,'$.authors_full'),json_extract(NEW.payload,'$.authors'),''),COALESCE(json_extract(NEW.payload,'$.journal'),''),COALESCE(json_extract(NEW.payload,'$.abstract'),''),COALESCE(json_extract(NEW.payload,'$.mesh'),'') ,NEW.payload WHERE NEW.removed=0;
END;
CREATE TRIGGER IF NOT EXISTS literature_search_article_delete AFTER DELETE ON articles BEGIN
 DELETE FROM literature_search_records WHERE paper_key=OLD.key;
END;
CREATE TRIGGER IF NOT EXISTS literature_search_submission_insert AFTER INSERT ON submissions WHEN NEW.published IS NOT NULL BEGIN
 INSERT INTO literature_search_records(paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload)
 VALUES('submission-'||NEW.id,json_extract(NEW.published,'$.article.pmid'),json_extract(NEW.published,'$.article.doi'),CAST(json_extract(NEW.published,'$.article.year') AS INTEGER),json_extract(NEW.published,'$.article.firstdate'),COALESCE(json_extract(NEW.published,'$.article.title'),json_extract(NEW.published,'$.title'),''),COALESCE(json_extract(NEW.published,'$.article.authors'),json_extract(NEW.published,'$.authors'),''),COALESCE(json_extract(NEW.published,'$.article.journal'),json_extract(NEW.published,'$.journal'),''),COALESCE(json_extract(NEW.published,'$.article.abstract'),json_extract(NEW.published,'$.abstract'),''),COALESCE(json_extract(NEW.published,'$.article.mesh'),''),NEW.published);
END;
CREATE TRIGGER IF NOT EXISTS literature_search_submission_update AFTER UPDATE ON submissions BEGIN
 DELETE FROM literature_search_records WHERE paper_key='submission-'||OLD.id;
 INSERT INTO literature_search_records(paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload)
 SELECT 'submission-'||NEW.id,json_extract(NEW.published,'$.article.pmid'),json_extract(NEW.published,'$.article.doi'),CAST(json_extract(NEW.published,'$.article.year') AS INTEGER),json_extract(NEW.published,'$.article.firstdate'),COALESCE(json_extract(NEW.published,'$.article.title'),json_extract(NEW.published,'$.title'),''),COALESCE(json_extract(NEW.published,'$.article.authors'),json_extract(NEW.published,'$.authors'),''),COALESCE(json_extract(NEW.published,'$.article.journal'),json_extract(NEW.published,'$.journal'),''),COALESCE(json_extract(NEW.published,'$.article.abstract'),json_extract(NEW.published,'$.abstract'),''),COALESCE(json_extract(NEW.published,'$.article.mesh'),''),NEW.published WHERE NEW.published IS NOT NULL;
END;
CREATE TRIGGER IF NOT EXISTS literature_search_submission_delete AFTER DELETE ON submissions BEGIN
 DELETE FROM literature_search_records WHERE paper_key='submission-'||OLD.id;
END;
INSERT OR IGNORE INTO literature_search_records(paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload)
 SELECT key,json_extract(payload,'$.pmid'),json_extract(payload,'$.doi'),CAST(json_extract(payload,'$.year') AS INTEGER),json_extract(payload,'$.firstdate'),COALESCE(json_extract(payload,'$.title'),''),COALESCE(json_extract(payload,'$.authors_full'),json_extract(payload,'$.authors'),''),COALESCE(json_extract(payload,'$.journal'),''),COALESCE(json_extract(payload,'$.abstract'),''),COALESCE(json_extract(payload,'$.mesh'),''),payload FROM articles WHERE removed=0;
INSERT OR IGNORE INTO literature_search_records(paper_key,pmid,doi,year,firstdate,title,authors,journal,abstract,mesh,payload)
 SELECT 'submission-'||id,json_extract(published,'$.article.pmid'),json_extract(published,'$.article.doi'),CAST(json_extract(published,'$.article.year') AS INTEGER),json_extract(published,'$.article.firstdate'),COALESCE(json_extract(published,'$.article.title'),json_extract(published,'$.title'),''),COALESCE(json_extract(published,'$.article.authors'),json_extract(published,'$.authors'),''),COALESCE(json_extract(published,'$.article.journal'),json_extract(published,'$.journal'),''),COALESCE(json_extract(published,'$.article.abstract'),json_extract(published,'$.abstract'),''),COALESCE(json_extract(published,'$.article.mesh'),''),published FROM submissions WHERE published IS NOT NULL;
