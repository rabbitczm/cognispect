import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class SearchCatalogMigrationV25(unittest.TestCase):
    def test_fts_search_keeps_disease_subtypes_separate_and_updates_hidden_articles(self):
        migration = ROOT / "cloud/migrations/0005_literature_search.sql"
        self.assertTrue(migration.is_file(), "the literature FTS index and publishing triggers must be installed")
        db = sqlite3.connect(":memory:")
        db.executescript((ROOT / "cloud/migrations/0001_initial.sql").read_text(encoding="utf-8"))
        db.executescript(migration.read_text(encoding="utf-8"))
        db.execute("INSERT INTO literature_search_records(paper_key,pmid,title,abstract,mesh,payload) VALUES(?,?,?,?,?,?)", (
            "1001", "1001", "Diabetic nephropathy progression", "Kidney outcomes in type 2 diabetes", "Diabetic Nephropathies", "{}"))
        db.execute("INSERT INTO literature_search_records(paper_key,pmid,title,abstract,mesh,payload) VALUES(?,?,?,?,?,?)", (
            "1002", "1002", "Diabetic retinopathy screening", "Eye disease among patients with diabetes", "Diabetic Retinopathy", "{}"))
        renal = db.execute("SELECT r.pmid FROM literature_search_fts JOIN literature_search_records r ON r.id=literature_search_fts.rowid WHERE literature_search_fts MATCH ?", ('"diabetic" AND "nephropathy"',)).fetchall()
        self.assertEqual(renal, [("1001",)])
        chinese = db.execute("SELECT r.pmid FROM literature_search_fts JOIN literature_search_records r ON r.id=literature_search_fts.rowid WHERE literature_search_fts MATCH ?", ('"糖尿病肾病"',)).fetchall()
        self.assertEqual(chinese, [])
        db.execute("INSERT INTO literature_search_records(paper_key,pmid,title,abstract,mesh,payload) VALUES(?,?,?,?,?,?)", (
            "1004", "1004", "糖尿病肾病的临床研究", "糖尿病肾病患者的肾脏结局", "糖尿病肾病", "{}"))
        chinese = db.execute("SELECT r.pmid FROM literature_search_fts JOIN literature_search_records r ON r.id=literature_search_fts.rowid WHERE literature_search_fts MATCH ?", ('"糖尿病肾病"',)).fetchall()
        self.assertEqual(chinese, [("1004",)])
        db.execute("INSERT INTO articles(key,payload,removed,updated) VALUES(?,?,0,'now')", ("1003", '{"pmid":"1003","title":"Type 2 diabetes and hypertension"}'))
        self.assertEqual(db.execute("SELECT COUNT(*) FROM literature_search_records WHERE paper_key='1003'").fetchone()[0], 1)
        db.execute("UPDATE articles SET removed=1 WHERE key='1003'")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM literature_search_records WHERE paper_key='1003'").fetchone()[0], 0)
        db.execute("INSERT INTO visibility(kind,item_key,visible) VALUES('article','1001',0)")
        visible = db.execute("SELECT r.pmid FROM literature_search_fts JOIN literature_search_records r ON r.id=literature_search_fts.rowid WHERE literature_search_fts MATCH ? AND NOT EXISTS (SELECT 1 FROM visibility v WHERE v.visible=0 AND v.item_key=r.pmid)", ('"diabetic" AND "nephropathy"',)).fetchall()
        self.assertEqual(visible, [])


if __name__ == "__main__":
    unittest.main()
