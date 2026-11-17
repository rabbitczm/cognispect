DROP INDEX IF EXISTS literature_search_pmid;
DROP INDEX IF EXISTS literature_search_doi;
DROP INDEX IF EXISTS literature_search_year;
CREATE INDEX IF NOT EXISTS literature_search_date ON literature_search_records(COALESCE(NULLIF(firstdate,''),CAST(year AS TEXT)),paper_key);
